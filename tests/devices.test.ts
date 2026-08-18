/**
 * 신규 장치 4종 QA — grate / laser / seqButton / powerBus.
 *
 * 각 장치마다 **대조군**을 함께 둔다. "되는 것"만 보면 규칙이 아니라 우연을 검증하게 된다:
 * 격자는 서 있으면 무음이어야 하고, 레이저는 OFF 일 때 안전해야 하며, 순차 버튼은
 * 틀린 순서에 리셋되어야 하고, 전력 버스는 이긴 쪽만 켜야 한다.
 *
 * 마지막 두 블록은 장치 자체가 아니라 **시스템 보증**이다:
 * - 결정론: 네 장치를 모두 쓰는 레벨에서 같은 테이프를 두 번 재생하면 매 틱 상태가 같다.
 * - 무영향: 신규 장치를 쓰지 않는 레벨의 해시는 이 장치들이 없던 시절의 값과 **정확히 같다**
 *   (아래 GOLDEN_* 는 변경 전 시뮬을 그대로 돌려 뽑은 값이다).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GRATE_NOISE_INTERVAL,
  GRATE_NOISE_RADIUS,
  IN_DOWN,
  IN_INTERACT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  NOISE_INTERVAL,
  NOISE_RADIUS,
} from '../src/sim/constants';
import { segmentHitsRect } from '../src/sim/devices';
import { hashState } from '../src/sim/hash';
import type { LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';
import { D, E, L, O, R, RUN, U, driveWaypoints, seg, tape, tiles } from './tapes';

// ── 공용 헬퍼 ──────────────────────────────────────────────────────────────

interface NoiseHit {
  tick: number;
  count: number;
  radius: number;
}

/** 매 틱 소음을 훑는다. 소음이 난 틱만 남긴다. */
function collectNoises(
  level: LevelDef,
  ghosts: GhostSpec[],
  ticks: number,
  live: (t: number) => number,
): { hits: NoiseHit[]; sim: SimState } {
  const sim = createWorld(level, ghosts);
  const hits: NoiseHit[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(sim, live(t));
    if (sim.noises.length > 0) {
      hits.push({ tick: t, count: sim.noises.length, radius: sim.noises[0]!.radius });
    }
  }
  return { hits, sim };
}

function runTape(level: LevelDef, ghosts: GhostSpec[], t: Tape): SimState {
  const sim = createWorld(level, ghosts);
  for (let i = 0; i < t.length && sim.outcome === 'RUNNING'; i++) {
    stepWorld(sim, t[i]!);
  }
  return sim;
}

const OPEN_ROOM = [
  '############',
  '#..........#',
  '#.S........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '############',
];

// ══════════════════════════════════════════════════════════════════════════
// 1. grate — 소음 바닥
// ══════════════════════════════════════════════════════════════════════════

/** (2,2)~(9,2) 한 줄이 금속 격자다. 스폰이 그 위다. */
const LV_GRATE: LevelDef = {
  id: 'T_GRATE',
  name: 'GRATE',
  par: 1,
  hint: '',
  tiles: OPEN_ROOM,
  grates: [{ tx: 2, ty: 2, w: 8, h: 1 }],
  loot: { tx: 10, ty: 5 },
  escape: { tx: 10, ty: 1 },
};

/** 격자만 없는 같은 방. 기존 달리기 소음의 대조군이다. */
const LV_NOGRATE: LevelDef = { ...LV_GRATE, id: 'T_NOGRATE', grates: undefined };

describe('grate — 소음 바닥', () => {
  it('격자 위를 걸으면 GRATE_NOISE_INTERVAL 마다 128px 소음이 난다', () => {
    const { hits } = collectNoises(LV_GRATE, [], 40, () => R);
    assert.deepEqual(
      hits.map((h) => h.tick),
      [9, 19, 29, 39],
    );
    for (const h of hits) {
      assert.equal(h.count, 1, '한 틱에 소음은 하나');
      assert.equal(h.radius, GRATE_NOISE_RADIUS);
    }
    assert.equal(GRATE_NOISE_INTERVAL, 10);
  });

  it('대조군 — 격자 위에 그냥 서 있으면 완전히 무음이다', () => {
    const { hits } = collectNoises(LV_GRATE, [], 40, () => O);
    assert.deepEqual(hits, []);
  });

  it('대조군 — 격자를 벗어나 걸으면 무음이다 (걷기는 원래 무음)', () => {
    // 앞 32틱은 격자를 빠져나오는 구간이라 세지 않는다.
    const { hits } = collectNoises(LV_GRATE, [], 72, (t) => (t < 32 ? D : R));
    assert.equal(
      hits.filter((h) => h.tick >= 32).length,
      0,
      '격자 밖 걷기는 소리를 내면 안 된다',
    );
  });

  it('달리기와 겹쳐도 소음은 한 틱에 하나, 반경은 큰 쪽이다', () => {
    const { hits } = collectNoises(LV_GRATE, [], 40, () => R | RUN);
    // 간격은 짧은 쪽(10), 반경은 큰 쪽(달리기 160px).
    assert.deepEqual(
      hits.map((h) => h.tick),
      [9, 19, 29, 39],
    );
    for (const h of hits) {
      assert.equal(h.count, 1, '달리기 소음과 격자 소음이 둘로 늘면 안 된다');
      assert.equal(h.radius, NOISE_RADIUS);
    }
    assert.ok(NOISE_RADIUS > GRATE_NOISE_RADIUS);
  });

  it('대조군 — 격자 없는 방의 달리기는 기존 그대로다 (12틱 간격, 160px)', () => {
    const { hits } = collectNoises(LV_NOGRATE, [], 40, () => R | RUN);
    assert.deepEqual(
      hits.map((h) => h.tick),
      [11, 23, 35],
    );
    for (const h of hits) {
      assert.equal(h.count, 1);
      assert.equal(h.radius, NOISE_RADIUS);
    }
    assert.equal(NOISE_INTERVAL, 12);
  });

  it('잔상도 격자 위에서 소리를 낸다 — 테이프가 소음까지 재생한다', () => {
    const ghost: Tape = tape([seg(R, 40)]);
    const { hits } = collectNoises(LV_GRATE, [{ tape: ghost, corpse: false }], 40, () => O);
    assert.deepEqual(
      hits.map((h) => h.tick),
      [9, 19, 29, 39],
    );
    for (const h of hits) assert.equal(h.radius, GRATE_NOISE_RADIUS);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. laser — 주기 레이저
// ══════════════════════════════════════════════════════════════════════════

function laserLevel(
  id: string,
  periodTicks: number,
  onTicks: number,
  extra: Partial<LevelDef> = {},
  disableChannel?: string,
): LevelDef {
  return {
    id,
    name: 'LASER',
    par: 1,
    hint: '',
    tiles: OPEN_ROOM,
    lasers: [
      {
        from: { tx: 5, ty: 1 },
        to: { tx: 5, ty: 4 },
        periodTicks,
        onTicks,
        disableChannel,
      },
    ],
    loot: { tx: 10, ty: 5 },
    escape: { tx: 10, ty: 1 },
    ...extra,
  };
}

const LV_LASER_ALWAYS = laserLevel('T_LASER_ON', 100, 100);
const LV_LASER_NEVER = laserLevel('T_LASER_OFF', 100, 0);
const LV_LASER_DISABLED = laserLevel('T_LASER_DIS', 100, 100, {
  levers: [{ tx: 2, ty: 5, channel: 'kill', on: true }],
}, 'kill');

/** 위상이 다른 두 레이저. 주기 판정이 순수 함수인지 본다. */
const LV_LASER_CYCLE: LevelDef = {
  id: 'T_LASER_CYCLE',
  name: 'CYCLE',
  par: 1,
  hint: '',
  tiles: OPEN_ROOM,
  lasers: [
    { from: { tx: 5, ty: 1 }, to: { tx: 5, ty: 4 }, periodTicks: 60, onTicks: 30 },
    {
      from: { tx: 8, ty: 1 },
      to: { tx: 8, ty: 4 },
      periodTicks: 60,
      onTicks: 30,
      phase: 15,
    },
  ],
  loot: { tx: 10, ty: 5 },
  escape: { tx: 10, ty: 1 },
};

/** (2,2) → (5,2). 48틱이면 몸이 x=45056 의 레이저 선을 확실히 물고 있다. */
const WALK_INTO_LASER: Tape = tape([seg(R, tiles(3))]);

describe('laser — 주기 레이저', () => {
  it('선분 × AABB 판정이 정수 SAT 로 정확하다', () => {
    // 세로선 x=100, y 0..200 / 박스 (90,50)-(110,70) → 관통
    assert.equal(segmentHitsRect(100, 0, 100, 200, 90, 50, 20, 20), true);
    // 같은 선, 박스가 오른쪽으로 비켜 있음
    assert.equal(segmentHitsRect(100, 0, 100, 200, 101, 50, 20, 20), false);
    // 대각선이 박스 모서리를 스치기만 하는 경우 — 법선축이 갈라낸다
    assert.equal(segmentHitsRect(0, 0, 100, 100, 60, 0, 20, 20), false);
    assert.equal(segmentHitsRect(0, 0, 100, 100, 40, 40, 20, 20), true);
    // 선분이 박스 앞에서 끝나면 닿지 않는다 (박스 X/Y 축이 갈라낸다)
    assert.equal(segmentHitsRect(0, 0, 30, 0, 50, -10, 20, 20), false);
  });

  it('(tick + phase) % period < onTicks 대로만 켜진다 — 난수 없음', () => {
    const sim = createWorld(LV_LASER_CYCLE, []);
    for (let t = 0; t < 180; t++) {
      stepWorld(sim, O);
      assert.equal(sim.lasers[0]!.on, t % 60 < 30, `tick ${t} laser0`);
      assert.equal(sim.lasers[1]!.on, (t + 15) % 60 < 30, `tick ${t} laser1`);
    }
  });

  it('ON 인 레이저에 닿은 조작 몸은 즉사한다 (CAPTURED)', () => {
    const sim = runTape(LV_LASER_ALWAYS, [], WALK_INTO_LASER);
    assert.equal(sim.outcome, 'CAPTURED');
    assert.equal(sim.bodies[0]!.alive, false);
    assert.equal(sim.alerts, 1);
  });

  it('대조군 — OFF 인 레이저는 같은 자리에서 안전하다', () => {
    const sim = runTape(LV_LASER_NEVER, [], WALK_INTO_LASER);
    assert.equal(sim.outcome, 'RUNNING');
    assert.equal(sim.bodies[0]!.alive, true);
    const b = sim.bodies[0]!;
    // "지나갔다"가 아니라 "겹쳤는데 안전했다"임을 못 박는다.
    const l = sim.lasers[0]!;
    assert.equal(
      segmentHitsRect(l.x0, l.y0, l.x1, l.y1, b.x, b.y, 6144, 6144),
      true,
      '몸이 실제로 레이저 선분과 겹쳐 있어야 대조군이 성립한다',
    );
  });

  it('잔상은 발각만 되고 재생을 이어간다 — 시체가 되면 판정 대상에서 빠진다', () => {
    const ghost: Tape = tape([seg(R, tiles(3))]); // 48틱 뒤 테이프 종료 → 시체
    const sim = createWorld(LV_LASER_ALWAYS, [{ tape: ghost, corpse: true }]);
    const spottedTicks: number[] = [];
    for (let t = 0; t < 90; t++) {
      const ev = stepWorld(sim, O);
      if (ev.ghostSpotted) spottedTicks.push(t);
    }
    assert.ok(spottedTicks.length > 0, '살아있는 동안에는 레이저가 잔상을 잡아야 한다');
    assert.ok(
      spottedTicks.every((t) => t < ghost.length),
      `테이프가 끝난 뒤(시체)에는 판정되면 안 된다: ${spottedTicks.join(',')}`,
    );
    const g = sim.bodies[1]!;
    assert.equal(g.alive, false, '테이프 종료 → 시체');
    const l = sim.lasers[0]!;
    assert.equal(
      segmentHitsRect(l.x0, l.y0, l.x1, l.y1, g.x, g.y, 6144, 6144),
      true,
      '시체가 레이저 위에 그대로 있어야 "판정 안 됨"이 의미를 갖는다',
    );
    assert.equal(sim.outcome, 'RUNNING', '잔상이 맞아도 루프는 끝나지 않는다');
  });

  it('disableChannel 이 ON 이면 레이저가 무력화된다', () => {
    const sim = runTape(LV_LASER_DISABLED, [], WALK_INTO_LASER);
    assert.equal(sim.lasers[0]!.on, false);
    assert.equal(sim.outcome, 'RUNNING');
    assert.equal(sim.bodies[0]!.alive, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. seqButton — 순차 버튼
// ══════════════════════════════════════════════════════════════════════════

const LV_SEQ: LevelDef = {
  id: 'T_SEQ',
  name: 'SEQ',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#.S..........#',
    '#............#',
    '#............#',
    '##############',
  ],
  seqButtons: [
    { tx: 4, ty: 2, group: 'seq', order: 0 },
    { tx: 7, ty: 2, group: 'seq', order: 1 },
    { tx: 10, ty: 2, group: 'seq', order: 2 },
  ],
  gates: [{ tx: 12, ty: 2, channel: 'seq' }],
  loot: { tx: 12, ty: 4 },
  escape: { tx: 12, ty: 1 },
};

const SEQ_AT = (tx: number): { tx: number; ty: number; press: boolean } => ({
  tx,
  ty: 2,
  press: true,
});

describe('seqButton — 순차 버튼', () => {
  it('올바른 순서로 누르면 그룹 채널이 ON 된다', () => {
    const { sim } = driveWaypoints(LV_SEQ, [SEQ_AT(4), SEQ_AT(7), SEQ_AT(10)]);
    assert.equal(sim.seqGroups.length, 1);
    assert.equal(sim.seqGroups[0]!.done, true);
    assert.equal(sim.channels.get('seq'), true);
    assert.equal(sim.gates[0]!.open, true);
  });

  it('대조군 — 틀린 순서로 누르면 그룹이 0 으로 리셋된다', () => {
    // 1 → 0 → 2. 첫 press 에서 리셋, 두 번째로 0 을 맞히지만 마지막 2 에서 또 리셋.
    const { sim } = driveWaypoints(LV_SEQ, [SEQ_AT(7), SEQ_AT(4), SEQ_AT(10)]);
    assert.equal(sim.seqGroups[0]!.done, false);
    assert.equal(sim.seqGroups[0]!.next, 0, '틀린 순서는 진행도를 0 으로 되돌린다');
    assert.equal(sim.channels.get('seq'), false);
    assert.equal(sim.gates[0]!.open, false);
  });

  it('대조군 — 중간까지만 맞히면 채널은 켜지지 않는다', () => {
    const { sim } = driveWaypoints(LV_SEQ, [SEQ_AT(4), SEQ_AT(7)]);
    assert.equal(sim.seqGroups[0]!.done, false);
    assert.equal(sim.seqGroups[0]!.next, 2);
    assert.equal(sim.channels.get('seq'), false);
  });

  it('완성한 뒤에는 다시 눌러도 꺼지지 않는다', () => {
    const { sim } = driveWaypoints(LV_SEQ, [
      SEQ_AT(4),
      SEQ_AT(7),
      SEQ_AT(10),
      SEQ_AT(4), // 완성 후 엉뚱한 순서로 재입력
      SEQ_AT(7),
    ]);
    assert.equal(sim.seqGroups[0]!.done, true);
    assert.equal(sim.channels.get('seq'), true);
  });

  it('잔상이 순서를 눌러도 되고, 잔상이 멈춘 뒤에도 채널은 유지된다', () => {
    const { tape: solved } = driveWaypoints(LV_SEQ, [
      SEQ_AT(4),
      SEQ_AT(7),
      SEQ_AT(10),
    ]);
    const sim = createWorld(LV_SEQ, [{ tape: solved, corpse: false }]);
    for (let t = 0; t < 1200; t++) stepWorld(sim, O);
    assert.equal(sim.bodies[1]!.frozen, true, '누른 잔상은 이미 멈춰 있어야 한다');
    assert.equal(sim.seqGroups[0]!.done, true);
    assert.equal(sim.channels.get('seq'), true);
    assert.equal(sim.gates[0]!.open, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. powerBus — 전력 채널
// ══════════════════════════════════════════════════════════════════════════

function busLevel(id: string, channels: string[], bothOn: boolean): LevelDef {
  return {
    id,
    name: 'BUS',
    par: 1,
    hint: '',
    tiles: [
      '##############',
      '#............#',
      '#.S..........#',
      '#............#',
      '#............#',
      '##############',
    ],
    levers: [
      { tx: 4, ty: 2, channel: 'a', on: bothOn },
      { tx: 8, ty: 2, channel: 'b', on: bothOn },
    ],
    gates: [
      { tx: 12, ty: 1, channel: 'a' },
      { tx: 12, ty: 3, channel: 'b' },
    ],
    powerBuses: [{ bus: 'p', channels }],
    loot: { tx: 11, ty: 4 },
    escape: { tx: 12, ty: 4 },
  };
}

const LV_BUS = busLevel('T_BUS', ['a', 'b'], false);
const LV_BUS_TIE_AB = busLevel('T_BUS_AB', ['a', 'b'], true);
const LV_BUS_TIE_BA = busLevel('T_BUS_BA', ['b', 'a'], true);

const LEVER_A = { tx: 4, ty: 2, press: true };
const LEVER_B = { tx: 8, ty: 2, press: true };

describe('powerBus — 전력 채널', () => {
  it('버스에 묶인 채널은 하나만 켜진다 — 나중에 켠 쪽이 전력을 가져간다', () => {
    const first = driveWaypoints(LV_BUS, [LEVER_A]).sim;
    assert.equal(first.channels.get('a'), true);
    assert.equal(first.channels.get('b'), false);
    assert.equal(first.gates[0]!.open, true);
    assert.equal(first.gates[1]!.open, false);

    const second = driveWaypoints(LV_BUS, [LEVER_A, LEVER_B]).sim;
    assert.equal(second.channels.get('a'), false, 'b 가 켜지면 a 는 강제 OFF');
    assert.equal(second.channels.get('b'), true);
    assert.equal(second.gates[0]!.open, false);
    assert.equal(second.gates[1]!.open, true);
    // 소스 자체는 여전히 ON 을 요청하고 있다 — 꺼진 건 전력이지 레버가 아니다.
    assert.equal(second.levers[0]!.on, true);
    assert.equal(second.levers[1]!.on, true);
  });

  it('동시에 켜지면 channels 배열의 앞선 인덱스가 이긴다 (이름순이 아니다)', () => {
    const ab = createWorld(LV_BUS_TIE_AB, []);
    assert.equal(ab.channels.get('a'), true);
    assert.equal(ab.channels.get('b'), false);
    assert.equal(ab.powerBuses[0]!.activeIndex, 0);

    const ba = createWorld(LV_BUS_TIE_BA, []);
    assert.equal(ba.channels.get('b'), true, "channels:['b','a'] 면 b 가 이긴다");
    assert.equal(ba.channels.get('a'), false);
    assert.equal(ba.powerBuses[0]!.activeIndex, 0);
  });

  it('전력을 쥔 채널이 요청을 놓으면 남은 요청자가 이어받는다', () => {
    // a 가 전력을 쥔 상태에서 레버 a 를 꺼 버린다. b 는 계속 요청 중이었다.
    const sim = driveWaypoints(LV_BUS_TIE_AB, [LEVER_A]).sim;
    assert.equal(sim.levers[0]!.on, false, '레버 a 를 껐다');
    assert.equal(sim.channels.get('a'), false);
    assert.equal(sim.channels.get('b'), true);
    assert.equal(sim.powerBuses[0]!.activeIndex, 1);
  });

  it('아무도 요청하지 않으면 버스는 비어 있다', () => {
    const sim = createWorld(LV_BUS, []);
    assert.equal(sim.powerBuses[0]!.activeIndex, -1);
    assert.equal(sim.channels.get('a'), false);
    assert.equal(sim.channels.get('b'), false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 결정론 — 네 장치를 모두 쓰는 합성 레벨
// ══════════════════════════════════════════════════════════════════════════

const LV_ALL: LevelDef = {
  id: 'T_ALL',
  name: 'ALL DEVICES',
  par: 3,
  hint: '',
  tiles: [
    '################',
    '#..............#',
    '#.S............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '################',
  ],
  grates: [{ tx: 3, ty: 2, w: 4, h: 1 }],
  lasers: [
    {
      from: { tx: 9, ty: 1 },
      to: { tx: 9, ty: 5 },
      periodTicks: 70,
      onTicks: 25,
      phase: 11,
      disableChannel: 'las',
    },
  ],
  seqButtons: [
    { tx: 3, ty: 5, group: 'las', order: 0 },
    { tx: 6, ty: 5, group: 'las', order: 1 },
  ],
  levers: [
    { tx: 3, ty: 6, channel: 'a' },
    { tx: 6, ty: 6, channel: 'b' },
  ],
  powerBuses: [{ bus: 'p', channels: ['a', 'b'] }],
  gates: [
    { tx: 14, ty: 3, channel: 'a' },
    { tx: 14, ty: 5, channel: 'b' },
  ],
  crates: [{ tx: 8, ty: 3 }],
  guards: [
    {
      path: [
        { tx: 12, ty: 1 },
        { tx: 12, ty: 6 },
      ],
      waitTicks: 15,
      facing: 16,
    },
  ],
  cctvs: [{ tx: 11, ty: 1, baseFacing: 16, sweepArc: 6, sweepTicks: 90, phase: 3 }],
  loot: { tx: 14, ty: 1 },
  escape: { tx: 14, ty: 6 },
};

/**
 * 격자 위를 지나 → 순차 버튼 2개를 순서대로 → 레버 b → 레버 a.
 * 네 장치가 모두 상태를 바꾸는 경로다 (아래에서 실제로 바뀌었는지 함께 확인한다).
 */
const ALL_TAPE: Tape = tape([
  seg(R, tiles(3)), // 격자 위 이동 → 소음
  seg(D, tiles(3)),
  seg(L, tiles(2)), // (3,5) 순차 버튼 order 0
  seg(E, 1),
  seg(O, 1),
  seg(R, tiles(3)), // (6,5) 순차 버튼 order 1 → 그룹 완성 → 레이저 무력화
  seg(E, 1),
  seg(O, 1),
  seg(D, tiles(1)), // (6,6) 레버 b
  seg(E, 1),
  seg(O, 1),
  seg(L, tiles(3)), // (3,6) 레버 a → 버스 전력 탈취
  seg(E, 1),
  seg(O, 1),
  seg(O, 120),
]);

const ALL_GHOST: Tape = tape([
  seg(D, tiles(2)),
  seg(R, tiles(4)),
  seg(U, tiles(1)),
  seg(RUN | R, 60),
]);

/** hash.ts 는 신규 장치를 모르므로, 여기서 신규 상태를 덧붙여 비교한다. */
function fullHash(s: SimState): string {
  const lasers = s.lasers.map((l) => `${l.id}:${l.on ? 1 : 0}`).join(',');
  const groups = s.seqGroups
    .map((g) => `${g.group}:${g.next}:${g.done ? 1 : 0}`)
    .join(',');
  const buses = s.powerBuses
    .map((b) => `${b.bus}:${b.activeIndex}:${b.prevOn.map((v) => (v ? 1 : 0)).join('')}`)
    .join(',');
  const grates = s.grates.map((g) => `${g.id}:${g.x},${g.y},${g.w},${g.h}`).join(',');
  return `${hashState(s)}|${lasers}|${groups}|${buses}|${grates}`;
}

function traceAll(): string[] {
  const sim = createWorld(LV_ALL, [{ tape: ALL_GHOST, corpse: false }]);
  const out: string[] = [];
  for (let t = 0; t < ALL_TAPE.length; t++) {
    stepWorld(sim, ALL_TAPE[t]!);
    out.push(fullHash(sim));
  }
  return out;
}

describe('결정론 — 네 장치 합성 레벨', () => {
  it('같은 테이프를 두 번 재생하면 매 틱 상태가 완전히 일치한다', () => {
    const a = traceAll();
    const b = traceAll();
    assert.equal(a.length, ALL_TAPE.length);
    assert.deepEqual(a, b);
  });

  it('그 재생 동안 네 장치가 실제로 상태를 바꾼다 (검증이 공회전하지 않는다)', () => {
    const sim = createWorld(LV_ALL, [{ tape: ALL_GHOST, corpse: false }]);
    let laserToggles = 0;
    let grateNoises = 0;
    let doneAtTick = -1;
    const busStates: number[] = [];
    let prevLaser = sim.lasers[0]!.on;

    for (let t = 0; t < ALL_TAPE.length; t++) {
      stepWorld(sim, ALL_TAPE[t]!);
      const l = sim.lasers[0]!;
      if (l.on !== prevLaser) {
        laserToggles++;
        prevLaser = l.on;
      }
      for (const n of sim.noises) {
        if (n.radius === GRATE_NOISE_RADIUS) grateNoises++;
      }
      if (doneAtTick < 0 && sim.seqGroups[0]!.done) doneAtTick = t;
      const ai = sim.powerBuses[0]!.activeIndex;
      if (busStates[busStates.length - 1] !== ai) busStates.push(ai);
      if (doneAtTick >= 0) {
        assert.equal(l.on, false, `그룹 완성 후 tick ${t} 에 레이저가 살아있다`);
      }
    }

    assert.ok(laserToggles > 0, `레이저가 켜졌다 꺼져야 한다 (toggles=${laserToggles})`);
    assert.ok(grateNoises > 0, `격자 소음이 나야 한다 (count=${grateNoises})`);
    assert.ok(doneAtTick > 0, '순차 버튼 그룹이 완성돼야 한다');
    // 아무것도 없음 → b → a 로 전력이 옮겨간다.
    assert.deepEqual(busStates, [-1, 1, 0]);
    assert.equal(sim.outcome, 'RUNNING');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. 무영향 보증 — 신규 장치를 쓰지 않는 레벨의 해시는 변하지 않는다
// ══════════════════════════════════════════════════════════════════════════

/**
 * 기존 장치를 전부(발판·버튼·레버·게이트·상자·경비·CCTV) 쓰는 레거시 레벨.
 * 스테이지 데이터는 레벨 설계가 계속 손보는 중이므로, 회귀 기준은 여기 고정해 둔다.
 */
const LV_LEGACY: LevelDef = {
  id: 'T_LEGACY',
  name: 'LEGACY',
  par: 1,
  hint: '',
  tiles: [
    '################',
    '#..............#',
    '#.S............#',
    '#......#.......#',
    '#..........#...#',
    '#..........#...#',
    '#..............#',
    '#..............#',
    '################',
  ],
  plates: [{ tx: 4, ty: 6, channel: 'p' }],
  buttons: [{ tx: 3, ty: 2, channel: 'q', holdTicks: 90 }],
  levers: [{ tx: 6, ty: 6, channel: 'r' }],
  gates: [
    { tx: 7, ty: 4, channel: 'p' },
    { tx: 11, ty: 6, channel: 'q' },
  ],
  crates: [{ tx: 5, ty: 3 }],
  guards: [
    {
      path: [
        { tx: 12, ty: 2 },
        { tx: 12, ty: 6 },
      ],
      waitTicks: 20,
      facing: 16,
    },
  ],
  cctvs: [
    {
      tx: 9,
      ty: 1,
      baseFacing: 16,
      sweepArc: 8,
      sweepTicks: 120,
      phase: 7,
      disableChannel: 'r',
    },
  ],
  loot: { tx: 13, ty: 7 },
  escape: { tx: 14, ty: 1 },
};

function lcgMasks(seed0: number, n: number): number[] {
  const out: number[] = [];
  let seed = seed0 >>> 0;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out.push(((seed >>> 16) & 0x1f) | IN_RUN);
  }
  return out;
}

/** 상자를 밀고 → CCTV 밑에서 락을 채우고 → 알람 → 경비 추격 → 체포. */
function scriptedLegacy(): number[] {
  const out: number[] = [];
  const push = (mask: number, n: number): void => {
    for (let i = 0; i < n; i++) out.push(mask);
  };
  push(IN_DOWN, 16);
  push(IN_RIGHT, 64);
  push(IN_UP, 16);
  push(IN_RIGHT, 64);
  push(0, 60);
  push(0, 80);
  return out;
}

function legacyRun(
  live: readonly number[],
  every: number,
  ghostLen: number,
): number[] {
  const ghost: Tape = Uint16Array.from(lcgMasks(777, ghostLen));
  const sim = createWorld(LV_LEGACY, [{ tape: ghost, corpse: true }]);
  const out: number[] = [];
  for (let t = 0; t < live.length; t++) {
    stepWorld(sim, live[t]!);
    if ((t + 1) % every === 0) out.push(hashState(sim));
  }
  out.push(sim.outcome === 'CAPTURED' ? 1 : sim.outcome === 'CLEARED' ? 2 : 0);
  out.push(sim.alerts);
  return out;
}

/**
 * 아래 두 배열은 **grate/laser/seqButton/powerBus 가 존재하지 않던 시점의 시뮬**로
 * 뽑은 값이다. 신규 장치 코드가 기존 경로에 한 틱이라도 개입하면 여기서 깨진다.
 *
 * 재기준선 (경비 유형 4종 + AI 개선): 경비 AI 를 의도적으로 바꿨으므로 **중간 상태
 * 해시만** 갱신했다. 근거는 배열의 꼬리 두 칸이다 — 시나리오 결과(CAPTURED=1)와
 * 알람 수(2), 그리고 GOLDEN_RANDOM 의 (0,0) 은 **변경 전과 동일하다.** 즉 장치 경로가
 * 아니라 경비의 매 틱 좌표·상태가 달라졌을 뿐이다. 달라진 것: 순찰/추격 속도(384/512
 * → 416/576), 감지 감쇠(2 → 1), 대기 중 두리번거리기, INVESTIGATE 의 주변 훑기,
 * 그리고 `hashState` 가 새 경비 필드(kind·searchStep·chaseTimer 등)를 함께 섞는 것.
 * 이 배열은 여전히 "신규 장치가 기존 경로에 개입하지 않는다"는 회귀만 지킨다.
 *
 * 재기준선 (냄새 추적 HOUND + 눈뽕): 이번에는 **행동이 아니라 `hashState` 만** 바뀌었다.
 * 이 레벨의 경비는 유형 미지정 = SENTRY 하나뿐이라 새 코드 경로(tracksScent·dazed)를
 * 한 줄도 타지 않는다. 근거는 두 가지다:
 *   ① 꼬리 두 칸(CAPTURED=1·알람 2 / 0·0)이 그대로다.
 *   ② `hashState` 를 전혀 쓰지 않는 행동 디지스트(경비/바디/상자의 매 틱 좌표·상태·
 *      타이머)를 이 시나리오 그대로 변경 전후로 돌려 **완전히 동일**함을 확인했다.
 *      같은 도구에서 SENTRY/BRUTE/WATCHER 는 추격·체포가 걸리는 배치에서도 동일했고
 *      HOUND 만 달라졌다 — 즉 이 배열이 움직인 이유는 해시가 궤적·눈뽕·dazed 를
 *      새로 덮기 때문이지 기존 경로가 바뀌어서가 아니다.
 */
const GOLDEN_SCRIPTED = [
  2953203601, 2274205597, 2811272739, 3410525751, 169724092, 2281099580, 1, 2,
];
const GOLDEN_RANDOM = [
  3830199066, 2543638844, 106651318, 892514971, 763708128, 2713705673, 0, 0,
];

describe('무영향 보증 — 장치를 쓰지 않는 레벨', () => {
  it('상자·CCTV·알람·추격·체포가 도는 시나리오 해시가 변경 전과 같다', () => {
    assert.deepEqual(legacyRun(scriptedLegacy(), 50, 120), GOLDEN_SCRIPTED);
  });

  it('600틱 무작위 입력(달리기 소음 포함) 해시가 변경 전과 같다', () => {
    assert.deepEqual(legacyRun(lcgMasks(12345, 600), 100, 300), GOLDEN_RANDOM);
  });

  it('신규 장치를 안 쓰면 엔티티 id 도 한 개도 소비되지 않는다', () => {
    const sim = createWorld(LV_LEGACY, []);
    assert.deepEqual(
      [
        sim.grates.length,
        sim.lasers.length,
        sim.seqButtons.length,
        sim.seqGroups.length,
        sim.powerBuses.length,
      ],
      [0, 0, 0, 0, 0],
    );
    // id 4번부터 시작 + 상자1·경비1·CCTV1·발판1·버튼1·레버1·게이트2·loot·escape = 10개
    assert.equal(sim.nextId, 14);
  });

  it('신규 장치는 상호작용 후보 순위도 바꾸지 않는다 (레버가 그대로 잡힌다)', () => {
    const sim = createWorld(LV_LEGACY, []);
    // (6,6) 레버 옆 (6,5) 로 걸어가 E — 기존과 동일하게 레버가 토글되어야 한다.
    const t = tape([seg(D, tiles(3)), seg(R, tiles(4)), seg(E, 1)]);
    for (let i = 0; i < t.length; i++) stepWorld(sim, t[i]!);
    assert.equal(sim.levers[0]!.on, true);
    assert.equal(sim.cctvs[0]!.enabled, false, '레버 r 이 CCTV 를 끈다');
  });

  it('간섭 대상이 아닌 상수는 그대로다', () => {
    assert.equal(NOISE_INTERVAL, 12);
    assert.equal(NOISE_RADIUS, 160 * 256);
    assert.equal(IN_INTERACT, 16);
    assert.equal(L | R | U | D, 15);
  });
});
