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
 *
 * ── 결정론 ────────────────────────────────────────────────────────────────
 * 전부 정수. 경비는 **id 오름차순**으로 갱신한다(배열 순서가 아니라 id 다).
 * 경보는 한 틱을 2패스로 나눈다: (1) 모든 경비의 감지·상태전이·이동을 계산하며
 * 경보 목록을 모으고 → (2) 그 목록을 id 순으로 적용한다. 그러지 않으면 경비 A 의
 * 갱신이 같은 틱에 경비 B 의 판단을 바꿔 배열 순서가 결과를 가른다.
 */

import {
  ALARM_COOLDOWN_TICKS,
  ALERT_RADIUS,
  BODY_SUB,
  CHASE_LEAD_MIN_DIST,
  CHASE_LEAD_TICKS,
  DETECT_MAX,
  DETECT_MID_BONUS,
  DETECT_NEAR_BONUS,
  DETECT_DECAY,
  DETECT_RUN_MULT,
  DETECT_SUSPICIOUS,
  GUARD_KINDS,
  GUARD_SWEEP_PERIOD,
  GUARD_TURN_RATE,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  INVESTIGATE_TICKS,
  RUN_DIAG,
  RUN_SPEED,
  SEARCH_OFFSETS,
  WALK_DIAG,
  WALK_SPEED,
  type GuardKindSpec,
} from './constants';
import {
  crateRects,
  dirFromDelta,
  dist2,
  inCone,
  lineBlocked,
  sweepAxis,
  turnToward,
  type Rect,
} from './physics';
import type { Body, Guard, SimState } from './types';

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

function specOf(g: Guard): GuardKindSpec {
  return GUARD_KINDS[g.kind];
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

/** 시야 안의 살아있는 바디 중 가장 가까운 것. 동률이면 id 낮은 쪽. */
function sense(s: SimState, g: Guard, blockers: readonly Rect[]): Body | null {
  const spec = specOf(g);
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
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
        return;
      }
    } else {
      const ny = sweepAxis(s, blockers, g.x, g.y, size, size, step, 1);
      if (ny !== g.y) {
        g.y = ny;
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
        return;
      }
    }
  }
  // 완전히 막혔다면 목표 방향만 바라본다.
  g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
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
}

function hearNoise(s: SimState, g: Guard): void {
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

function updateOne(
  s: SimState,
  g: Guard,
  blockers: readonly Rect[],
  alarms: Alarm[],
): void {
  const spec = specOf(g);
  if (g.state === 'RETURN' && g.stateTimer > 0) g.stateTimer--;
  if (g.alarmCooldown > 0) g.alarmCooldown--;

  hearNoise(s, g);

  const blind = g.state === 'RETURN' && g.stateTimer > 0;
  const seen = blind ? null : sense(s, g, blockers);

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
        moveToward(s, blockers, g, wp.x, wp.y, spec.patrolSpeed);
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
      g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
      break;
    }
    case 'INVESTIGATE': {
      // 예산은 이동까지 포함해 매 틱 소모된다. 예전처럼 도착 후에만 줄이면
      // 닿을 수 없는 지점을 향해 영원히 걸어가는 경비가 생긴다.
      g.stateTimer--;
      if (arrived(g, g.targetX, g.targetY)) {
        if (g.searchStep < SEARCH_OFFSETS.length - 1) {
          // 도착했으면 서 있지 말고 주변을 훑는다. 오프셋은 고정 배열이다.
          g.searchStep++;
          const off = SEARCH_OFFSETS[g.searchStep]!;
          g.targetX = g.anchorX + off.x;
          g.targetY = g.anchorY + off.y;
        } else {
          g.facing = (g.facing + 1) % 64;
        }
      } else {
        moveToward(s, blockers, g, g.targetX, g.targetY, spec.investigateSpeed);
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
      moveToward(s, blockers, g, g.targetX, g.targetY, spec.chaseSpeed);
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
        moveToward(s, blockers, g, wp.x, wp.y, spec.patrolSpeed);
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

export function updateGuards(s: SimState, staticBlockers: readonly Rect[]): void {
  const blockers = crateRects(s.crates).concat(staticBlockers);
  const order = idOrder(s.guards);
  const alarms: Alarm[] = [];
  // (1) 감지 · 상태전이 · 이동. 경보는 적용하지 않고 모으기만 한다.
  for (let i = 0; i < order.length; i++) {
    updateOne(s, s.guards[order[i]!]!, blockers, alarms);
  }
  // (2) 모은 경보를 id 순으로 적용.
  applyAlarms(s, alarms, order);
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
