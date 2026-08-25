/**
 * I.MY.ME.MINE — 경비 상태기계 (SPEC §5.3).
 *
 * PATROL → SUSPICIOUS → INVESTIGATE → CHASE → RETURN → PATROL.
 * 경로탐색은 A* 없이 "주축 우선 + 벽 슬라이딩". 맵이 작아 충분하고 완전히 결정론적이다.
 * 시체는 감지하지 않는다 — 그래서 실패한 잔상은 미끼가 아니라 순수 발판 자원이 된다.
 *
 * ── 유형 (`GuardKind`) ────────────────────────────────────────────────────
 * 속도·시야·크기·추격 지속은 전부 `GUARD_KINDS` 표에서 온다. 이 파일에는
 * "BRUTE 라면 …" 같은 유형 분기가 **없다**. 특히 BRUTE 가 1타일 통로를 못 지나가는
 * 것은 규칙이 아니라 40px 충돌 박스의 결과다 (`moveToward` 가 `g.sizeSub` 를 쓴다).
 * 보스 4종도 같은 규율을 지킨다: `INSPECTOR` 가 두리번거리지 않는 것은 `sweepArc: 0`
 * 의 결과이고, 나머지 셋은 표의 스위치(`sharesScent` / `ghost*Step` / `countTicks`)
 * 하나씩만 켠다. 유형 이름으로 갈라지는 `if` 는 이 파일에 하나도 없다.
 *
 * ── 결정론 ────────────────────────────────────────────────────────────────
 * 전부 정수. 경비는 **id 오름차순**으로 갱신한다(배열 순서가 아니라 id 다).
 * 경보와 무리 냄새는 한 틱을 2패스로 나눈다: (1) 모든 경비의 감지·상태전이·이동을
 * 계산하며 경보·궤적 목록을 모으고 → (2) 그 목록을 id 순으로 적용한다. 그러지 않으면
 * 경비 A 의 갱신이 같은 틱에 경비 B 의 판단을 바꿔 배열 순서가 결과를 가른다.
 * `OVERSEER` 의 잔상 배율도 마찬가지다 — 잔상 수는 `createWorld` 가 확정한 몸 목록
 * 에서만 나오므로 틱 안 어디서 재계산해도 같은 값이다.
 */

import {
  ALARM_COOLDOWN_TICKS,
  ALERT_RADIUS,
  BODY_SUB,
  CHASE_LEAD_MIN_DIST,
  CHASE_LEAD_TICKS,
  DAZE_SPIN_STEP,
  DETECT_MAX,
  DETECT_MID_BONUS,
  DETECT_NEAR_BONUS,
  DETECT_DECAY,
  DETECT_RUN_MULT,
  DETECT_SUSPICIOUS,
  DIR_Q,
  DIR_STEPS,
  FLASH_RADIUS,
  FLASH_TICKS,
  GUARD_KINDS,
  GUARD_SWEEP_PERIOD,
  GUARD_TURN_RATE,
  HOUND_FAN_ARC,
  HOUND_FAN_PERIOD,
  HOUND_WIGGLE_AMP,
  HOUND_WIGGLE_PERIOD,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  INVESTIGATE_TICKS,
  LUNGE_BURST,
  LUNGE_DEN,
  LUNGE_FAST_NUM,
  LUNGE_PERIOD,
  LUNGE_SLOW_NUM,
  RUN_DIAG,
  RUN_SPEED,
  SCENT_ARRIVE_EPS,
  SCENT_LEN,
  SCENT_STEP_TIMEOUT,
  SEARCH_OFFSETS,
  WALK_DIAG,
  WALK_SPEED,
  type GuardKindSpec,
} from './constants';
import {
  crateRects,
  dirCos,
  dirFromDelta,
  dirSin,
  dist2,
  inCone,
  lineBlocked,
  sweepAxis,
  turnToward,
  type Rect,
} from './physics';
import type { Body, Guard, Scent, SimState } from './types';

/** 경비가 잔상을 붙잡은 뒤 다시 흥분하기까지의 냉각 시간. 미끼가 성립하려면 필요하다. */
const RETURN_BLIND_TICKS = 90;
/** 도착 판정 여유 (서브픽셀). */
const ARRIVE_EPS = 256;

const MOVE_BITS = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;

/** 이번 틱에 울린 경보 한 건. 2패스의 (1)에서 모으고 (2)에서 적용한다. */
interface Alarm {
  /** 울린 경비의 id. 자기 자신은 자기 경보에 반응하지 않는다. */
  fromId: number;
  x: number;
  y: number;
}

/**
 * 이번 틱에 무리에게 넘길 궤적 한 건 (`sharesScent` 유형). 경보와 같은 2패스를 탄다:
 * (1)에서 모으고 (2)에서 **id 순으로** 적용한다. 같은 틱에 즉시 적용하면 갱신 순서가
 * 결과를 갈라 결정론이 깨진다.
 */
interface ScentShare {
  /** 넘긴 경비의 id. 자기 자신은 자기 냄새를 다시 받지 않는다. */
  fromId: number;
  bodyId: number;
  index: number;
}

/**
 * 이 루프에 투입된 잔상의 수. 몸 목록은 `createWorld` 가 확정하고 그 뒤로 늘거나
 * 줄지 않으므로, 매 틱 재계산해도 **항상 같은 값**이다. `alive` 를 보지 않는 이유가
 * 여기에 있다 — 잔상이 도중에 잡혀 시체가 되었다고 `OVERSEER` 의 배율이 틱 중간에
 * 흔들리면 "잔상을 많이 쓸수록 이 방이 어려워진다"가 예측 불가능한 규칙이 된다.
 */
function ghostCount(s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    if (!s.bodies[i]!.isLive) n++;
  }
  return n;
}

/** 정수 배율. `v * (100 + step*n) / 100` 을 내림한다 — 부동소수를 거치지 않는다. */
function scaleBy(v: number, step: number, n: number): number {
  return ((v * (100 + step * n)) / 100) | 0;
}

/**
 * 이 경비가 **이번 틱에** 쓰는 수치.
 *
 * 잔상 배율이 0 인 유형(기존 4종 포함)은 `GUARD_KINDS` 의 얼어붙은 객체를 그대로
 * 돌려준다 — 즉 값도 참조도 한 비트 바뀌지 않는다. 배율이 붙은 유형만 파생 객체를
 * 만들고, 그 계산은 전부 정수 곱셈·나눗셈이다.
 */
export function guardSpecOf(s: SimState, g: Guard): GuardKindSpec {
  const base = GUARD_KINDS[g.kind];
  if (base.ghostSpeedStep === 0 && base.ghostViewStep === 0) return base;
  const n = ghostCount(s);
  if (n === 0) return base;
  return {
    ...base,
    patrolSpeed: scaleBy(base.patrolSpeed, base.ghostSpeedStep, n),
    investigateSpeed: scaleBy(base.investigateSpeed, base.ghostSpeedStep, n),
    chaseSpeed: scaleBy(base.chaseSpeed, base.ghostSpeedStep, n),
    viewRange: scaleBy(base.viewRange, base.ghostViewStep, n),
  };
}

function guardCx(g: Guard): number {
  return g.x + g.sizeSub / 2;
}
function guardCy(g: Guard): number {
  return g.y + g.sizeSub / 2;
}
function bodyCx(b: Body): number {
  return b.x + BODY_SUB / 2;
}
function bodyCy(b: Body): number {
  return b.y + BODY_SUB / 2;
}

/**
 * 시야 안의 살아있는 바디 중 가장 가까운 것. 동률이면 id 낮은 쪽.
 * 수치는 호출자가 준 `spec` 만 쓴다 — `OVERSEER` 의 늘어난 시야가 여기까지 와야 한다.
 */
function sense(
  s: SimState,
  g: Guard,
  spec: GuardKindSpec,
  blockers: readonly Rect[],
): Body | null {
  const gx = guardCx(g);
  const gy = guardCy(g);
  let best: Body | null = null;
  let bestD = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (!b.alive) continue;
    const bx = bodyCx(b);
    const by = bodyCy(b);
    if (!inCone(bx - gx, by - gy, g.facing, spec.viewRange, spec.fovTan)) {
      continue;
    }
    if (lineBlocked(s, blockers, gx, gy, bx, by)) continue;
    const d = dist2(gx, gy, bx, by);
    if (best === null || d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * 이번 틱의 감지 이득. 유형별 기본 이득 × 달리기 배수 + 근접 보너스.
 * 거리 판정은 제곱거리 정수 비교뿐이다 (sqrt 없음).
 */
function detectGainFor(spec: GuardKindSpec, seen: Body, d2: number): number {
  const base = spec.detectGain * (isRunning(seen) ? DETECT_RUN_MULT : 1);
  const near = (spec.viewRange / 3) | 0;
  const mid = ((spec.viewRange * 2) / 3) | 0;
  if (d2 <= near * near) return base + DETECT_NEAR_BONUS;
  if (d2 <= mid * mid) return base + DETECT_MID_BONUS;
  return base;
}

/** 한 틱에 한 축만 움직인다(축정렬). 주축이 막히면 부축으로 슬라이딩. */
function moveToward(
  s: SimState,
  blockers: readonly Rect[],
  g: Guard,
  tx: number,
  ty: number,
  speed: number,
  turnRate: number,
): void {
  const dx = tx - guardCx(g);
  const dy = ty - guardCy(g);
  if (dx === 0 && dy === 0) return;
  const primaryX = Math.abs(dx) >= Math.abs(dy);
  const order: (0 | 1)[] = primaryX ? [0, 1] : [1, 0];
  // 유형별 몸 크기. 40px 인 BRUTE 는 여기서 32px 통로에 클램프된다 — 특수 규칙 없음.
  const size = g.sizeSub;

  for (let i = 0; i < order.length; i++) {
    const axis = order[i]!;
    const d = axis === 0 ? dx : dy;
    if (d === 0) continue;
    const step = d > 0 ? Math.min(speed, d) : Math.max(-speed, d);
    if (axis === 0) {
      const nx = sweepAxis(s, blockers, g.x, g.y, size, size, step, 0);
      if (nx !== g.x) {
        g.x = nx;
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), turnRate);
        return;
      }
    } else {
      const ny = sweepAxis(s, blockers, g.x, g.y, size, size, step, 1);
      if (ny !== g.y) {
        g.y = ny;
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), turnRate);
        return;
      }
    }
  }
  // 완전히 막혔다면 목표 방향만 바라본다.
  g.facing = turnToward(g.facing, dirFromDelta(dx, dy), turnRate);
}

// ── 냄새 추적 · 런지 · 좌우 흔들기 (tracksScent 유형) ──────────────────────

/** 이 궤적에서 아직 살아 있는(덮이지 않은) 가장 오래된 인덱스. */
function oldestIndex(sc: Scent): number {
  return sc.count > SCENT_LEN ? sc.count - SCENT_LEN : 0;
}

function hasIndex(sc: Scent, i: number): boolean {
  return i >= oldestIndex(sc) && i < sc.count;
}

function scentAt(sc: Scent, i: number): { x: number; y: number } {
  const slot = i % SCENT_LEN;
  return { x: sc.x[slot] ?? 0, y: sc.y[slot] ?? 0 };
}

/** 그 점을 남긴 틱. 몸마다 기록 빈도가 달라 인덱스로는 나이를 비교할 수 없다. */
function scentTick(sc: Scent, i: number): number {
  return sc.t[i % SCENT_LEN] ?? 0;
}

/**
 * 궤적의 주인. **시체가 되어도 그 궤적은 남는다** — 궤적은 "지금 저기 누가 있다"가
 * 아니라 "여기를 누가 지나갔다"는 기록이기 때문이다. 시체를 시야로 감지하지 않는
 * 규칙(SPEC §5.3)은 그대로이고, 냄새를 끝까지 따라가도 시체는 체포되지 않는다.
 * 실패한 잔상이 여전히 미끼로 유효하다는 SPEC §3-2 와도 같은 방향이다.
 */
function scentOwner(s: SimState, bodyId: number): Body | null {
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (b.id === bodyId) return b;
  }
  return null;
}

function clearScent(g: Guard): void {
  g.scentBodyId = -1;
  g.scentIndex = -1;
  g.scentTimer = 0;
}

function lockScent(g: Guard, bodyId: number, index: number): void {
  g.scentBodyId = bodyId;
  g.scentIndex = index;
  g.scentTimer = SCENT_STEP_TIMEOUT;
}

/**
 * 물고 있던 점을 지나 **다음(더 최신) 점**으로 옮긴다.
 * 최신 점까지 다 훑었으면 `scentIndex = -1` 로 두어 "이 궤적은 끝났다"를 표시한다 —
 * 그래야 다음 틱에 또 가장 오래된 점을 다시 물어 제자리를 맴돌지 않는다.
 */
function advanceScent(g: Guard, sc: Scent): void {
  const next = g.scentIndex + 1;
  if (hasIndex(sc, next)) {
    g.scentIndex = next;
    g.scentTimer = SCENT_STEP_TIMEOUT;
  } else {
    g.scentIndex = -1;
    g.scentTimer = 0;
  }
}

/**
 * 냄새 자물쇠 갱신. 감지 범위 안에 있는 **가장 오래된** 궤적점부터 물고,
 * 닿을 때마다 한 점씩 최신 쪽으로 옮겨간다. 그래서 개는 대상이 지금 어디 있든
 * **그 대상이 지나간 길**을 되짚는다.
 *
 * 후보가 여럿이면 인덱스가 작은 쪽(= 먼저 지나간 쪽), 동률이면 id 낮은 쪽.
 * 모든 몸이 같은 틱에 점을 남기므로 인덱스 비교가 곧 시간 비교다.
 * 잔상도 궤적을 남기므로 여기서 **잔상의 옛 궤적이 대상의 최신 궤적을 이긴다** —
 * 이 아이템 같은 반격이 성립하는 지점이다.
 */
function updateScent(s: SimState, g: Guard, spec: GuardKindSpec): void {
  if (g.scentBodyId >= 0) {
    const owner = scentOwner(s, g.scentBodyId);
    if (owner === null) {
      clearScent(g);
    } else if (g.scentIndex < 0) {
      return; // 이 궤적은 끝까지 훑었다 — 이제 직행한다.
    } else if (!hasIndex(owner.scent, g.scentIndex)) {
      // 링버퍼가 그 점을 덮어썼다. 남아 있는 가장 오래된 점부터 다시.
      g.scentIndex = oldestIndex(owner.scent);
      g.scentTimer = SCENT_STEP_TIMEOUT;
      return;
    } else {
      const p = scentAt(owner.scent, g.scentIndex);
      if (
        Math.abs(p.x - guardCx(g)) <= SCENT_ARRIVE_EPS &&
        Math.abs(p.y - guardCy(g)) <= SCENT_ARRIVE_EPS
      ) {
        advanceScent(g, owner.scent);
      } else if (--g.scentTimer <= 0) {
        // 벽 모서리에 걸렸다 — 한 점에 영원히 매달리지 않는다.
        advanceScent(g, owner.scent);
      }
      return;
    }
  }

  const range2 = spec.viewRange * spec.viewRange;
  let bestBody = -1;
  let bestIndex = -1;
  let bestTick = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    const sc = b.scent;
    for (let k = oldestIndex(sc); k < sc.count; k++) {
      const p = scentAt(sc, k);
      if (dist2(guardCx(g), guardCy(g), p.x, p.y) > range2) continue;
      // 한 궤적 안에서는 인덱스 순이 곧 시간 순이므로 첫 후보가 그 몸의 최고참이다.
      const tk = scentTick(sc, k);
      // 몸이 여럿이면 **더 오래 전에 남긴 냄새**가 이긴다. 동률이면 id 낮은 쪽.
      if (bestBody < 0 || tk < bestTick) {
        bestBody = b.id;
        bestIndex = k;
        bestTick = tk;
      }
      break;
    }
  }
  if (bestBody >= 0) lockScent(g, bestBody, bestIndex);
}

/** 지금 향해야 할 궤적점. null 이면 냄새가 없으니 목표로 직행한다. */
function scentTarget(s: SimState, g: Guard): { x: number; y: number } | null {
  if (g.scentBodyId < 0 || g.scentIndex < 0) return null;
  const owner = scentOwner(s, g.scentBodyId);
  if (owner === null || !hasIndex(owner.scent, g.scentIndex)) return null;
  return scentAt(owner.scent, g.scentIndex);
}

/**
 * 런지. 주기 앞부분은 ×1.35, 뒷부분은 ×0.6. 정수 분수만 쓴다.
 * 확 치고 나갔다 잠깐 숨을 고르는 리듬이 "개처럼"의 절반이다.
 */
function lungeSpeed(base: number, phase: number): number {
  const p = ((phase % LUNGE_PERIOD) + LUNGE_PERIOD) % LUNGE_PERIOD;
  const num = p < LUNGE_BURST ? LUNGE_FAST_NUM : LUNGE_SLOW_NUM;
  return ((base * num) / LUNGE_DEN) | 0;
}

/**
 * 진행 방향에 **수직**으로 미세하게 흔든 이동 목표.
 * 수직 방향은 facing 테이블에서 뽑으므로 sqrt 도 부동소수도 없다.
 * 진폭은 `SCENT_ARRIVE_EPS` 보다 작아 궤적점 도착 판정을 방해하지 않는다.
 */
function wiggleTarget(
  g: Guard,
  tx: number,
  ty: number,
  phase: number,
): { x: number; y: number } {
  const dx = tx - guardCx(g);
  const dy = ty - guardCy(g);
  if (dx === 0 && dy === 0) return { x: tx, y: ty };
  const perp = (dirFromDelta(dx, dy) + DIR_STEPS / 4) % DIR_STEPS;
  const amp = sweepOffset(phase, HOUND_WIGGLE_AMP, HOUND_WIGGLE_PERIOD);
  return {
    x: tx + (((dirCos(perp) * amp) / DIR_Q) | 0),
    y: ty + (((dirSin(perp) * amp) / DIR_Q) | 0),
  };
}

function arrived(g: Guard, tx: number, ty: number): boolean {
  return (
    Math.abs(tx - guardCx(g)) <= ARRIVE_EPS &&
    Math.abs(ty - guardCy(g)) <= ARRIVE_EPS
  );
}

function nearestWaypoint(g: Guard): number {
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < g.path.length; i++) {
    const p = g.path[i]!;
    const d = dist2(guardCx(g), guardCy(g), p.x, p.y);
    if (bestD < 0 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * 두리번거리기. 순찰 대기 중 facing 을 `sweepBase` 좌우로 흔든다.
 * 삼각파 `0 → +arc → 0 → -arc → 0` 을 정수 나눗셈만으로 만든다 — 난수도 sin 도 없다.
 */
function sweepOffset(phase: number, arc: number, period: number): number {
  const q = period >> 2; // 사분주기
  const p = ((phase % period) + period) % period;
  if (p < q) return ((arc * p) / q) | 0;
  if (p < 3 * q) return arc - (((arc * (p - q)) / q) | 0);
  return -arc + (((arc * (p - 3 * q)) / q) | 0);
}

/** 이 몸이 지금 어느 방향으로 얼마나 빠르게 가고 있는가 (예측 추격용). */
function velocityOf(b: Body): { vx: number; vy: number } {
  const m = b.lastInput;
  let sx = 0;
  let sy = 0;
  if ((m & IN_LEFT) !== 0) sx -= 1;
  if ((m & IN_RIGHT) !== 0) sx += 1;
  if ((m & IN_UP) !== 0) sy -= 1;
  if ((m & IN_DOWN) !== 0) sy += 1;
  if (sx === 0 && sy === 0) return { vx: 0, vy: 0 };
  const run = (m & IN_RUN) !== 0;
  const diagonal = sx !== 0 && sy !== 0;
  const sp = diagonal ? (run ? RUN_DIAG : WALK_DIAG) : run ? RUN_SPEED : WALK_SPEED;
  return { vx: sx * sp, vy: sy * sp };
}

/**
 * 예측 추격점. 대상의 마지막 이동 방향으로 `CHASE_LEAD_TICKS` 앞을 노린다.
 * 코앞에서는(= `CHASE_LEAD_MIN_DIST` 이내) 예측을 끄고 몸 자체를 노린다 —
 * 가까울수록 예측이 헛짚어 체포를 놓치기 때문이다.
 */
function chasePoint(g: Guard, b: Body): { x: number; y: number } {
  const bx = bodyCx(b);
  const by = bodyCy(b);
  const d2 = dist2(guardCx(g), guardCy(g), bx, by);
  if (d2 <= CHASE_LEAD_MIN_DIST * CHASE_LEAD_MIN_DIST) return { x: bx, y: by };
  const v = velocityOf(b);
  return { x: bx + v.vx * CHASE_LEAD_TICKS, y: by + v.vy * CHASE_LEAD_TICKS };
}

/** 수색을 그 지점에서 처음부터 시작한다. */
function beginInvestigate(g: Guard, x: number, y: number): void {
  g.state = 'INVESTIGATE';
  g.anchorX = x;
  g.anchorY = y;
  g.targetX = x;
  g.targetY = y;
  g.targetBodyId = -1;
  g.searchStep = -1;
  g.stateTimer = INVESTIGATE_TICKS;
  // 부채꼴 훑기는 수색을 시작하는 순간부터 센다 (tracksScent 유형만 읽는 값이다).
  if (GUARD_KINDS[g.kind].tracksScent) g.sweepPhase = 0;
}

function hearNoise(s: SimState, g: Guard, spec: GuardKindSpec): void {
  if (g.state === 'CHASE') return;
  for (let i = 0; i < s.noises.length; i++) {
    const n = s.noises[i]!;
    if (dist2(guardCx(g), guardCy(g), n.x, n.y) > n.radius * n.radius) continue;
    // 같은 지점을 이미 수색 중이면 다시 시작하지 않는다 — 소음이 12틱마다 갱신되는
    // 동안 수색 단계가 계속 0으로 되감기면 영원히 기준점만 맴돈다.
    if (g.state === 'INVESTIGATE' && g.anchorX === n.x && g.anchorY === n.y) {
      return;
    }
    beginInvestigate(g, n.x, n.y);
    // 개는 소리가 난 쪽으로 **지연 없이** 고개를 돌린다. 나머지 유형은 회전 속도에
    // 묶여 한 틱에 turnRate 만큼만 돈다 — 그 차이가 이 유형의 위협이다.
    if (spec.tracksScent) {
      g.facing = dirFromDelta(n.x - guardCx(g), n.y - guardCy(g));
    }
    return;
  }
}

function isRunning(b: Body): boolean {
  return (b.lastInput & IN_RUN) !== 0 && (b.lastInput & MOVE_BITS) !== 0;
}

/** 마지막으로 감지하던 대상이 그 사이 시체가 되었는가. */
function trackedIsCorpse(s: SimState, g: Guard): boolean {
  if (g.targetBodyId < 0) return false;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (b.id === g.targetBodyId) return !b.alive;
  }
  return false;
}

/**
 * 계수 한 틱 (`countTicks > 0` 인 유형 = COUNTER).
 *
 * 잡지 않는다. 살아있는 몸 하나를 `countTicks` 동안 **끊기지 않고** 붙들면
 * `s.counted` 를 1 올리고, 그 몸은 `countCooldown` 동안 다시 세지 않는다.
 * 쿨다운이 몸별인 이유는 두 몸이 함께 서 있을 때 한쪽이 다른 쪽의 계수를
 * 가려서는 안 되기 때문이다.
 *
 * **여기서 `DEBT` 를 건드리지 않는다.** 시뮬은 숫자를 올릴 뿐이고, 그 숫자를
 * 무엇으로 읽을지는 세션의 몫이다 (STORY §2 — 이 이야기의 공포는 회계다).
 */
function countTick(
  s: SimState,
  g: Guard,
  spec: GuardKindSpec,
  seen: Body | null,
): void {
  for (let i = 0; i < g.countCd.length; i++) {
    const cd = g.countCd[i] ?? 0;
    if (cd > 0) g.countCd[i] = cd - 1;
  }
  if (seen === null) {
    g.countTargetId = -1;
    g.countTimer = 0;
    return;
  }
  if (seen.id !== g.countTargetId) {
    g.countTargetId = seen.id;
    g.countTimer = 0;
  }
  g.countTimer++;
  if (g.countTimer < spec.countTicks) return;
  // id 가 곧 슬롯이다 (types.ts `countCd`). 범위 밖이면 세지 않는다.
  if (seen.id < 0 || seen.id >= g.countCd.length) return;
  if ((g.countCd[seen.id] ?? 0) > 0) return;
  s.counted++;
  g.countCd[seen.id] = spec.countCooldown;
  g.countTimer = 0;
}

function updateOne(
  s: SimState,
  g: Guard,
  blockers: readonly Rect[],
  alarms: Alarm[],
  shares: ScentShare[],
): void {
  const spec = guardSpecOf(s, g);
  if (g.alarmCooldown > 0) g.alarmCooldown--;

  // 눈뽕에 맞은 동안은 보지도 듣지도 움직이지도 못하고 제자리에서 돈다.
  // 시야 거리 0 과 감지 0 을 규칙으로 따로 쓰지 않고 **갱신 자체를 건너뛰어**
  // 보장한다 — 그래서 WATCHER 도 이 동안은 경보를 울릴 수 없다.
  if (g.dazed > 0) {
    g.dazed--;
    g.detect = 0;
    g.facing = (g.facing + DAZE_SPIN_STEP) % DIR_STEPS;
    return;
  }

  if (g.state === 'RETURN' && g.stateTimer > 0) g.stateTimer--;

  hearNoise(s, g, spec);

  const blind = g.state === 'RETURN' && g.stateTimer > 0;
  const seen = blind ? null : sense(s, g, spec, blockers);

  // 계수는 감지 게이지와 **무관**하다 — 얼마나 의심하는지가 아니라 얼마나 오래
  // 붙들었는지만 본다. 그래서 게이지가 차기 전에도 대가가 쌓인다.
  if (spec.countTicks > 0) countTick(s, g, spec, seen);

  if (seen !== null) {
    const d2 = dist2(guardCx(g), guardCy(g), bodyCx(seen), bodyCy(seen));
    g.detect = Math.min(DETECT_MAX, g.detect + detectGainFor(spec, seen, d2));
    g.targetX = bodyCx(seen);
    g.targetY = bodyCy(seen);
    g.targetBodyId = seen.id;
    seen.spotted = true;
  } else if (trackedIsCorpse(s, g)) {
    // 보고 있던 대상이 시체가 됐다 — 경비는 그것을 "이미 처리된 것"으로 보고
    // 관심을 완전히 끊는다 (SPEC §5.3). 남은 게이지가 흘러내리며 시체를
    // 계속 의심하는 일이 없어야 시체가 순수 발판 자원이 된다.
    g.detect = 0;
    g.targetBodyId = -1;
  } else {
    g.detect = Math.max(0, g.detect - DETECT_DECAY);
  }

  if (g.detect >= DETECT_MAX && spec.canChase) {
    if (g.state !== 'CHASE') {
      // 추격 **진입** 순간에만 경보를 울린다. 매 틱 울리면 주변 경비가
      // 수색을 시작하지도 못하고 계속 기준점으로 되감긴다.
      g.state = 'CHASE';
      // 런지 리듬은 무는 순간부터 센다 (다른 유형에서는 계속 0 이다).
      g.lungePhase = 0;
      alarms.push({ fromId: g.id, x: g.targetX, y: g.targetY });
    }
    g.targetBodyId = seen !== null ? seen.id : g.targetBodyId;
    g.chaseTimer = spec.chasePersist;
  } else if (g.state === 'CHASE') {
    // 시야를 잃어도 바로 접지 않는다. 유형별 `chasePersist` 만큼 버틴다 —
    // HOUND 가 "한번 물면 오래 쫓는다"가 성립하는 지점이다.
    if (seen !== null) g.chaseTimer = spec.chasePersist;
    else g.chaseTimer--;
    if (g.chaseTimer <= 0) {
      // 놓쳤다고 곧장 순찰로 돌아가지 않는다. 마지막으로 본 지점부터 **수색**한다 —
      // 그래서 들킨 뒤에는 도망이 아니라 따돌리기가 필요해진다.
      g.detect = 0;
      beginInvestigate(g, g.targetX, g.targetY);
    }
  } else if (g.detect >= DETECT_MAX && spec.raisesAlarm) {
    // WATCHER: 잡지 않는다. 대신 반경 안의 경비를 그 지점으로 부른다.
    if (g.alarmCooldown === 0) {
      alarms.push({ fromId: g.id, x: g.targetX, y: g.targetY });
      g.alarmCooldown = ALARM_COOLDOWN_TICKS;
    }
    if (g.state === 'PATROL' || g.state === 'RETURN') g.state = 'SUSPICIOUS';
  } else if (g.detect >= DETECT_SUSPICIOUS) {
    if (g.state === 'PATROL' || g.state === 'RETURN') g.state = 'SUSPICIOUS';
  } else if (g.state === 'SUSPICIOUS') {
    g.state = 'RETURN';
    g.stateTimer = 0;
  }

  // 냄새는 추적 중(CHASE/INVESTIGATE)에만 물고 있는다. 순찰로 돌아가면 놓는다.
  if (spec.tracksScent) {
    g.lungePhase++;
    if (g.state === 'CHASE' || g.state === 'INVESTIGATE') updateScent(s, g, spec);
    else clearScent(g);
  }

  // 무리에게 넘길 궤적을 **모으기만** 한다. 적용은 2패스의 (2)에서.
  if (spec.sharesScent && g.scentBodyId >= 0 && g.scentIndex >= 0) {
    shares.push({ fromId: g.id, bodyId: g.scentBodyId, index: g.scentIndex });
  }

  switch (g.state) {
    case 'PATROL': {
      if (g.path.length === 0) {
        lookAround(g, spec);
        break;
      }
      const wp = g.path[g.pathIndex % g.path.length]!;
      if (arrived(g, wp.x, wp.y) || spec.patrolSpeed === 0) {
        if (g.waitTimer === 0) g.sweepPhase = 0;
        g.waitTimer++;
        // 서 있는 동안 좌우를 훑는다. 정면만 피하면 되던 순찰이 사라진다.
        lookAround(g, spec);
        if (g.waitTimer >= g.waitTicks) {
          g.waitTimer = 0;
          g.pathIndex = (g.pathIndex + 1) % g.path.length;
        }
      } else {
        g.waitTimer = 0;
        moveToward(s, blockers, g, wp.x, wp.y, spec.patrolSpeed, GUARD_TURN_RATE);
        // 스윕의 기준은 **순찰이 정한 방향**이다. 여기서만 갱신하므로,
        // 한눈판 뒤(SUSPICIOUS/CHASE 로 목표를 향해 돌아간 뒤) 초소로 돌아와도
        // 그때의 facing 이 새 정면이 되지 않는다. 웨이포인트가 하나뿐이라
        // 한 번도 움직이지 않는 경비는 레벨이 지정한 facing 을 영원히 지킨다.
        g.sweepBase = g.facing;
      }
      break;
    }
    case 'SUSPICIOUS': {
      // 멈춰서 마지막 목격 지점을 바라본다.
      const dx = g.targetX - guardCx(g);
      const dy = g.targetY - guardCy(g);
      g.facing = turnToward(g.facing, dirFromDelta(dx, dy), spec.turnRate);
      break;
    }
    case 'INVESTIGATE': {
      // 예산은 이동까지 포함해 매 틱 소모된다. 예전처럼 도착 후에만 줄이면
      // 닿을 수 없는 지점을 향해 영원히 걸어가는 경비가 생긴다.
      g.stateTimer--;
      const trail = spec.tracksScent ? scentTarget(s, g) : null;
      if (trail !== null) {
        // 냄새를 물었다면 기준점·오프셋을 무시하고 **지나간 길**을 되짚는다.
        const w = wiggleTarget(g, trail.x, trail.y, g.lungePhase);
        moveToward(s, blockers, g, w.x, w.y, spec.investigateSpeed, spec.turnRate);
      } else if (arrived(g, g.targetX, g.targetY)) {
        if (g.searchStep < SEARCH_OFFSETS.length - 1) {
          // 도착했으면 서 있지 말고 주변을 훑는다. 오프셋은 고정 배열이다.
          g.searchStep++;
          const off = SEARCH_OFFSETS[g.searchStep]!;
          g.targetX = g.anchorX + off.x;
          g.targetY = g.anchorY + off.y;
        } else {
          g.facing = (g.facing + 1) % DIR_STEPS;
        }
      } else {
        moveToward(s, blockers, g, g.targetX, g.targetY, spec.investigateSpeed, spec.turnRate);
      }
      // 냄새를 못 찾은 개는 목표 방향을 중심으로 좌우를 부채꼴로 훑는다.
      // 위상 0 에서 오프셋이 0 이라, 소음을 들은 그 틱의 "즉시 고개 돌리기"를 덮지 않는다.
      if (trail === null && spec.tracksScent) {
        const base = dirFromDelta(g.targetX - guardCx(g), g.targetY - guardCy(g));
        g.facing =
          (base + sweepOffset(g.sweepPhase, HOUND_FAN_ARC, HOUND_FAN_PERIOD) + DIR_STEPS) %
          DIR_STEPS;
        g.sweepPhase++;
      }
      if (g.stateTimer <= 0) {
        g.state = 'RETURN';
        g.stateTimer = 0;
      }
      break;
    }
    case 'CHASE': {
      const target = s.bodies.find((b) => b.id === g.targetBodyId);
      if (target !== undefined && target.alive) {
        const p = chasePoint(g, target);
        g.targetX = p.x;
        g.targetY = p.y;
      }
      // 대상을 잃어도 마지막 지점까지 밀어붙인다. 추격을 끝내는 것은 오직
      // `chaseTimer` 다 — 도착했다고 곧바로 접으면 유형별 지속 시간이 무의미해진다.
      const trail = spec.tracksScent ? scentTarget(s, g) : null;
      let mx = trail?.x ?? g.targetX;
      let my = trail?.y ?? g.targetY;
      const speed = spec.tracksScent
        ? lungeSpeed(spec.chaseSpeed, g.lungePhase)
        : spec.chaseSpeed;
      if (spec.tracksScent) {
        // 코앞에서는 흔들지 않는다 — 흔들다 몸을 스쳐 지나가면 체포가 우연이 된다.
        const close =
          dist2(guardCx(g), guardCy(g), g.targetX, g.targetY) <=
          CHASE_LEAD_MIN_DIST * CHASE_LEAD_MIN_DIST;
        if (!close) {
          const w = wiggleTarget(g, mx, my, g.lungePhase);
          mx = w.x;
          my = w.y;
        }
      }
      moveToward(s, blockers, g, mx, my, speed, spec.turnRate);
      break;
    }
    case 'RETURN': {
      // 속도 0 인 유형(WATCHER)은 복귀할 수 없다 — 애초에 자리를 뜨지 않는다.
      if (g.path.length === 0 || spec.patrolSpeed === 0) {
        g.state = 'PATROL';
        g.waitTimer = 0;
        break;
      }
      const idx = nearestWaypoint(g);
      const wp = g.path[idx]!;
      if (arrived(g, wp.x, wp.y)) {
        g.pathIndex = idx;
        g.waitTimer = 0;
        g.state = 'PATROL';
      } else {
        moveToward(s, blockers, g, wp.x, wp.y, spec.patrolSpeed, GUARD_TURN_RATE);
      }
      break;
    }
  }
}

/**
 * 제자리 두리번거리기 한 틱.
 * 폭은 유형별(`spec.sweepArc`)이며 그 유형의 시야 반각을 넘지 않는다 — 그래서
 * 스윕 극단에서도 `sweepBase` 방향은 원뿔 안에 남는다. 감시를 넓히는 기능이
 * 지정 방향에 사각을 뚫으면 안 된다.
 */
function lookAround(g: Guard, spec: GuardKindSpec): void {
  g.facing =
    (g.sweepBase +
      sweepOffset(g.sweepPhase, spec.sweepArc, GUARD_SWEEP_PERIOD) +
      64) %
    64;
  g.sweepPhase++;
}

/** 경비 인덱스를 **id 오름차순**으로. 배열 순서가 결과를 가르지 않게 하는 유일한 장치. */
function idOrder(guards: readonly Guard[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < guards.length; i++) idx.push(i);
  // id 는 유일하므로 비교에 동률이 없다 — 정렬 안정성에 의존하지 않는다.
  idx.sort((a, b) => guards[a]!.id - guards[b]!.id);
  return idx;
}

/**
 * 2패스의 (2). 모아 둔 경보를 **id 순으로** 적용한다.
 * 이미 추격 중인 경비는 흔들리지 않고, 자기가 울린 경보에도 반응하지 않는다.
 */
function applyAlarms(s: SimState, alarms: readonly Alarm[], order: readonly number[]): void {
  if (alarms.length === 0) return;
  for (let a = 0; a < alarms.length; a++) {
    const al = alarms[a]!;
    for (let k = 0; k < order.length; k++) {
      const g = s.guards[order[k]!]!;
      if (g.id === al.fromId) continue;
      if (g.state === 'CHASE') continue;
      if (dist2(guardCx(g), guardCy(g), al.x, al.y) > ALERT_RADIUS * ALERT_RADIUS) {
        continue;
      }
      if (g.state === 'INVESTIGATE' && g.anchorX === al.x && g.anchorY === al.y) {
        continue;
      }
      beginInvestigate(g, al.x, al.y);
    }
  }
}

/**
 * 2패스의 (2) — 무리 냄새 공유. 모아 둔 궤적을 **id 순으로** 넘긴다.
 *
 * 받는 쪽은 냄새를 읽을 수 있는 유형(`tracksScent`)뿐이고, 이미 무언가를 물고
 * 있거나 추격 중인 경비는 흔들지 않는다 — 그래야 한 마리를 미끼로 빼는 것이
 * 여전히 유효하되, **빼지 않은 나머지는 전부 같은 궤적으로 온다.**
 * 경보와 달리 반경 조건이 없다: 무리는 거리로 끊기지 않는다.
 */
function applyShares(
  s: SimState,
  shares: readonly ScentShare[],
  order: readonly number[],
): void {
  if (shares.length === 0) return;
  for (let a = 0; a < shares.length; a++) {
    const sh = shares[a]!;
    const owner = scentOwner(s, sh.bodyId);
    if (owner === null || !hasIndex(owner.scent, sh.index)) continue;
    const p = scentAt(owner.scent, sh.index);
    for (let k = 0; k < order.length; k++) {
      const g = s.guards[order[k]!]!;
      if (g.id === sh.fromId) continue;
      if (!GUARD_KINDS[g.kind].tracksScent) continue;
      if (g.state === 'CHASE') continue;
      if (g.scentBodyId >= 0) continue;
      beginInvestigate(g, p.x, p.y);
      lockScent(g, sh.bodyId, sh.index);
    }
  }
}

/**
 * 눈뽕 폭발 (SPEC 확장). 사용 지점 반경 안이면서 **시야가 통하는** 경비만 어지러워진다 —
 * 벽 뒤는 안 걸린다. 판정 순서는 id 오름차순이고 난수는 쓰지 않는다.
 *
 * 추격 중이던 경비는 그 자리에서 `INVESTIGATE` 로 떨어진다. 마지막으로 본 지점을
 * 기준점으로 남기므로 **완전히 놓치는 게 아니라 잠깐 잃는 것**이다.
 */
export function applyFlash(
  s: SimState,
  x: number,
  y: number,
  blockers: readonly Rect[],
): void {
  const order = idOrder(s.guards);
  for (let i = 0; i < order.length; i++) {
    const g = s.guards[order[i]!]!;
    const gx = guardCx(g);
    const gy = guardCy(g);
    if (dist2(gx, gy, x, y) > FLASH_RADIUS * FLASH_RADIUS) continue;
    if (lineBlocked(s, blockers, x, y, gx, gy)) continue;
    if (g.state === 'CHASE') beginInvestigate(g, g.targetX, g.targetY);
    clearScent(g);
    g.dazed = FLASH_TICKS;
    g.detect = 0;
  }
}

export function updateGuards(s: SimState, staticBlockers: readonly Rect[]): void {
  const blockers = crateRects(s.crates).concat(staticBlockers);
  const order = idOrder(s.guards);
  const alarms: Alarm[] = [];
  const shares: ScentShare[] = [];
  // (1) 감지 · 상태전이 · 이동. 경보와 무리 냄새는 적용하지 않고 모으기만 한다.
  for (let i = 0; i < order.length; i++) {
    updateOne(s, s.guards[order[i]!]!, blockers, alarms, shares);
  }
  // (2) 모은 경보와 궤적을 id 순으로 적용.
  applyAlarms(s, alarms, order);
  applyShares(s, shares, order);
}

/**
 * 체포 판정 (SPEC §4 의 9단계).
 * 추격 중인 경비가 살아있는 몸과 겹치면 붙잡는다.
 * 잔상이면 "발각"만 되고 재생은 계속된다 — 미끼가 성립하는 지점.
 * 조작 중인 I 라면 루프 종료.
 */
export function resolveCapture(s: SimState): { captured: boolean; ghostSpotted: boolean } {
  let captured = false;
  let ghostSpotted = false;
  const order = idOrder(s.guards);
  for (let i = 0; i < order.length; i++) {
    const g = s.guards[order[i]!]!;
    // WATCHER 는 CHASE 에 들어가지 않으므로 아래 조건에서 이미 걸러지지만,
    // "감시자는 손을 대지 않는다"는 규칙을 코드에 남겨 둔다.
    if (!GUARD_KINDS[g.kind].canChase) continue;
    if (g.state !== 'CHASE') continue;
    for (let b = 0; b < s.bodies.length; b++) {
      const body = s.bodies[b]!;
      if (!body.alive) continue;
      const overlap =
        g.x < body.x + BODY_SUB &&
        body.x < g.x + g.sizeSub &&
        g.y < body.y + BODY_SUB &&
        body.y < g.y + g.sizeSub;
      if (!overlap) continue;

      if (body.isLive) {
        body.alive = false;
        body.spotted = true;
        s.alerts++;
        s.outcome = 'CAPTURED';
        captured = true;
        return { captured, ghostSpotted };
      }
      body.spotted = true;
      ghostSpotted = true;
      g.state = 'RETURN';
      g.detect = 0;
      g.targetBodyId = -1;
      g.stateTimer = RETURN_BLIND_TICKS;
      break;
    }
  }
  return { captured, ghostSpotted };
}
