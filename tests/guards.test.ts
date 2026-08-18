/**
 * 경비 유형 4종 + AI 개선 회귀 테스트 (SPEC §5.3 확장).
 *
 * 이 파일의 원칙: **대조군 없는 주장은 쓰지 않는다.**
 * "BRUTE 가 통로를 못 지난다"는 SENTRY 가 같은 통로를 지나는 것을 함께 보여야
 * 크기 때문이라는 뜻이 되고, "두리번거려서 감지한다"는 두리번거리지 않는 facing
 * 으로는 원뿔 안에 들어오지도 않는다는 것을 함께 보여야 스윕 때문이라는 뜻이 된다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALERT_RADIUS,
  BODY_SUB,
  DETECT_MAX,
  GUARD_KINDS,
  GUARD_SWEEP_ARC,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  SEARCH_OFFSETS,
  SUBPIXEL,
  TILE_SUB,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import { dist2, inCone } from '../src/sim/physics';
import type { Guard, GuardKind, LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

const KINDS: readonly GuardKind[] = ['SENTRY', 'HOUND', 'BRUTE', 'WATCHER'];

function tileCenter(t: number): number {
  return t * TILE_SUB + TILE_SUB / 2;
}
function guardCx(g: Guard): number {
  return g.x + g.sizeSub / 2;
}
function guardCy(g: Guard): number {
  return g.y + g.sizeSub / 2;
}

/** 정해진 틱만큼 굴린다. `live` 가 없으면 조작 몸은 가만히 서 있는다. */
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

// ══════════════════════════════════════════════════════════════════════════
// 1. 4종이 실제로 다르게 동작한다
// ══════════════════════════════════════════════════════════════════════════

/** 장애물 없는 넓은 방. 유형 차이만 남기려고 벽을 최소화했다. */
function openRoom(spawnTx: number, spawnTy: number, kind: GuardKind, facing: number): LevelDef {
  const rows: string[] = [];
  const W = 18;
  const H = 12;
  for (let ty = 0; ty < H; ty++) {
    if (ty === 0 || ty === H - 1) {
      rows.push('#'.repeat(W));
      continue;
    }
    const cells: string[] = ['#'];
    for (let tx = 1; tx < W - 1; tx++) {
      cells.push(tx === spawnTx && ty === spawnTy ? 'S' : '.');
    }
    cells.push('#');
    rows.push(cells.join(''));
  }
  return {
    id: `T_OPEN_${kind}`,
    name: 'OPEN',
    par: 1,
    hint: '',
    tiles: rows,
    guards: [{ path: [{ tx: 2, ty: 4 }], waitTicks: 6000, facing, kind }],
    loot: { tx: 16, ty: 10 },
    escape: { tx: 16, ty: 1 },
  };
}

describe('경비 유형 4종 — 속도·시야·크기가 실제로 갈린다', () => {
  it('몸 크기가 유형마다 다르고, 그 값이 그대로 충돌 박스가 된다', () => {
    const sizes = KINDS.map((k) => createWorld(openRoom(16, 10, k, 0), []).guards[0]!.sizeSub);
    assert.deepEqual(sizes, [26 * SUBPIXEL, 24 * SUBPIXEL, 40 * SUBPIXEL, 28 * SUBPIXEL]);
    assert.equal(new Set(sizes).size, 4, '네 유형의 몸 크기가 서로 달라야 한다');
  });

  it('같은 순찰 경로를 같은 시간 달렸을 때 도달 거리가 유형마다 다르다', () => {
    // 순찰 목적지만 (14,4) 로 바꾼 같은 방. 조작 몸은 반대쪽 구석에서 가만히 있는다.
    const walked = KINDS.map((k) => {
      const lv = openRoom(16, 10, k, 0);
      lv.guards = [{ path: [{ tx: 2, ty: 4 }, { tx: 14, ty: 4 }], waitTicks: 30, facing: 0, kind: k }];
      const sim = run(lv, 120);
      const g = sim.guards[0]!;
      assert.equal(g.state, 'PATROL', `${k}: 순찰 중이 아니다 — 배치가 잘못된 테스트다`);
      return guardCx(g) - tileCenter(2);
    });
    // SENTRY 416 < HOUND 480 이고 BRUTE 256 은 둘보다 느리다. WATCHER 는 아예 안 움직인다.
    assert.ok(walked[1]! > walked[0]!, `HOUND 가 SENTRY 보다 느리다: ${walked[1]} vs ${walked[0]}`);
    assert.ok(walked[0]! > walked[2]!, `SENTRY 가 BRUTE 보다 느리다: ${walked[0]} vs ${walked[2]}`);
    assert.equal(walked[3], 0, 'WATCHER 가 자리를 떴다');
  });

  it('시야 거리: 8타일 앞의 몸은 WATCHER 만 본다 (나머지 셋은 사거리 밖)', () => {
    // 경비 (2,4) 정면(+X) 8타일 = 256px. SENTRY 224 / HOUND 176 / BRUTE 192 는 못 미친다.
    const detects = KINDS.map((k) => run(openRoom(10, 4, k, 0), 8).guards[0]!.detect);
    assert.deepEqual(
      detects.map((d) => d > 0),
      [false, false, false, true],
      `사거리 구분 실패: ${detects.join(',')}`,
    );
  });

  it('시야 각: 정면에서 45° 벗어난 몸은 SENTRY·BRUTE 만 본다', () => {
    // (2,4) 기준 (5,7) = 델타 (3,3) 타일 → 45°, 거리 4.24타일(136px)로 넷 다 사거리 안이다.
    // 반각: SENTRY 50°·BRUTE 65° 는 들어오고, HOUND 35°·WATCHER 40° 는 못 들어온다.
    const detects = KINDS.map((k) => run(openRoom(5, 7, k, 0), 3).guards[0]!.detect);
    assert.deepEqual(
      detects.map((d) => d > 0),
      [true, false, true, false],
      `시야각 구분 실패: ${detects.join(',')}`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. BRUTE 는 1타일 통로를 통과하지 못한다 (대조군: SENTRY 는 통과한다)
// ══════════════════════════════════════════════════════════════════════════

/**
 * 좌우 두 방을 잇는 유일한 통로가 (5,4) 한 칸뿐인 맵.
 * 26px 인 SENTRY 는 32px 통로에 들어가고, 40px 인 BRUTE 는 들어가지 못한다.
 * 코드 어디에도 "BRUTE 면 통로 금지" 같은 규칙은 없다 — `sweepAxis` 가 클램프할 뿐이다.
 */
const LV_CORRIDOR = (kind: GuardKind): LevelDef => ({
  id: `T_CORRIDOR_${kind}`,
  name: 'CORRIDOR',
  par: 1,
  hint: '',
  // 조작 몸은 경비 **바로 뒤**(1,4)에 세운다. 스윕 최대치(±56°)로도 등 뒤 180° 는
  // 원뿔에 들어오지 않으므로, 이 테스트에서 경비를 움직이는 것은 순찰뿐이다.
  tiles: [
    '##############',
    '#....#.......#',
    '#....#.......#',
    '#....#.......#',
    '#S...........#', // (5,4) 만 뚫려 있다
    '#....#.......#',
    '#....#.......#',
    '##############',
  ],
  guards: [{ path: [{ tx: 2, ty: 4 }, { tx: 10, ty: 4 }], waitTicks: 30, facing: 0, kind }],
  loot: { tx: 12, ty: 6 },
  escape: { tx: 12, ty: 1 },
});

describe('BRUTE 는 몸이 커서 1타일 통로를 못 지난다 (대조군: SENTRY)', () => {
  /** 400틱 동안 도달한 **최대** x. 왕복 순찰이라 최종 위치로는 통과 여부를 못 잰다. */
  const reach = (kind: GuardKind): number => {
    let max = 0;
    run(LV_CORRIDOR(kind), 400, {
      onTick: (s) => {
        const cx = guardCx(s.guards[0]!);
        if (cx > max) max = cx;
      },
    });
    return max;
  };

  it('SENTRY 는 통로를 통과해 오른쪽 방까지 간다', () => {
    const cx = reach('SENTRY');
    assert.ok(cx > tileCenter(6), `SENTRY 가 통로를 못 지났다 (최대 cx=${cx} <= ${tileCenter(6)})`);
  });

  it('BRUTE 는 같은 통로 앞에서 막힌다', () => {
    const cx = reach('BRUTE');
    assert.ok(
      cx < tileCenter(5),
      `BRUTE 가 1타일 통로를 지나갔다 (최대 cx=${cx} >= 통로 중심 ${tileCenter(5)})`,
    );
  });

  it('막힘의 근거는 특수 규칙이 아니라 충돌 박스다', () => {
    // 40px 몸은 32px 타일보다 크므로 통로 타일에 정렬해도 위아래 벽에 반드시 물린다.
    assert.ok(GUARD_KINDS.BRUTE.sizeSub > TILE_SUB, 'BRUTE 몸이 타일보다 작으면 이 유형의 의미가 없다');
    assert.ok(GUARD_KINDS.SENTRY.sizeSub < TILE_SUB, 'SENTRY 몸이 타일보다 크면 대조군이 성립하지 않는다');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. WATCHER 는 체포하지 않는다 (대조군: SENTRY 는 체포한다)
// ══════════════════════════════════════════════════════════════════════════

/** 경비 정면 1타일 앞에 조작 몸이 서 있다 — 감지 게이지가 확실히 가득 찬다. */
const LV_FACEOFF = (kind: GuardKind): LevelDef => ({
  id: `T_FACEOFF_${kind}`,
  name: 'FACEOFF',
  par: 1,
  hint: '',
  tiles: [
    '##########',
    '#........#',
    '#........#',
    '#..S.....#',
    '#........#',
    '##########',
  ],
  guards: [{ path: [{ tx: 2, ty: 3 }], waitTicks: 6000, facing: 0, kind }],
  loot: { tx: 8, ty: 4 },
  escape: { tx: 8, ty: 1 },
});

describe('WATCHER 는 손을 대지 않는다 (대조군: SENTRY 는 체포한다)', () => {
  it('SENTRY 는 정면 1타일 앞의 I 를 추격해 체포한다', () => {
    const sim = run(LV_FACEOFF('SENTRY'), 300);
    assert.equal(sim.outcome, 'CAPTURED');
    assert.equal(sim.bodies[0]!.alive, false);
  });

  it('WATCHER 는 게이지가 가득 차고 몸과 겹쳐도 체포하지 않는다', () => {
    let overlapped = false;
    const sim = run(LV_FACEOFF('WATCHER'), 300, {
      onTick: (s) => {
        const g = s.guards[0]!;
        const b = s.bodies[0]!;
        if (
          g.x < b.x + BODY_SUB &&
          b.x < g.x + g.sizeSub &&
          g.y < b.y + BODY_SUB &&
          b.y < g.y + g.sizeSub
        ) {
          overlapped = true;
        }
      },
    });
    assert.equal(sim.guards[0]!.detect, DETECT_MAX, 'WATCHER 가 감지조차 못 했다');
    assert.notEqual(sim.guards[0]!.state, 'CHASE', 'WATCHER 가 추격 상태에 들어갔다');
    assert.equal(sim.outcome, 'RUNNING', 'WATCHER 가 루프를 끝냈다');
    assert.equal(sim.bodies[0]!.alive, true);
    // 감시자는 자리를 뜨지 않으므로 겹칠 일 자체가 없다 — 그것도 함께 기록해 둔다.
    assert.equal(overlapped, false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. WATCHER 의 경보가 다른 경비를 부른다
// ══════════════════════════════════════════════════════════════════════════

/**
 * (2,4) 의 감시자가 (3,4) 의 I 를 본다. (2,9) 의 SENTRY 는 아래를 보고 있어
 * 스스로는 I 를 볼 수 없다 — 움직인다면 원인은 경보뿐이다.
 */
const LV_ALARM = (watcher: boolean): LevelDef => ({
  id: `T_ALARM_${watcher ? 'ON' : 'OFF'}`,
  name: 'ALARM',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#............#',
    '#............#',
    '#..S.........#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '##############',
  ],
  guards: [
    // 감시자를 끄는 대조군에서는 시야를 반대(-X)로 돌려 아무것도 못 보게 한다.
    { path: [{ tx: 2, ty: 4 }], waitTicks: 6000, facing: watcher ? 0 : 32, kind: 'WATCHER' },
    { path: [{ tx: 2, ty: 9 }], waitTicks: 6000, facing: 16, kind: 'SENTRY' },
  ],
  loot: { tx: 12, ty: 10 },
  escape: { tx: 12, ty: 1 },
});

describe('WATCHER 의 경보로 다른 경비가 그 지점으로 움직인다', () => {
  it('경보 반경 안의 SENTRY 가 INVESTIGATE 로 전환되어 그 지점으로 간다', () => {
    let investigated = false;
    let anchor = { x: 0, y: 0 };
    const startY = createWorld(LV_ALARM(true), []).guards[1]!.y;
    const sim = run(LV_ALARM(true), 200, {
      onTick: (s) => {
        const g = s.guards[1]!;
        if (g.state === 'INVESTIGATE' && !investigated) {
          investigated = true;
          anchor = { x: g.anchorX, y: g.anchorY };
        }
      },
    });
    assert.equal(investigated, true, 'SENTRY 가 경보에 반응하지 않았다');
    // 경보 지점은 감시자가 본 몸의 위치 = (3,4) 근처다.
    assert.ok(
      dist2(anchor.x, anchor.y, tileCenter(3), tileCenter(4)) <= TILE_SUB * TILE_SUB,
      `경보 지점이 목격 지점과 다르다: ${anchor.x},${anchor.y}`,
    );
    assert.ok(sim.guards[1]!.y < startY, 'SENTRY 가 경보 지점 쪽으로 이동하지 않았다');
    assert.ok(
      dist2(guardCx(sim.guards[0]!), guardCy(sim.guards[0]!), anchor.x, anchor.y) <=
        ALERT_RADIUS * ALERT_RADIUS,
      '테스트 배치가 경보 반경을 벗어났다',
    );
  });

  it('대조군: 감시자가 아무것도 못 보면 SENTRY 는 제자리에서 순찰만 한다', () => {
    const startY = createWorld(LV_ALARM(false), []).guards[1]!.y;
    const sim = run(LV_ALARM(false), 200, {
      onTick: (s) => {
        assert.notEqual(s.guards[1]!.state, 'INVESTIGATE', '경보가 없는데 수색을 시작했다');
      },
    });
    assert.equal(sim.guards[1]!.y, startY);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. HOUND 는 SENTRY 보다 추격을 오래 끈다
// 7. INVESTIGATE 는 도착 후 주변을 훑는다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 왼쪽 위 벽감(1,1)-(1,2) 에 조작 몸이 갇혀 있고, 잔상만 밖으로 나와 활동한다.
 * (2,1)·(2,2) 벽이 벽감 안쪽 시선을 완전히 끊으므로 **경비가 볼 수 있는 대상은
 * 잔상뿐**이다. 잔상 테이프가 끝나 시체가 되면 경비의 시야에서 대상이 사라진다 —
 * "놓친 뒤 얼마나 오래 버티는가"를 다른 변수 없이 잴 수 있는 유일한 배치다.
 */
const LV_ALCOVE = (kind: GuardKind, facing: number, guardTx: number): LevelDef => ({
  id: `T_ALCOVE_${kind}_${facing}_${guardTx}`,
  name: 'ALCOVE',
  par: 1,
  hint: '',
  tiles: [
    '################',
    '#S#............#',
    '#.#............#',
    '#..............#',
    '#..............#',
    '################',
  ],
  guards: [{ path: [{ tx: guardTx, ty: 3 }], waitTicks: 6000, facing, kind }],
  loot: { tx: 14, ty: 4 },
  escape: { tx: 14, ty: 1 },
});

/** 벽감에서 내려와 오른쪽으로 4타일 걷고 그 자리에 서는 잔상. */
function walkOutGhost(stand: number): Tape {
  const out: number[] = [];
  const push = (mask: number, n: number): void => {
    for (let i = 0; i < n; i++) out.push(mask);
  };
  push(2 /* IN_DOWN */, 32); // (1,1) → (1,3)
  push(IN_RIGHT, 64); // → (5,3)
  push(0, stand);
  return Uint8Array.from(out);
}

/**
 * 벽감에서 내려와 **정확히 12틱만** 달리는 잔상 → 소음 이벤트가 딱 한 번 난다.
 * 그 틱에 테이프가 끝나 시체가 되므로, 이후 경비를 움직이는 원인은 그 한 번의 소음뿐이다.
 */
function oneNoiseGhost(): Tape {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) out.push(2 /* IN_DOWN */);
  for (let i = 0; i < 12; i++) out.push(IN_RIGHT | IN_RUN);
  return Uint8Array.from(out);
}

/** 잔상이 시체가 된 뒤 경비가 CHASE 로 버틴 틱 수. */
function chaseTicksAfterLoss(kind: GuardKind): number {
  // 1차: 언제 CHASE 에 들어가는지만 본다 (잔상은 넉넉히 살려 둔다).
  let chaseStart = -1;
  run(LV_ALCOVE(kind, 32, 10), 900, {
    ghosts: [{ tape: walkOutGhost(700), corpse: true }],
    onTick: (s, t) => {
      if (chaseStart < 0 && s.guards[0]!.state === 'CHASE') chaseStart = t;
    },
  });
  assert.ok(chaseStart >= 0, `${kind}: 추격에 들어가지도 않았다 — 배치가 잘못된 테스트다`);

  // 2차: 추격 시작 직후 잔상을 시체로 만들어 시야에서 지운다.
  //      길이는 1차에서 나온 값으로 정해지므로 이 테스트도 완전히 결정론적이다.
  const len = chaseStart + 5;
  let chased = 0;
  let sawCorpse = false;
  run(LV_ALCOVE(kind, 32, 10), len + 700, {
    ghosts: [{ tape: walkOutGhost(700).slice(0, len), corpse: true }],
    onTick: (s) => {
      if (!s.bodies[1]!.alive) sawCorpse = true;
      if (sawCorpse && s.guards[0]!.state === 'CHASE') chased++;
    },
  });
  assert.ok(chased > 0, `${kind}: 시체가 된 뒤 추격이 한 틱도 이어지지 않았다`);
  return chased;
}

describe('HOUND 는 한번 물면 오래 쫓는다 (대조군: SENTRY)', () => {
  it('시야에서 사라진 뒤 CHASE 를 유지한 틱 수가 HOUND > SENTRY', () => {
    const sentry = chaseTicksAfterLoss('SENTRY');
    const hound = chaseTicksAfterLoss('HOUND');
    assert.ok(
      hound > sentry,
      `HOUND(${hound}) 가 SENTRY(${sentry}) 보다 오래 쫓지 않았다`,
    );
    // 표의 값이 그대로 나오는지도 못박는다 — 우연히 커진 게 아니어야 한다.
    // 대상이 사라진 그 틱에 이미 카운터가 1 줄어드므로 관측되는 CHASE 틱은 persist-1 이다.
    assert.equal(sentry, GUARD_KINDS.SENTRY.chasePersist - 1);
    assert.equal(hound, GUARD_KINDS.HOUND.chasePersist - 1);
  });
});

describe('INVESTIGATE 는 도착해서 서 있지 않고 주변을 훑는다', () => {
  it('수색 목표가 기준점 + 고정 오프셋들로 차례차례 옮겨간다', () => {
    // 경비는 +X 를 보고 있어 등 뒤의 잔상을 **볼 수 없다**. 움직이는 이유는 소음 한 번뿐이고,
    // 그 소음을 낸 잔상은 같은 틱에 시체가 되어 시야에서 사라진다.
    const targets: string[] = [];
    const positions = new Set<string>();
    let anchorX = -1;
    let anchorY = -1;
    let maxStep = -1;
    let investigatedTicks = 0;
    let episodeOver = false;
    run(LV_ALCOVE('SENTRY', 0, 6), 700, {
      ghosts: [{ tape: oneNoiseGhost(), corpse: true }],
      onTick: (s) => {
        const g = s.guards[0]!;
        // 첫 수색 한 번만 본다. 그 뒤 경비가 벽감의 I 를 찾아내 다시 수색을 시작해도
        // 그건 이 테스트의 대상이 아니다.
        if (episodeOver) return;
        if (g.state !== 'INVESTIGATE') {
          if (investigatedTicks > 0) episodeOver = true;
          return;
        }
        investigatedTicks++;
        if (anchorX < 0) {
          anchorX = g.anchorX;
          anchorY = g.anchorY;
        }
        const key = `${g.targetX},${g.targetY}`;
        if (targets[targets.length - 1] !== key) targets.push(key);
        positions.add(`${g.x},${g.y}`);
        if (g.searchStep > maxStep) maxStep = g.searchStep;
      },
    });
    assert.ok(investigatedTicks > 0, '소음을 듣고도 수색을 시작하지 않았다');
    assert.ok(anchorX >= 0, '수색 기준점이 기록되지 않았다');
    assert.equal(
      maxStep,
      SEARCH_OFFSETS.length - 1,
      `수색 오프셋을 끝까지 훑지 않았다 (maxStep=${maxStep})`,
    );
    // 기준점 → 고정 오프셋 3곳을 **순서대로** 찍는다. 난수였다면 이 배열이 재현되지 않는다.
    assert.deepEqual(
      targets.slice(0, SEARCH_OFFSETS.length + 1),
      [
        `${anchorX},${anchorY}`,
        ...SEARCH_OFFSETS.map((o) => `${anchorX + o.x},${anchorY + o.y}`),
      ],
      `수색 경로가 기준점+고정 오프셋 순서가 아니다: ${targets.join(' / ')}`,
    );
    assert.ok(positions.size >= 3, `수색 중 경비가 사실상 제자리였다 (${positions.size}개 지점)`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. 두리번거리기 — 정면 밖에 있어도 결국 감지된다
// ══════════════════════════════════════════════════════════════════════════

describe('두리번거리기로 정면 밖의 몸도 결국 걸린다', () => {
  /** (2,4) 의 경비 기준 (5,8) = 델타 (3,4) 타일 → 53.1°. 사거리 5타일(160px)로 넉넉하다. */
  const LV_SWEEP = openRoom(5, 8, 'SENTRY', 0);

  it('대조군: 스윕이 없다면 이 각도는 원뿔에 절대 들어오지 않는다', () => {
    const sim = createWorld(LV_SWEEP, []);
    const g = sim.guards[0]!;
    const b = sim.bodies[0]!;
    const dx = b.x + BODY_SUB / 2 - guardCx(g);
    const dy = b.y + BODY_SUB / 2 - guardCy(g);
    const spec = GUARD_KINDS.SENTRY;
    // 경비도 몸도 정지해 있다 → facing 을 바꾸는 것은 스윕뿐이다.
    assert.equal(
      inCone(dx, dy, g.facing, spec.viewRange, spec.fovTan),
      false,
      '기준 facing 으로 이미 보인다 — 스윕을 검증하지 못하는 배치다',
    );
    assert.ok(dx * dx + dy * dy <= spec.viewRange * spec.viewRange, '사거리 밖이라 각도 검증이 무의미하다');
  });

  it('스윕이 돌면 같은 자리의 몸이 감지되고 결국 추격까지 간다', () => {
    let sweptAway = false;
    const sim = run(LV_SWEEP, 400, {
      onTick: (s) => {
        // facing 이 실제로 기준값을 벗어나 흔들리는지도 함께 본다.
        if (s.guards[0]!.state === 'PATROL' && s.guards[0]!.facing !== 0) sweptAway = true;
      },
    });
    assert.equal(sweptAway, true, 'facing 이 한 번도 흔들리지 않았다 (두리번거리기 미동작)');
    assert.ok(sim.guards[0]!.detect > 0 || sim.outcome === 'CAPTURED', '스윕에도 전혀 감지되지 않았다');
    assert.equal(sim.outcome, 'CAPTURED', '감지는 했지만 추격/체포까지 이어지지 않았다');
  });

  it('스윕 폭은 고정 상수이며 좌우 대칭이다', () => {
    const facings = new Set<number>();
    run(openRoom(16, 10, 'SENTRY', 0), 200, {
      onTick: (s) => facings.add(s.guards[0]!.facing),
    });
    // 0 을 중심으로 +arc / -arc 양쪽을 모두 찍어야 한다 (64 스텝 링에서 음수는 64-arc).
    assert.ok(facings.has(GUARD_SWEEP_ARC), `오른쪽 끝(+${GUARD_SWEEP_ARC})까지 돌지 않았다`);
    assert.ok(facings.has(64 - GUARD_SWEEP_ARC), `왼쪽 끝(-${GUARD_SWEEP_ARC})까지 돌지 않았다`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 8·9. 결정론 / 배열 순서 독립
// ══════════════════════════════════════════════════════════════════════════

/** 4종이 전부 나오고 경보가 실제로 전파되는 합성 레벨. */
const LV_MIXED: LevelDef = {
  id: 'T_MIXED',
  name: 'MIXED',
  par: 1,
  hint: '',
  tiles: [
    '##################',
    '#..S.............#',
    '#................#',
    '#......####......#',
    '#................#',
    '#......####......#',
    '#................#',
    '#................#',
    '#................#',
    '##################',
  ],
  guards: [
    { path: [{ tx: 6, ty: 1 }], waitTicks: 6000, facing: 32, kind: 'WATCHER' },
    { path: [{ tx: 8, ty: 7 }, { tx: 14, ty: 7 }], waitTicks: 20, facing: 0, kind: 'SENTRY' },
    { path: [{ tx: 3, ty: 6 }, { tx: 3, ty: 2 }], waitTicks: 20, facing: 48, kind: 'HOUND' },
    { path: [{ tx: 12, ty: 2 }], waitTicks: 40, facing: 16, kind: 'BRUTE' },
  ],
  loot: { tx: 16, ty: 8 },
  escape: { tx: 16, ty: 1 },
};

/** 달리고 멈추기를 반복하는 고정 입력 — 소음·경보·추격이 전부 돈다. */
function mixedTape(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = i % 120;
    if (p < 40) out.push(IN_RIGHT | IN_RUN);
    else if (p < 60) out.push(0);
    else if (p < 100) out.push(IN_LEFT | IN_RUN);
    else out.push(0);
  }
  return out;
}

/** 배열 순서에 의존하지 않는 경비 상태 요약 — id 로 정렬해서 비교한다. */
function guardDigest(s: SimState): string[] {
  return s.guards
    .map((g) => [g.id, g.kind, g.x, g.y, g.facing, g.state, g.detect, g.searchStep, g.chaseTimer].join('|'))
    .sort();
}

describe('결정론 — 4종 + 경보 전파가 도는 레벨', () => {
  it('같은 테이프를 두 번 재생하면 상태 해시가 완전히 일치한다', () => {
    const live = mixedTape(900);
    const play = (): { hash: number; tick: number; alerts: number } => {
      const sim = createWorld(LV_MIXED, [
        { tape: Uint8Array.from(mixedTape(300)), corpse: true },
        { tape: Uint8Array.from(mixedTape(500)), corpse: false },
      ]);
      for (let t = 0; t < live.length && sim.outcome === 'RUNNING'; t++) stepWorld(sim, live[t]!);
      return { hash: hashState(sim), tick: sim.tick, alerts: sim.alerts };
    };
    assert.deepEqual(play(), play());
  });

  it('경보가 실제로 전파되는 레벨인지 확인한다 (테스트가 헛돌지 않게)', () => {
    let alarmed = false;
    const live = mixedTape(900);
    const sim = createWorld(LV_MIXED, [{ tape: Uint8Array.from(mixedTape(300)), corpse: false }]);
    for (let t = 0; t < live.length && sim.outcome === 'RUNNING'; t++) {
      stepWorld(sim, live[t]!);
      // 감시자(id 최소)는 추격하지 않는다. 다른 경비가 수색에 들어가면 원인은 경보/소음이다.
      if (sim.guards.some((g) => g.state === 'INVESTIGATE')) alarmed = true;
    }
    assert.equal(alarmed, true, '합성 레벨에서 아무도 수색에 들어가지 않았다');
  });
});

describe('2패스 보증 — 경비 배열 순서가 결과를 바꾸지 않는다', () => {
  it('s.guards 를 뒤집어 굴려도 id 기준 상태 요약이 완전히 같다', () => {
    const live = mixedTape(600);
    const play = (reverse: boolean): { guards: string[]; outcome: string; alerts: number } => {
      const sim = createWorld(LV_MIXED, [{ tape: Uint8Array.from(mixedTape(400)), corpse: false }]);
      if (reverse) sim.guards.reverse();
      for (let t = 0; t < live.length && sim.outcome === 'RUNNING'; t++) stepWorld(sim, live[t]!);
      return { guards: guardDigest(sim), outcome: sim.outcome, alerts: sim.alerts };
    };
    const a = play(false);
    const b = play(true);
    assert.deepEqual(b, a, '배열 순서를 바꿨더니 결과가 달라졌다 — 갱신이 id 순이 아니다');
    // 요약이 실제로 뭔가를 담고 있는지 확인 (빈 비교로 통과하지 않게).
    assert.equal(a.guards.length, 4);
  });
});
