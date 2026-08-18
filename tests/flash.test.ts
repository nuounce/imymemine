/**
 * 눈뽕(1회용 섬광탄) 회귀 테스트.
 *
 * 이 아이템의 존재 이유는 "경비를 잠깐 무력화한다"가 아니라
 * **과거의 내가 정확한 순간에 터뜨려 주고 지금의 내가 그 틈으로 지나간다** 는 그림이다.
 * 그래서 이 파일의 마지막 두 절(잔상 재생 · 결정론)이 앞의 것들보다 중요하다.
 *
 * 여기서도 대조군 없는 주장은 쓰지 않는다: "줍지 않으면 못 쓴다", "벽 뒤는 안 걸린다",
 * "감시자가 어지러우면 경보가 안 울린다" 모두 반대 배치를 함께 돌려서 보인다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DAZE_SPIN_STEP,
  DIR_STEPS,
  FLASH_RADIUS,
  FLASH_TICKS,
  IN_FLASH,
  IN_RIGHT,
  TILE_SUB,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import { dist2 } from '../src/sim/physics';
import type { Guard, LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

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

function tapeOf(segs: readonly (readonly [number, number])[]): Tape {
  const out: number[] = [];
  for (const [mask, n] of segs) for (let i = 0; i < n; i++) out.push(mask);
  return Uint16Array.from(out);
}

// ══════════════════════════════════════════════════════════════════════════
// 1. 줍기와 소진 — 대조군: 안 주우면 못 쓴다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 조작 몸은 (2,4)에서 시작하고 경비는 (6,4)에서 **동쪽(등 뒤)** 을 본다.
 * 경비가 몸을 볼 일이 없으므로, 이 절에서 경비 상태를 바꾸는 것은 눈뽕뿐이다.
 * `flashTx` 를 스폰에서 떼어 놓으면 그대로 "줍지 못한 대조군"이 된다.
 */
const LV_PICKUP = (flashTx: number): LevelDef => ({
  id: `T_FLASH_PICK_${flashTx}`,
  name: 'PICK',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#............#',
    '#............#',
    '#.S..........#',
    '#............#',
    '#............#',
    '##############',
  ],
  guards: [{ path: [{ tx: 6, ty: 4 }], waitTicks: 6000, facing: 0, kind: 'SENTRY' }],
  flashes: [{ tx: flashTx, ty: 4 }],
  loot: { tx: 12, ty: 6 },
  escape: { tx: 12, ty: 1 },
});

describe('눈뽕은 주워야 쓸 수 있고, 쓰면 소진된다', () => {
  it('스폰 칸의 눈뽕을 주우면 소지 상태가 되고 아이템은 사라진다', () => {
    const sim = run(LV_PICKUP(2), 4);
    assert.equal(sim.bodies[0]!.hasFlash, true, '겹쳤는데 줍지 못했다');
    assert.equal(sim.flashes[0]!.taken, true, '주웠는데 아이템이 바닥에 남아 있다');
  });

  it('IN_FLASH 를 세우면 터지고 소지가 풀린다 — 경비가 어지러워진다', () => {
    const sim = run(LV_PICKUP(2), 12, { live: (t) => (t >= 5 ? IN_FLASH : 0) });
    assert.equal(sim.bodies[0]!.hasFlash, false, '터뜨렸는데 아직 들고 있다');
    assert.equal(sim.guards[0]!.dazed > 0, true, '반경 안 경비가 어지러워지지 않았다');
  });

  it('대조군: 멀리 있는 눈뽕은 줍히지 않고, 안 주우면 눌러도 아무 일이 없다', () => {
    const sim = run(LV_PICKUP(11), 12, { live: (t) => (t >= 5 ? IN_FLASH : 0) });
    assert.equal(sim.bodies[0]!.hasFlash, false, '떨어진 곳의 눈뽕을 주웠다');
    assert.equal(sim.flashes[0]!.taken, false, '줍지도 않았는데 아이템이 사라졌다');
    assert.equal(sim.guards[0]!.dazed, 0, '들고 있지 않은데 눈뽕이 터졌다');
  });

  it('한 번 쓰면 다시 누를 것이 없다 (두 번째 IN_FLASH 는 무효)', () => {
    // 첫 폭발 뒤 어지러움이 다 풀린 다음 다시 눌러 본다.
    const sim = run(LV_PICKUP(2), FLASH_TICKS + 40, {
      live: (t) => (t === 5 || t === FLASH_TICKS + 20 ? IN_FLASH : 0),
    });
    assert.equal(sim.bodies[0]!.hasFlash, false);
    assert.equal(sim.guards[0]!.dazed, 0, '두 번째 폭발이 일어났다 — 1회용이 아니다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 반경과 시야 — 벽 뒤는 안 걸린다
// ══════════════════════════════════════════════════════════════════════════

/**
 * (2,4)에서 터뜨린다. 세 경비의 배치:
 *  · 가까운 경비 (5,4)  — 반경 안 · 사이에 벽 없음   → 걸린다
 *  · 벽 뒤 경비  (5,1)  — 반경 안 · 사이가 벽(3,1)·(4,1) → 안 걸린다
 *  · 먼 경비    (12,4) — 반경 밖                     → 안 걸린다
 * 전부 동쪽을 보므로 조작 몸을 볼 일이 없다 — 상태를 바꾸는 것은 눈뽕뿐이다.
 */
const LV_WALL: LevelDef = {
  id: 'T_FLASH_WALL',
  name: 'WALL',
  par: 1,
  hint: '',
  tiles: [
    '###############',
    '#..###........#',
    '#..###........#',
    '#.............#',
    '#.S...........#',
    '#.............#',
    '###############',
  ],
  guards: [
    { path: [{ tx: 5, ty: 4 }], waitTicks: 6000, facing: 0, kind: 'SENTRY' },
    { path: [{ tx: 5, ty: 1 }], waitTicks: 6000, facing: 0, kind: 'SENTRY' },
    { path: [{ tx: 12, ty: 4 }], waitTicks: 6000, facing: 0, kind: 'SENTRY' },
  ],
  flashes: [{ tx: 2, ty: 4 }],
  loot: { tx: 12, ty: 5 },
  escape: { tx: 12, ty: 1 },
};

describe('눈뽕은 반경 안이면서 **시야가 통하는** 경비만 어지럽게 한다', () => {
  const sim = run(LV_WALL, 12, { live: (t) => (t >= 5 ? IN_FLASH : 0) });
  const [near, behindWall, far] = sim.guards as [Guard, Guard, Guard];
  const bx = sim.bodies[0]!.x + TILE_SUB / 2;
  const by = sim.bodies[0]!.y + TILE_SUB / 2;

  it('배치 확인: 벽 뒤 경비도 반경 **안**이다 (거리로 걸러진 게 아니다)', () => {
    assert.ok(
      dist2(guardCx(behindWall), guardCy(behindWall), bx, by) <= FLASH_RADIUS * FLASH_RADIUS,
      '벽 뒤 경비가 애초에 반경 밖이라 벽 검증이 되지 않는다',
    );
    assert.ok(
      dist2(guardCx(far), guardCy(far), bx, by) > FLASH_RADIUS * FLASH_RADIUS,
      '먼 경비가 반경 안이라 거리 검증이 되지 않는다',
    );
  });

  it('가까운 경비만 걸리고, 벽 뒤와 반경 밖은 멀쩡하다', () => {
    assert.ok(near.dazed > 0, '반경 안 · 시야 통하는 경비가 안 걸렸다');
    assert.equal(behindWall.dazed, 0, '벽 뒤 경비가 눈뽕에 걸렸다');
    assert.equal(far.dazed, 0, '반경 밖 경비가 눈뽕에 걸렸다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 어지러운 동안 — 감지 0, facing 은 고정 증분으로 계속 돈다
// ══════════════════════════════════════════════════════════════════════════

/** 경비 (6,4)가 **서쪽**을 보고 있어 (2,4)의 조작 몸을 정면으로 본다. */
const LV_FACE = (withFlash: boolean): LevelDef => ({
  id: `T_FLASH_FACE_${withFlash ? 'ON' : 'OFF'}`,
  name: 'FACE',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#............#',
    '#............#',
    '#.S..........#',
    '#............#',
    '#............#',
    '##############',
  ],
  guards: [{ path: [{ tx: 6, ty: 4 }], waitTicks: 6000, facing: 32, kind: 'SENTRY' }],
  flashes: withFlash ? [{ tx: 2, ty: 4 }] : [],
  loot: { tx: 12, ty: 6 },
  escape: { tx: 12, ty: 1 },
});

describe('어지러운 동안 경비는 못 보고 제자리에서 돈다', () => {
  it('대조군: 눈뽕이 없으면 정면의 나는 그대로 잡힌다', () => {
    const sim = run(LV_FACE(false), 400);
    assert.equal(sim.outcome, 'CAPTURED');
  });

  it('감지 게이지가 0 으로 유지되고 facing 이 매 틱 고정 증분으로 돈다', () => {
    const facings: number[] = [];
    let maxDetect = 0;
    const sim = run(LV_FACE(true), FLASH_TICKS, {
      live: (t) => (t === 0 ? 0 : t === 1 ? IN_FLASH : 0),
      onTick: (s, t) => {
        const g = s.guards[0]!;
        if (t < 2) return;
        maxDetect = Math.max(maxDetect, g.detect);
        facings.push(g.facing);
      },
    });
    assert.equal(sim.outcome, 'RUNNING', '어지러운 경비가 나를 잡았다');
    assert.equal(maxDetect, 0, `어지러운 동안 감지 게이지가 올랐다 (${maxDetect})`);
    assert.ok(facings.length > 10, '표본이 너무 적다');
    for (let i = 1; i < facings.length; i++) {
      const step = (facings[i]! - facings[i - 1]! + DIR_STEPS) % DIR_STEPS;
      assert.equal(step, DAZE_SPIN_STEP, `${i}번째 틱의 회전량이 고정 증분이 아니다 (${step})`);
    }
    // 한 바퀴 이상 돌아야 "어지럽다"로 보인다.
    assert.ok(facings.length * DAZE_SPIN_STEP > DIR_STEPS, '한 바퀴도 못 돌았다');
  });

  it('어지러움은 정확히 FLASH_TICKS 만큼이고, 풀리면 다시 잡는다', () => {
    let dazedTicks = 0;
    const sim = run(LV_FACE(true), 600, {
      live: (t) => (t === 1 ? IN_FLASH : 0),
      onTick: (s) => {
        if (s.guards[0]!.dazed > 0) dazedTicks++;
      },
    });
    // 터진 그 틱에 경비 갱신이 이미 1을 소모하므로, 밖에서 관측되는 잔여는
    // `FLASH_TICKS - 1` 이다 (guards.test.ts 의 chasePersist-1 과 같은 규약).
    assert.equal(dazedTicks, FLASH_TICKS - 1, '어지러움 지속이 상수와 다르다');
    assert.equal(sim.outcome, 'CAPTURED', '풀린 뒤에도 영원히 무해하다면 아이템이 너무 세다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. 추격 중이던 경비는 그 자리에서 INVESTIGATE 로 떨어진다
// ══════════════════════════════════════════════════════════════════════════

describe('추격 중 눈뽕을 맞으면 CHASE 에서 INVESTIGATE 로 떨어진다', () => {
  it('완전히 놓치는 게 아니라 잠깐 잃는다', () => {
    // 눈뽕은 들고만 있다가, 경비가 **실제로 추격에 들어간 뒤** 터뜨린다.
    let chaseSeen = false;
    let stateAtFlash = '';
    let firedAt = -1;
    let aliveWhileDazed = true;
    run(LV_FACE(true), 400, {
      live: () => (firedAt >= 0 || !chaseSeen ? 0 : IN_FLASH),
      onTick: (s, t) => {
        const g = s.guards[0]!;
        if (g.state === 'CHASE' && !chaseSeen) chaseSeen = true;
        if (firedAt < 0 && g.dazed > 0) {
          firedAt = t;
          stateAtFlash = g.state;
        }
        if (g.dazed > 0 && !s.bodies[0]!.alive) aliveWhileDazed = false;
      },
    });
    assert.equal(chaseSeen, true, '경비가 추격에 들어가지도 않았다 — 배치가 잘못된 테스트다');
    assert.ok(firedAt > 0, '추격 중에 눈뽕이 터지지 않았다');
    assert.equal(stateAtFlash, 'INVESTIGATE', `추격이 INVESTIGATE 로 떨어지지 않았다 (${stateAtFlash})`);
    // "잠깐 잃는 것"이지 영원히 무해해지는 게 아니다 — 어지러운 동안만 안전하고,
    // 풀린 뒤에는 (이 배치처럼 정면에 그대로 서 있으면) 다시 잡힌다.
    assert.equal(aliveWhileDazed, true, '어지러운 동안에도 잡혔다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. WATCHER 도 어지러우면 경보를 못 울린다
// ══════════════════════════════════════════════════════════════════════════

/**
 * (5,4)의 감시자가 (2,4)의 조작 몸을 정면으로 본다. (5,9)의 SENTRY 는 아래를 보고
 * 있어 스스로는 아무것도 볼 수 없다 — 그가 움직인다면 원인은 경보뿐이다.
 */
const LV_WATCH = (withFlash: boolean): LevelDef => ({
  id: `T_FLASH_WATCH_${withFlash ? 'ON' : 'OFF'}`,
  name: 'WATCH',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#............#',
    '#............#',
    '#.S..........#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '##############',
  ],
  guards: [
    { path: [{ tx: 5, ty: 4 }], waitTicks: 6000, facing: 32, kind: 'WATCHER' },
    { path: [{ tx: 5, ty: 9 }], waitTicks: 6000, facing: 16, kind: 'SENTRY' },
  ],
  flashes: withFlash ? [{ tx: 2, ty: 4 }] : [],
  loot: { tx: 12, ty: 10 },
  escape: { tx: 12, ty: 1 },
});

function watchRun(withFlash: boolean, ticks: number): { alarmed: boolean; dazed: number } {
  let alarmed = false;
  const sim = run(LV_WATCH(withFlash), ticks, {
    live: (t) => (withFlash && t === 1 ? IN_FLASH : 0),
    onTick: (s) => {
      if (s.guards[1]!.state === 'INVESTIGATE') alarmed = true;
    },
  });
  return { alarmed, dazed: sim.guards[0]!.dazed };
}

describe('감시자도 눈뽕에 걸리면 경보를 울리지 못한다', () => {
  it('대조군: 눈뽕이 없으면 감시자가 SENTRY 를 부른다', () => {
    const r = watchRun(false, 120);
    assert.equal(r.alarmed, true, '감시자가 경보를 울리지 않았다 — 배치가 잘못된 테스트다');
  });

  it('어지러운 감시자는 게이지도 못 채우고 경보도 못 울린다', () => {
    const r = watchRun(true, 120);
    assert.ok(r.dazed > 0, '감시자가 어지러워지지 않았다');
    assert.equal(r.alarmed, false, '어지러운 감시자가 경보를 울렸다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. **가장 중요** — 잔상이 녹화된 IN_FLASH 를 그대로 터뜨린다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 경비 (7,4)가 **서쪽**을 보고 복도를 지킨다. 눈뽕은 (4,4) 에 하나뿐이다.
 *
 * 루프 1의 나는 (4,4) 까지 걸어가 눈뽕을 줍고, **64틱에 터뜨리는 것까지 테이프에
 * 녹화**한 뒤 그 자리에 남는다. 루프 2의 나는 그 잔상이 만들어 준 틈으로 복도를 지난다.
 * 대조군은 같은 테이프에서 `IN_FLASH` 비트만 뺀 것이다 — 나머지는 한 틱도 다르지 않다.
 *
 * 아이템이 하나뿐이라 잔상이 먼저 주워 가고, 조작 몸에게는 남지 않는다.
 * 그래서 이 절이 증명하는 것은 정확히 **"과거의 내가 터뜨려 준다"** 이다.
 */
const LV_RELAY: LevelDef = {
  id: 'T_FLASH_RELAY',
  name: 'RELAY',
  par: 2,
  hint: '',
  tiles: [
    '################',
    '#..............#',
    '#..............#',
    '#..............#',
    '#.S............#',
    '#..............#',
    '#..............#',
    '################',
  ],
  guards: [{ path: [{ tx: 7, ty: 4 }], waitTicks: 6000, facing: 32, kind: 'SENTRY' }],
  flashes: [{ tx: 4, ty: 4 }],
  loot: { tx: 14, ty: 6 },
  escape: { tx: 14, ty: 1 },
};

/** 루프 1: 두 타일 걸어가 눈뽕을 줍고, 64틱에 터뜨린 뒤 그 자리에 남는다. */
const RELAY_GHOST = tapeOf([
  [IN_RIGHT, 2 * 16],
  [0, 32],
  [IN_FLASH, 1],
  [0, 400],
]);
/** 대조군: 같은 길이·같은 타이밍이지만 `IN_FLASH` 비트가 없다. */
const RELAY_GHOST_NOFIRE = tapeOf([
  [IN_RIGHT, 2 * 16],
  [0, 433],
]);

/** 루프 2의 나: 잔상이 터뜨린 직후 동쪽으로 걸어 경비 앞을 지난다. */
const relayLive = (t: number): number => (t >= 66 ? IN_RIGHT : 0);

/** 조작 몸이 죽기 전까지 도달한 가장 동쪽 x 와 생존 틱. */
function relayRun(ghost: Tape): { maxX: number; aliveTicks: number; guardX: number } {
  let maxX = 0;
  let aliveTicks = 0;
  const sim = run(LV_RELAY, 320, {
    ghosts: [{ tape: ghost, corpse: false }],
    live: relayLive,
    onTick: (s) => {
      const b = s.bodies[0]!;
      if (!b.alive) return;
      aliveTicks++;
      if (b.x > maxX) maxX = b.x;
    },
  });
  return { maxX, aliveTicks, guardX: sim.guards[0]!.x };
}

describe('잔상이 녹화된 눈뽕을 그대로 터뜨린다 (이 아이템의 존재 이유)', () => {
  it('잔상이 아이템을 줍고, 자기 테이프의 IN_FLASH 로 경비를 어지럽힌다', () => {
    let dazedAt = -1;
    let ghostHadIt = false;
    const sim = run(LV_RELAY, 80, {
      ghosts: [{ tape: RELAY_GHOST, corpse: false }],
      onTick: (s, t) => {
        if (s.bodies[1]!.hasFlash) ghostHadIt = true;
        if (dazedAt < 0 && s.guards[0]!.dazed > 0) dazedAt = t;
      },
    });
    assert.equal(ghostHadIt, true, '잔상이 눈뽕을 줍지 못했다 — 배치가 잘못된 테스트다');
    assert.equal(dazedAt, 64, `잔상이 녹화된 틱(64)에 터뜨리지 않았다 (${dazedAt})`);
    assert.equal(sim.bodies[1]!.hasFlash, false, '잔상이 눈뽕을 소진하지 않았다');
    // 아이템은 하나뿐이다 — 조작 몸은 애초에 들고 있지도 않다.
    assert.equal(sim.bodies[0]!.hasFlash, false);
  });

  it('대조군: 같은 테이프에서 IN_FLASH 비트만 빼면 아무 일도 없다', () => {
    const sim = run(LV_RELAY, 80, {
      ghosts: [{ tape: RELAY_GHOST_NOFIRE, corpse: false }],
    });
    assert.equal(sim.guards[0]!.dazed, 0, '녹화되지 않은 눈뽕이 터졌다');
    assert.equal(sim.bodies[1]!.hasFlash, true, '터뜨리지 않았는데 소지가 풀렸다');
  });

  it('과거의 내가 터뜨린 틈으로 지금의 내가 경비를 지나간다 (대조군: 못 지나간다)', () => {
    const withFire = relayRun(RELAY_GHOST);
    const without = relayRun(RELAY_GHOST_NOFIRE);
    assert.ok(
      without.maxX < without.guardX,
      `눈뽕 없이도 경비를 지나갔다 — 이 배치는 아무것도 증명하지 못한다 (${without.maxX} vs ${without.guardX})`,
    );
    assert.ok(
      withFire.maxX > withFire.guardX,
      `과거의 내가 터뜨렸는데도 경비를 못 지나갔다 (${withFire.maxX} vs ${withFire.guardX})`,
    );
    assert.ok(
      withFire.aliveTicks > without.aliveTicks,
      `눈뽕이 생존 시간을 늘리지 못했다 (${withFire.aliveTicks} vs ${without.aliveTicks})`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. 결정론 — 아이템과 하운드가 얽힌 테이프
// ══════════════════════════════════════════════════════════════════════════

/** 냄새를 쫓는 개 + 눈뽕 + 잔상이 한 레벨에서 전부 도는 배치. */
const LV_MIX: LevelDef = {
  id: 'T_FLASH_MIX',
  name: 'MIX',
  par: 2,
  hint: '',
  tiles: [
    '##################',
    '#................#',
    '#................#',
    '#.S..............#',
    '#................#',
    '#................#',
    '#................#',
    '##################',
  ],
  guards: [
    { path: [{ tx: 9, ty: 3 }, { tx: 14, ty: 3 }], waitTicks: 30, facing: 32, kind: 'HOUND' },
    { path: [{ tx: 9, ty: 6 }], waitTicks: 6000, facing: 32, kind: 'WATCHER' },
  ],
  flashes: [{ tx: 2, ty: 3 }, { tx: 6, ty: 3 }],
  loot: { tx: 16, ty: 6 },
  escape: { tx: 16, ty: 1 },
};

const MIX_GHOST = tapeOf([
  [IN_RIGHT, 64],
  [IN_FLASH, 1],
  [IN_RIGHT, 64],
  [0, 200],
]);

describe('결정론 — 눈뽕과 하운드가 얽힌 테이프', () => {
  it('같은 테이프를 두 번 재생하면 해시가 완전히 일치한다', () => {
    const play = (): { hash: number; tick: number; outcome: string } => {
      const sim = run(LV_MIX, 500, {
        ghosts: [{ tape: MIX_GHOST, corpse: true }],
        live: (t) => (t < 100 ? IN_RIGHT : t === 140 ? IN_FLASH : 0),
      });
      return { hash: hashState(sim), tick: sim.tick, outcome: sim.outcome };
    };
    assert.deepEqual(play(), play());
  });

  it('해시가 새 상태를 실제로 덮는다 — 눈뽕 한 발이 해시를 바꾼다', () => {
    const play = (fire: boolean): number => {
      const sim = run(LV_MIX, 300, {
        ghosts: [{ tape: MIX_GHOST, corpse: true }],
        live: (t) => (t < 100 ? IN_RIGHT : fire && t === 140 ? IN_FLASH : 0),
      });
      return hashState(sim);
    };
    assert.notEqual(play(true), play(false), '눈뽕을 터뜨려도 해시가 같다 — 상태가 해시 밖에 있다');
  });
});
