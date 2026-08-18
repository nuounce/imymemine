/**
 * HOUND — "개처럼 움직인다"의 회귀 테스트.
 *
 * 이 파일의 원칙은 `guards.test.ts` 와 같다: **대조군 없는 주장은 쓰지 않는다.**
 * "냄새를 쫓는다"는 같은 배치에서 SENTRY 가 대상의 **현재 위치로 직행**하는 것을
 * 함께 보여야 냄새 때문이라는 뜻이 되고, "소리에 빨리 반응한다"는 나머지 셋이
 * 같은 소리에 몇 틱 늦게 고개를 돌리는 것을 함께 보여야 유형 차이가 된다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DETECT_MAX,
  GUARD_KINDS,
  GUARD_TURN_RATE,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  LUNGE_BURST,
  LUNGE_DEN,
  LUNGE_FAST_NUM,
  LUNGE_PERIOD,
  LUNGE_SLOW_NUM,
  TILE_SUB,
} from '../src/sim/constants';
import { dirFromDelta } from '../src/sim/physics';
import type { Guard, GuardKind, LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

const KINDS: readonly GuardKind[] = ['SENTRY', 'HOUND', 'BRUTE', 'WATCHER'];

function guardCx(g: Guard): number {
  return g.x + g.sizeSub / 2;
}
function guardCy(g: Guard): number {
  return g.y + g.sizeSub / 2;
}

function run(
  level: LevelDef,
  ticks: number,
  opts: {
    ghosts?: GhostSpec[];
    live?: (tick: number) => number;
    onTick?: (s: SimState, tick: number) => void;
  } = {},
): SimState {
  const sim = createWorld(level, opts.ghosts ?? []);
  for (let t = 0; t < ticks && sim.outcome === 'RUNNING'; t++) {
    stepWorld(sim, opts.live?.(t) ?? 0);
    opts.onTick?.(sim, t);
  }
  return sim;
}

/** 세그먼트 목록 → 테이프. 걷기 한 타일 = 16틱이라 손으로 검산된다. */
function tapeOf(segs: readonly (readonly [number, number])[]): Tape {
  const out: number[] = [];
  for (const [mask, n] of segs) for (let i = 0; i < n; i++) out.push(mask);
  return Uint16Array.from(out);
}

/** 64스텝 링에서 두 방향의 최단 각차. */
function facingDelta(a: number, b: number): number {
  const d = (((a - b) % 64) + 64) % 64;
  return Math.min(d, 64 - d);
}

// ══════════════════════════════════════════════════════════════════════════
// 1. 냄새 추적 — 대상의 **현재 위치**가 아니라 **지나간 길**을 따라간다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 넓은 방. 잔상은 y=6 을 서쪽(2)에서 동쪽으로 걷다가 경비 바로 아래(9)에 선다.
 * 경비는 (9,3)에서 **아래(+Y)** 를 보고 있으므로, 잔상이 코앞에 설 때 게이지가 찬다.
 *
 * 그 순간 잔상의 **현재 위치는 경비 바로 아래**다. 직행하는 유형은 남쪽으로만 간다.
 * 냄새를 쫓는 유형은 감지 범위 안에 남아 있는 **가장 오래된** 궤적점(서쪽 x≈5)부터
 * 물기 때문에 반대로 **서쪽으로 되돌아간다** — 그 차이가 이 테스트의 전부다.
 */
const LV_TRAIL = (kind: GuardKind): LevelDef => ({
  id: `T_TRAIL_${kind}`,
  name: 'TRAIL',
  par: 1,
  hint: '',
  tiles: [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#S.................#',
    '#..................#',
    '#..................#',
    '####################',
  ],
  guards: [{ path: [{ tx: 9, ty: 3 }], waitTicks: 6000, facing: 16, kind }],
  loot: { tx: 18, ty: 8 },
  escape: { tx: 18, ty: 1 },
});

/** (1,6) → 동쪽으로 8타일 걸어 (9,6) 에 서서 머문다. */
const TRAIL_GHOST = tapeOf([
  [IN_RIGHT, 8 * 16],
  [0, 400],
]);

/** 추격 중 경비가 도달한 **가장 서쪽** 중심 x 와 추격 진입 여부. */
function westReach(kind: GuardKind): { minCx: number; startCx: number; chased: boolean } {
  const lv = LV_TRAIL(kind);
  const startCx = guardCx(createWorld(lv, []).guards[0]!);
  let minCx = startCx;
  let chased = false;
  run(lv, 420, {
    ghosts: [{ tape: TRAIL_GHOST, corpse: false }],
    onTick: (s) => {
      const g = s.guards[0]!;
      if (g.state === 'CHASE') chased = true;
      if (chased && guardCx(g) < minCx) minCx = guardCx(g);
    },
  });
  return { minCx, startCx, chased };
}

describe('HOUND 는 지나간 궤적을 되짚는다 (대조군: SENTRY 는 현재 위치로 직행)', () => {
  it('HOUND 는 대상이 남쪽 코앞에 있는데도 서쪽 옛 궤적으로 되돌아간다', () => {
    const hound = westReach('HOUND');
    assert.equal(hound.chased, true, 'HOUND 가 추격에 들어가지도 않았다 — 배치가 잘못된 테스트다');
    assert.ok(
      hound.startCx - hound.minCx >= 3 * TILE_SUB,
      `HOUND 가 옛 궤적 쪽(서쪽)으로 되돌아가지 않았다: 시작 ${hound.startCx} → 최서단 ${hound.minCx}`,
    );
  });

  it('대조군: SENTRY 는 같은 배치에서 대상 쪽(남쪽)으로만 간다', () => {
    const sentry = westReach('SENTRY');
    const hound = westReach('HOUND');
    assert.equal(sentry.chased, true, 'SENTRY 가 추격에 들어가지도 않았다');
    assert.ok(
      hound.minCx < sentry.minCx - 2 * TILE_SUB,
      `직행 유형과 냄새 유형의 서진 거리가 구분되지 않는다: SENTRY ${sentry.minCx} vs HOUND ${hound.minCx}`,
    );
  });

  it('되짚는 동안 실제로 궤적을 물고 있다 (자물쇠가 잔상 궤적을 가리킨다)', () => {
    let lockedTicks = 0;
    run(LV_TRAIL('HOUND'), 420, {
      ghosts: [{ tape: TRAIL_GHOST, corpse: false }],
      onTick: (s) => {
        const g = s.guards[0]!;
        if (g.state === 'CHASE' && g.scentBodyId >= 0 && g.scentIndex >= 0) lockedTicks++;
      },
    });
    assert.ok(lockedTicks > 0, '추격 내내 궤적을 한 틱도 물지 않았다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 잔상의 궤적이 HOUND 를 엉뚱한 곳으로 끈다 — 이 아이템 같은 반격
// ══════════════════════════════════════════════════════════════════════════

/**
 * 두 갈래 방. 잔상은 **일찍** 남쪽 복도(y=5)를 서→동으로 지나가고,
 * 조작 몸은 **나중에** 북쪽 복도(y=1)를 따라와 개의 코앞(12,1)에 선다.
 *
 * 개가 조작 몸을 물었을 때, 감지 범위 안에 남아 있는 궤적은 두 벌이다:
 *  · 잔상이 남쪽에 남긴 **오래된** 궤적
 *  · 조작 몸이 북쪽에 남긴 **최근** 궤적
 * 규칙은 "가장 오래된 것부터"이므로 개는 남쪽 잔상 궤적을 문다 → 북쪽의 나를 두고
 * 남쪽으로 간다. 대조군(잔상 없음)에서는 물 궤적이 내 것뿐이라 그대로 잡힌다.
 */
const LV_DECOY: LevelDef = {
  id: 'T_DECOY',
  name: 'DECOY',
  par: 1,
  hint: '',
  tiles: [
    '########################',
    '#S.....................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '########################',
  ],
  guards: [{ path: [{ tx: 12, ty: 5 }], waitTicks: 6000, facing: 48, kind: 'HOUND' }],
  loot: { tx: 22, ty: 7 },
  escape: { tx: 22, ty: 1 },
};

/** 잔상: 곧장 남쪽 복도(y=5)로 내려가 동쪽 끝까지 걸어간 뒤 선다. */
const DECOY_GHOST = tapeOf([
  [2 /* IN_DOWN */, 4 * 16],
  [IN_RIGHT, 18 * 16],
  [0, 600],
]);

/**
 * 조작 몸: 한참 기다렸다가 북쪽 복도(y=1)를 따라 개의 머리 위를 지나 계속 동쪽으로 간다.
 * 개가 남쪽 냄새에 팔려 있는 동안 벌어지는 거리가 곧 이 반격의 값어치다.
 */
function decoyLive(tick: number): number {
  if (tick < 320) return 0;
  if (tick < 320 + 20 * 16) return IN_RIGHT;
  return 0;
}

function decoyRun(withGhost: boolean): {
  outcome: string;
  lockedGhost: boolean;
  lockedLive: boolean;
  minGuardY: number;
} {
  let lockedGhost = false;
  let lockedLive = false;
  let minGuardY = Number.MAX_SAFE_INTEGER;
  const sim = run(LV_DECOY, 900, {
    ghosts: withGhost ? [{ tape: DECOY_GHOST, corpse: false }] : [],
    live: decoyLive,
    onTick: (s) => {
      const g = s.guards[0]!;
      if (g.state === 'CHASE') {
        if (g.scentBodyId === 1) lockedGhost = true;
        if (g.scentBodyId === 0) lockedLive = true;
        if (guardCy(g) < minGuardY) minGuardY = guardCy(g);
      }
    },
  });
  return { outcome: sim.outcome, lockedGhost, lockedLive, minGuardY };
}

describe('잔상의 궤적이 HOUND 를 엉뚱한 곳으로 끈다', () => {
  it('대조군: 잔상이 없으면 개는 내 궤적을 물고 그대로 나를 잡는다', () => {
    const r = decoyRun(false);
    assert.equal(r.lockedLive, true, '개가 내 궤적을 물지 않았다 — 배치가 잘못된 테스트다');
    assert.equal(r.outcome, 'CAPTURED', `잔상 없이도 안 잡혔다 (outcome=${r.outcome})`);
  });

  it('먼저 지나간 잔상의 궤적이 있으면 개는 그쪽을 물고 나는 살아남는다', () => {
    const r = decoyRun(true);
    assert.equal(r.lockedGhost, true, '개가 잔상의 옛 궤적을 물지 않았다');
    assert.notEqual(r.outcome, 'CAPTURED', '잔상 궤적이 있는데도 잡혔다 — 미끼가 성립하지 않는다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 런지 — 추격 속도가 주기적으로 오르내린다
// ══════════════════════════════════════════════════════════════════════════

const FAST = ((GUARD_KINDS.HOUND.chaseSpeed * LUNGE_FAST_NUM) / LUNGE_DEN) | 0;
const SLOW = ((GUARD_KINDS.HOUND.chaseSpeed * LUNGE_SLOW_NUM) / LUNGE_DEN) | 0;

/** 추격 중 한 틱에 실제로 움직인 거리(축정렬이라 한 축뿐이다)들의 집합. */
function chaseSteps(kind: GuardKind): number[] {
  const lv = LV_TRAIL(kind);
  const steps: number[] = [];
  let prevX = -1;
  let prevY = -1;
  run(lv, 420, {
    ghosts: [{ tape: TRAIL_GHOST, corpse: false }],
    onTick: (s) => {
      const g = s.guards[0]!;
      if (g.state === 'CHASE' && prevX >= 0) {
        const d = Math.abs(g.x - prevX) + Math.abs(g.y - prevY);
        if (d > 0) steps.push(d);
      }
      prevX = g.x;
      prevY = g.y;
    },
  });
  return steps;
}

describe('런지 — 추격 속도가 주기로 오르내린다 (대조군: SENTRY 는 일정)', () => {
  it('HOUND 의 한 틱 이동량이 빠른 값과 느린 값 둘 다 나온다', () => {
    const steps = chaseSteps('HOUND');
    assert.ok(steps.length > LUNGE_PERIOD, `추격이 너무 짧아 주기를 못 본다 (${steps.length}틱)`);
    assert.equal(Math.max(...steps), FAST, `가장 빠른 한 걸음이 런지 최대치가 아니다`);
    assert.ok(steps.includes(SLOW), `느린 구간(${SLOW})이 한 번도 나오지 않았다`);
    // 배수가 실제로 기준 속도를 위아래로 가른다는 것도 못박는다.
    assert.ok(FAST > GUARD_KINDS.HOUND.chaseSpeed && SLOW < GUARD_KINDS.HOUND.chaseSpeed);
    assert.ok(LUNGE_BURST < LUNGE_PERIOD, '버스트가 주기 전체를 덮으면 리듬이 없다');
  });

  it('대조군: SENTRY 의 한 틱 이동량은 추격 속도 하나뿐이다', () => {
    const steps = chaseSteps('SENTRY');
    assert.ok(steps.length > 0, 'SENTRY 가 추격 중 한 틱도 움직이지 않았다');
    // 목표에 닿는 마지막 한 걸음만 짧을 수 있으므로 최대치로 판정한다.
    assert.equal(Math.max(...steps), GUARD_KINDS.SENTRY.chaseSpeed);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. 소리에 즉각 반응 — 네 유형 중 가장 빨리 고개를 돌린다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 경비는 (14,4)에서 **동쪽(+X)** 을 보고 있고, 소음은 **서쪽**에서 난다.
 * 등 뒤라 시야로는 절대 잡히지 않으므로 facing 을 돌리는 원인은 소리뿐이다.
 * 잔상은 12틱만 달려 소음 한 번을 내고 그 자리에서 테이프가 끝난다.
 */
const LV_EAR = (kind: GuardKind): LevelDef => ({
  id: `T_EAR_${kind}`,
  name: 'EAR',
  par: 1,
  hint: '',
  tiles: [
    '##################',
    '#................#',
    '#................#',
    '#................#',
    '#S...............#',
    '#................#',
    '#................#',
    '##################',
  ],
  guards: [{ path: [{ tx: 6, ty: 4 }], waitTicks: 6000, facing: 0, kind }],
  loot: { tx: 16, ty: 6 },
  escape: { tx: 16, ty: 1 },
});

/** 12틱만 달려 소음 하나를 내고 끝나는 잔상. */
const ONE_NOISE = tapeOf([[IN_RIGHT | IN_RUN, 12]]);

/** 소음을 들은 그 틱에, 소리 나는 쪽과 facing 이 얼마나 어긋나 있는가. */
function earDelta(kind: GuardKind): number | null {
  let delta: number | null = null;
  run(LV_EAR(kind), 240, {
    ghosts: [{ tape: ONE_NOISE, corpse: true }],
    onTick: (s) => {
      if (delta !== null) return;
      const g = s.guards[0]!;
      if (g.state !== 'INVESTIGATE') return;
      const want = dirFromDelta(g.anchorX - guardCx(g), g.anchorY - guardCy(g));
      delta = facingDelta(g.facing, want);
    },
  });
  return delta;
}

describe('소리에 대한 반응 속도 — HOUND 가 가장 빠르다', () => {
  it('HOUND 는 소음을 들은 그 틱에 이미 그쪽을 보고 있다', () => {
    assert.equal(earDelta('HOUND'), 0, 'HOUND 가 소리 난 쪽을 즉시 보지 않았다');
  });

  it('대조군: 나머지 셋은 같은 소리에 회전 속도만큼 늦게 돈다', () => {
    for (const k of KINDS) {
      if (k === 'HOUND') continue;
      const d = earDelta(k);
      assert.ok(d !== null, `${k}: 소음을 듣고도 수색을 시작하지 않았다 — 배치가 잘못된 테스트다`);
      assert.ok(d > 0, `${k} 가 HOUND 처럼 즉시 고개를 돌렸다 (delta=${d})`);
    }
  });

  it('반응 회전 속도는 표에서 온다 — HOUND 만 기준값보다 크다', () => {
    assert.ok(GUARD_KINDS.HOUND.turnRate > GUARD_TURN_RATE);
    for (const k of KINDS) {
      if (k === 'HOUND') continue;
      assert.equal(GUARD_KINDS[k].turnRate, GUARD_TURN_RATE, `${k} 의 회전 속도가 기준값이 아니다`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 회귀 — SENTRY / BRUTE / WATCHER 는 새 코드 경로를 한 줄도 타지 않는다
// ══════════════════════════════════════════════════════════════════════════

describe('회귀 — 나머지 세 유형의 동작은 바뀌지 않았다', () => {
  it('냄새 추적 스위치가 HOUND 에만 켜져 있다', () => {
    assert.deepEqual(
      KINDS.map((k) => GUARD_KINDS[k].tracksScent),
      [false, true, false, false],
    );
  });

  it('추격·수색이 도는 배치에서도 셋은 궤적을 물지 않고 런지 위상도 0 이다', () => {
    for (const k of KINDS) {
      if (k === 'HOUND') continue;
      // WATCHER 는 추격하지 않으므로 "관여했는가"는 게이지가 찼는지로 본다.
      let engaged = false;
      run(LV_TRAIL(k), 420, {
        ghosts: [{ tape: TRAIL_GHOST, corpse: false }],
        onTick: (s) => {
          const g = s.guards[0]!;
          if (g.detect >= DETECT_MAX || g.state !== 'PATROL') engaged = true;
          assert.equal(g.scentBodyId, -1, `${k} 가 궤적을 물었다`);
          assert.equal(g.scentIndex, -1, `${k} 에 궤적 인덱스가 생겼다`);
          assert.equal(g.lungePhase, 0, `${k} 의 런지 위상이 움직였다`);
          assert.equal(g.dazed, 0, `${k} 가 아무 이유 없이 어지러워졌다`);
        },
      });
      assert.ok(engaged, `${k}: 감지도 상태 전이도 없었다 — 회귀를 못 지키는 테스트다`);
    }
  });

  it('평온한 순찰에서는 네 유형 모두 같은 속도로 고개를 돌린다', () => {
    // 순찰로 왕복시키며 한 틱 최대 회전량을 잰다. HOUND 의 빠른 회전은
    // **반응**(소리·의심·추격)에만 쓰이고 순찰에는 새어 나오지 않아야 한다.
    for (const k of KINDS) {
      if (GUARD_KINDS[k].patrolSpeed === 0) continue; // WATCHER 는 순찰하지 않는다
      const lv = LV_TRAIL(k);
      lv.guards = [
        { path: [{ tx: 4, ty: 3 }, { tx: 14, ty: 3 }, { tx: 4, ty: 7 }], waitTicks: 5, facing: 0, kind: k },
      ];
      let maxTurn = 0;
      let prev = -1;
      run(lv, 600, {
        onTick: (s) => {
          const g = s.guards[0]!;
          if (g.state === 'PATROL' && prev >= 0) {
            const d = facingDelta(g.facing, prev);
            if (d > maxTurn) maxTurn = d;
          }
          prev = g.state === 'PATROL' ? g.facing : -1;
        },
      });
      assert.ok(
        maxTurn <= GUARD_TURN_RATE,
        `${k} 가 순찰 중 한 틱에 ${maxTurn} 스텝 돌았다 (기준 ${GUARD_TURN_RATE})`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. 결정론
// ══════════════════════════════════════════════════════════════════════════

describe('결정론 — 냄새 추적이 도는 레벨', () => {
  it('같은 테이프를 두 번 재생하면 궤적까지 포함해 상태가 완전히 일치한다', () => {
    const play = (): { tick: number; outcome: string; guard: string; scent: string } => {
      const sim = run(LV_DECOY, 700, {
        ghosts: [{ tape: DECOY_GHOST, corpse: false }],
        live: decoyLive,
      });
      const g = sim.guards[0]!;
      return {
        tick: sim.tick,
        outcome: sim.outcome,
        guard: [g.x, g.y, g.facing, g.state, g.scentBodyId, g.scentIndex, g.lungePhase].join('|'),
        scent: sim.bodies.map((b) => `${b.id}:${b.scent.count}:${b.scent.x.join(',')}`).join(';'),
      };
    };
    assert.deepEqual(play(), play());
  });
});

void IN_UP;
