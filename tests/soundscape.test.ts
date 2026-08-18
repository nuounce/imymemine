/**
 * 정위 오디오 검증 — **DOM 없이 순수 로직만**.
 *
 * `soundscape.ts` 는 WebAudio 를 모른다. 그래서 여기서 증명할 수 있는 것이
 * 곧 이 기능의 전부다: 어느 쪽에서, 얼마나 멀리서, 벽 너머인지, 몇 개까지,
 * 유형마다 얼마나 자주, 얼마나 가쁘게, 모드마다 얼마나 다르게.
 *
 * 마지막 블록(§8)이 가장 중요하다 — 오디오가 `SimState` 를 한 비트도 건드리지
 * 않는다는 것을 해시로 증명한다. 건드리는 순간 잔상 재생이 어긋난다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  breathGain,
  breathPeriod,
  createSoundscape,
  distanceGain,
  limitCues,
  MAX_VOICES,
  MUFFLE_CUTOFF_HZ,
  panOf,
  PAN_SPREAD,
  TUNING,
  updateSoundscape,
  type AudioMode,
  type Cue,
  type CueKind,
  type SoundscapeState,
} from '../src/engine/soundscape';
import { STAGES } from '../src/game/levels';
import { BODY_SUB, DETECT_MAX, IN_RIGHT, IN_RUN, TILE_SUB } from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import type { Body, Guard, GuardKind, LevelDef, SimState } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';

// ── 시험용 방 ──────────────────────────────────────────────────────────────
//
// 24×13. tx=11 의 ty=2..10 이 벽 기둥이라 좌우가 갈린다 — 차폐 대조군을 만드는
// 유일한 목적의 벽이다. 경비 스폰은 전부 ty=1 (그 줄은 끝까지 트여 있다).

const TILES: readonly string[] = [
  '########################',
  '#......................#',
  '#..........#...........#',
  '#..........#...........#',
  '#..........#...........#',
  '#..........#...........#',
  '#...S......#...........#',
  '#..........#...........#',
  '#..........#...........#',
  '#..........#...........#',
  '#..........#...........#',
  '#......................#',
  '########################',
];

/** 리스너를 놓는 기준 타일. 왼쪽 영역의 한복판이라 사방이 트여 있다. */
const LX = 8;
const LY = 6;

function makeLevel(kinds: readonly GuardKind[]): LevelDef {
  return {
    id: 'SND_ROOM',
    name: 'SOUND ROOM',
    par: 3,
    tiles: TILES.slice(),
    hint: '정위 오디오 시험용 방',
    guards: kinds.map((kind, i) => ({ path: [{ tx: 1 + i, ty: 1 }], kind })),
    loot: { tx: 20, ty: 1 },
    escape: { tx: 2, ty: 1 },
  };
}

/** 경비 `kinds.length` 명이 있는 방. 좌표는 테스트가 직접 잡는다. */
function room(kinds: readonly GuardKind[]): SimState {
  const sim = createWorld(makeLevel(kinds), []);
  const live = liveBody(sim);
  putTile(live, LX, LY, BODY_SUB);
  return sim;
}

function liveBody(sim: SimState): Body {
  const b = sim.bodies.find((x) => x.isLive);
  assert.ok(b !== undefined, '조작 중인 몸이 없다');
  return b;
}

/** AABB 좌상단을 타일 중앙 정렬로 놓는다. 중심이 정확히 타일 중심에 온다. */
function putTile(
  e: { x: number; y: number },
  tx: number,
  ty: number,
  sizeSub: number,
): void {
  e.x = tx * TILE_SUB + (TILE_SUB - sizeSub) / 2;
  e.y = ty * TILE_SUB + (TILE_SUB - sizeSub) / 2;
}

function place(g: Guard, tx: number, ty: number): void {
  putTile(g, tx, ty, g.sizeSub);
}

/** `n` 틱 굴린 뒤 **마지막 틱**의 큐 목록. 시뮬은 굴리지 않는다(정지한 장면). */
function cuesAt(st: SoundscapeState, sim: SimState, mode: AudioMode, n: number): Cue[] {
  let last: Cue[] = [];
  for (let i = 0; i < n; i++) last = updateSoundscape(st, sim, mode);
  return last;
}

/** `n` 틱 동안 나온 큐를 전부 모은다. */
function cuesOver(st: SoundscapeState, sim: SimState, mode: AudioMode, n: number): Cue[] {
  const all: Cue[] = [];
  for (let i = 0; i < n; i++) all.push(...updateSoundscape(st, sim, mode));
  return all;
}

function countKind(cues: readonly Cue[], kind: CueKind): number {
  return cues.filter((c) => c.kind === kind).length;
}

function onlyKind(cues: readonly Cue[], kind: CueKind): Cue[] {
  return cues.filter((c) => c.kind === kind);
}

/** WATCHER 는 발소리가 없고 모터음만 내므로 "정지한 소리굽쇠"로 쓰기 좋다. */
const MOTOR_WARMUP = 18;

// ── 1. 패닝 ────────────────────────────────────────────────────────────────

describe('soundscape — 좌우 패닝', () => {
  it('왼쪽 / 오른쪽 / 정면 소리의 pan 부호와 범위가 기대대로다', () => {
    const sim = room(['WATCHER', 'WATCHER', 'WATCHER']);
    const [left, right, front] = sim.guards as [Guard, Guard, Guard];
    place(left, LX - 4, LY); // 왼쪽 4타일
    place(right, LX + 2, LY); // 오른쪽 2타일
    place(front, LX, LY - 4); // 정면(x 차이 0)

    const cues = onlyKind(cuesAt(createSoundscape(), sim, 'LISTEN', MOTOR_WARMUP), 'MOTOR');
    assert.equal(cues.length, 3, `모터음 3개가 나와야 한다: ${JSON.stringify(cues)}`);

    const byId = new Map(cues.map((c) => [c.srcId, c]));
    const l = byId.get(left.id)!;
    const r = byId.get(right.id)!;
    const f = byId.get(front.id)!;

    assert.ok(l.pan < 0, `왼쪽 소리의 pan 이 음수여야 한다 (${l.pan})`);
    assert.ok(r.pan > 0, `오른쪽 소리의 pan 이 양수여야 한다 (${r.pan})`);
    assert.equal(f.pan, 0, `정면 소리의 pan 은 정확히 0 이어야 한다 (${f.pan})`);

    // 값 자체도 확인한다: dx / PAN_SPREAD, [-1, 1] 로 포화.
    assert.equal(l.pan, (-4 * TILE_SUB) / PAN_SPREAD);
    assert.equal(r.pan, (2 * TILE_SUB) / PAN_SPREAD);
    for (const c of cues) assert.ok(c.pan >= -1 && c.pan <= 1, `pan 범위 이탈 ${c.pan}`);
  });

  it('사거리를 넘는 x 차이는 −1 / +1 로 포화한다', () => {
    assert.equal(panOf(-PAN_SPREAD * 3), -1);
    assert.equal(panOf(PAN_SPREAD * 3), 1);
    assert.equal(panOf(0), 0);
  });
});

// ── 2. 거리 감쇠 ───────────────────────────────────────────────────────────

describe('soundscape — 거리 감쇠', () => {
  it('사거리 안에서는 단조 감소하고 사거리 밖은 정확히 0 이다', () => {
    const range = 10 * TILE_SUB;
    let prev = Infinity;
    for (let d = 0; d < range; d += TILE_SUB / 4) {
      const g = distanceGain(d, range);
      assert.ok(g < prev, `거리 ${d} 에서 감쇠가 단조 감소하지 않았다 (${prev} → ${g})`);
      assert.ok(g > 0, `사거리 안(${d})인데 게인이 0 이다`);
      prev = g;
    }
    assert.equal(distanceGain(range, range), 0);
    assert.equal(distanceGain(range + 1, range), 0);
    assert.equal(distanceGain(range * 4, range), 0);
    assert.equal(distanceGain(0, range), 1);
  });

  it('멀리 있는 경비의 소리가 가까운 경비보다 작다', () => {
    const sim = room(['WATCHER', 'WATCHER']);
    const [near, far] = sim.guards as [Guard, Guard];
    place(near, LX - 2, LY);
    place(far, LX - 6, LY);

    const cues = onlyKind(cuesAt(createSoundscape(), sim, 'LISTEN', MOTOR_WARMUP), 'MOTOR');
    const byId = new Map(cues.map((c) => [c.srcId, c]));
    const n = byId.get(near.id)!;
    const f = byId.get(far.id)!;
    assert.ok(n.dist < f.dist);
    assert.ok(f.gain < n.gain, `먼 소리가 더 커졌다 (near ${n.gain} / far ${f.gain})`);
  });
});

// ── 3. 차폐 ────────────────────────────────────────────────────────────────

describe('soundscape — 벽 차폐', () => {
  it('벽 뒤 소리에는 로우패스가 걸리고, 트인 곳 소리에는 걸리지 않는다', () => {
    const sim = room(['WATCHER', 'WATCHER']);
    const [open, behind] = sim.guards as [Guard, Guard];
    place(open, LX - 4, LY); // 같은 방, 트여 있다
    place(behind, LX + 3, LY); // tx=11 벽 기둥 너머

    const cues = onlyKind(cuesAt(createSoundscape(), sim, 'LISTEN', MOTOR_WARMUP), 'MOTOR');
    const byId = new Map(cues.map((c) => [c.srcId, c]));
    const o = byId.get(open.id)!;
    const b = byId.get(behind.id)!;

    assert.equal(o.cutoffHz, null, '트인 곳 소리에 필터가 걸렸다');
    assert.equal(b.cutoffHz, MUFFLE_CUTOFF_HZ, '벽 뒤 소리에 로우패스가 안 걸렸다');
    // 거리는 벽 뒤가 더 가까운데도(3타일 < 4타일) 차폐 때문에 더 작게 들려야 한다.
    assert.ok(b.dist < o.dist);
    assert.ok(b.gain < o.gain, `차폐된 소리가 더 크다 (open ${o.gain} / behind ${b.gain})`);
  });
});

// ── 4. 동시 재생 상한 ──────────────────────────────────────────────────────

describe('soundscape — 동시 재생 상한', () => {
  it('상한을 넘으면 가까운 것이 남는다 (limitCues)', () => {
    const cues: Cue[] = [];
    for (let i = 0; i < MAX_VOICES + 5; i++) {
      cues.push({
        kind: 'FOOT_SENTRY',
        srcId: i,
        pan: 0,
        gain: 0.5,
        cutoffHz: null,
        // 뒤로 갈수록 멀다. 남아야 할 것은 앞의 MAX_VOICES 개.
        dist: (i + 1) * TILE_SUB,
        intensity: 1,
      });
    }
    const kept = limitCues(cues.slice().reverse());
    assert.equal(kept.length, MAX_VOICES);
    assert.deepEqual(
      kept.map((c) => c.srcId),
      Array.from({ length: MAX_VOICES }, (_, i) => i),
    );
  });

  it('경비 14명이 동시에 울면 가까운 12명만 남는다', () => {
    const near: [number, number][] = [
      [LX - 1, LY], [LX + 1, LY], [LX, LY - 1], [LX, LY + 1],
      [LX - 1, LY - 1], [LX + 1, LY - 1], [LX - 1, LY + 1], [LX + 1, LY + 1],
      [LX - 2, LY], [LX + 2, LY], [LX, LY - 2], [LX, LY + 2],
    ];
    const far: [number, number][] = [[1, 2], [1, 10]];
    const spots = [...near, ...far];
    const sim = room(spots.map(() => 'WATCHER'));
    spots.forEach(([tx, ty], i) => place(sim.guards[i]!, tx, ty));

    const cues = cuesAt(createSoundscape(), sim, 'LISTEN', MOTOR_WARMUP);
    assert.equal(cues.length, MAX_VOICES, `상한을 넘겼다: ${cues.length}`);

    const kept = new Set(cues.map((c) => c.srcId));
    for (let i = 0; i < near.length; i++) {
      assert.ok(kept.has(sim.guards[i]!.id), `가까운 경비 #${i} 가 잘렸다`);
    }
    for (let i = near.length; i < spots.length; i++) {
      assert.ok(!kept.has(sim.guards[i]!.id), `먼 경비 #${i} 가 남았다`);
    }
    // 출력은 가까운 순으로 정렬돼 있다.
    for (let i = 1; i < cues.length; i++) {
      assert.ok(cues[i]!.dist >= cues[i - 1]!.dist, '정렬이 깨졌다');
    }
  });
});

// ── 5. 유형별 발소리 주기 ──────────────────────────────────────────────────

describe('soundscape — 유형별 발소리', () => {
  /** 같은 거리를 같은 속도로 움직이게 하고 발소리 수를 센다. */
  function stepsOver(kind: GuardKind, footKind: CueKind, ticks: number): number {
    const sim = room([kind]);
    const g = sim.guards[0]!;
    place(g, LX - 3, LY);
    const st = createSoundscape();
    let count = 0;
    for (let i = 0; i < ticks; i++) {
      // 좌우로 200 서브픽셀씩 흔든다 — 이동 거리는 매 틱 200 으로 일정하다.
      g.x += i % 2 === 0 ? 200 : -200;
      count += countKind(updateSoundscape(st, sim, 'LISTEN'), footKind);
    }
    return count;
  }

  it('HOUND > SENTRY > BRUTE 순으로 발소리가 잦다', () => {
    const ticks = 300;
    const hound = stepsOver('HOUND', 'FOOT_HOUND', ticks);
    const sentry = stepsOver('SENTRY', 'FOOT_SENTRY', ticks);
    const brute = stepsOver('BRUTE', 'FOOT_BRUTE', ticks);

    assert.ok(brute > 0, '무거운 경비도 걷기는 한다');
    assert.ok(
      hound > sentry && sentry > brute,
      `주기가 유형별로 갈리지 않았다 — HOUND ${hound} / SENTRY ${sentry} / BRUTE ${brute}`,
    );
  });

  it('WATCHER 는 발소리 대신 모터음을 낸다', () => {
    const sim = room(['WATCHER']);
    place(sim.guards[0]!, LX - 3, LY);
    const st = createSoundscape();
    const all: Cue[] = [];
    for (let i = 0; i < 120; i++) {
      sim.guards[0]!.x += i % 2 === 0 ? 400 : -400; // 억지로 움직여도
      all.push(...updateSoundscape(st, sim, 'LISTEN'));
    }
    assert.equal(countKind(all, 'FOOT_SENTRY'), 0);
    assert.equal(countKind(all, 'FOOT_BRUTE'), 0);
    assert.equal(countKind(all, 'FOOT_HOUND'), 0);
    assert.ok(countKind(all, 'MOTOR') >= 6, '렌즈 모터음이 계속 나야 한다');
  });

  it('멈춘 경비는 발소리를 내지 않는다', () => {
    const sim = room(['SENTRY']);
    place(sim.guards[0]!, LX - 3, LY);
    const all = cuesOver(createSoundscape(), sim, 'LISTEN', 300);
    assert.equal(countKind(all, 'FOOT_SENTRY'), 0);
  });

  it('HOUND 는 발소리와 별개로 주기적인 숨(킁킁)을 낸다', () => {
    const sim = room(['HOUND']);
    place(sim.guards[0]!, LX - 3, LY);
    const all = cuesOver(createSoundscape(), sim, 'LISTEN', 300);
    assert.ok(countKind(all, 'SNIFF') >= 5, '정지해 있어도 숨은 쉰다');
  });
});

// ── 5-b. 잔상의 소리 ───────────────────────────────────────────────────────

describe('soundscape — 잔상', () => {
  it('움직이는 잔상은 먹먹한 발소리를 내고, 시체는 아무 소리도 내지 않는다', () => {
    const sim = room([]);
    const live = liveBody(sim);
    // 잔상 두 개를 손으로 세운다: 하나는 살아 움직이고, 하나는 시체다.
    const ghost: Body = { ...live, id: 900, slot: 1, isLive: false, tape: null };
    const corpse: Body = { ...live, id: 901, slot: 2, isLive: false, alive: false, tape: null };
    sim.bodies.push(ghost, corpse);
    putTile(ghost, LX - 2, LY, BODY_SUB);
    putTile(corpse, LX + 1, LY, BODY_SUB);

    const st = createSoundscape();
    const all: Cue[] = [];
    for (let i = 0; i < 200; i++) {
      ghost.x += i % 2 === 0 ? 300 : -300;
      corpse.x += i % 2 === 0 ? 300 : -300; // 시체는 움직여도 무음이어야 한다
      all.push(...updateSoundscape(st, sim, 'LISTEN'));
    }

    const ghostSteps = all.filter((c) => c.kind === 'GHOST_FOOT');
    assert.ok(ghostSteps.length > 0, '잔상이 발소리를 내지 않았다');
    assert.ok(
      ghostSteps.every((c) => c.srcId === ghost.id),
      '시체가 소리를 냈다',
    );
    // "과거"임이 귀로 구분돼야 한다 — 트인 곳이어도 항상 로우패스가 걸린다.
    assert.ok(
      ghostSteps.every((c) => c.cutoffHz !== null && c.cutoffHz <= MUFFLE_CUTOFF_HZ),
      '잔상 발소리가 먹먹하지 않다',
    );
  });
});

// ── 6. 숨소리 ──────────────────────────────────────────────────────────────

describe('soundscape — 주인공의 숨', () => {
  it('감지 게이지가 오를수록 숨이 커지고 가빠진다', () => {
    let prevGain = -1;
    let prevPeriod = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const gain = breathGain(t, false, TUNING.LISTEN);
      const period = breathPeriod(t, false);
      assert.ok(gain > prevGain, `게인이 단조 증가하지 않았다 (t=${t})`);
      assert.ok(period <= prevPeriod, `숨 간격이 단조 감소하지 않았다 (t=${t})`);
      prevGain = gain;
      prevPeriod = period;
    }
    assert.ok(breathPeriod(1, false) < breathPeriod(0, false));
    // 달리면 더 거칠고 더 가쁘다.
    assert.ok(breathGain(0.5, true, TUNING.LISTEN) > breathGain(0.5, false, TUNING.LISTEN));
    assert.ok(breathPeriod(0.5, true) < breathPeriod(0.5, false));
  });

  it('실제 감지 게이지가 숨소리 큐에 그대로 실린다', () => {
    function breathOf(detect: number, running: boolean): Cue {
      const sim = room(['SENTRY']);
      place(sim.guards[0]!, LX - 3, LY);
      sim.guards[0]!.detect = detect;
      if (running) liveBody(sim).lastInput = IN_RUN;
      const all = cuesOver(createSoundscape(), sim, 'LISTEN', 200);
      const breaths = onlyKind(all, 'BREATH');
      assert.ok(breaths.length > 0, `숨소리가 안 났다 (detect=${detect})`);
      return breaths[0]!;
    }

    const calm = breathOf(0, false);
    const seen = breathOf(DETECT_MAX, false);
    assert.ok(calm.gain < seen.gain, '발각 중인데 숨이 더 조용하다');
    assert.ok(calm.intensity === 0 && seen.intensity === 1);
    // 안전하면 거의 안 들린다.
    assert.ok(calm.gain < 0.06, `안전할 때 숨이 너무 크다 (${calm.gain})`);

    const running = breathOf(DETECT_MAX, true);
    assert.ok(running.gain > seen.gain, '달리는데 숨이 더 거칠지 않다');
  });

  it('숨소리는 상한에 밀려나지 않는다', () => {
    // 가까운 경비 14명이 울어도 내 숨은 남아야 한다 — 가장 중요한 정보 채널이다.
    const spots: [number, number][] = [
      [LX - 1, LY], [LX + 1, LY], [LX, LY - 1], [LX, LY + 1],
      [LX - 1, LY - 1], [LX + 1, LY - 1], [LX - 1, LY + 1], [LX + 1, LY + 1],
      [LX - 2, LY], [LX + 2, LY], [LX, LY - 2], [LX, LY + 2],
      [LX - 3, LY], [LX + 3, LY],
    ];
    const sim = room(spots.map(() => 'WATCHER'));
    spots.forEach(([tx, ty], i) => place(sim.guards[i]!, tx, ty));
    sim.guards[0]!.detect = DETECT_MAX;

    const st = createSoundscape();
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      found = updateSoundscape(st, sim, 'LISTEN').some((c) => c.kind === 'BREATH');
    }
    assert.ok(found, '경비가 많다고 내 숨이 잘렸다');
  });
});

// ── 7. LISTEN vs EASY ──────────────────────────────────────────────────────

describe('soundscape — 모드 차이', () => {
  it('LISTEN 이 EASY 보다 더 멀리 들린다', () => {
    assert.ok(TUNING.LISTEN.range > TUNING.EASY.range);
    // 9타일 = EASY 사거리 밖, LISTEN 사거리 안.
    const d = 10 * TILE_SUB;
    assert.equal(distanceGain(d, TUNING.EASY.range), 0);
    assert.ok(distanceGain(d, TUNING.LISTEN.range) > 0);
    assert.ok(TUNING.LISTEN.range / TUNING.EASY.range > 1.5);
  });

  it('같은 거리의 같은 소리가 LISTEN 에서 더 크다', () => {
    function gainAt(mode: AudioMode): number {
      const sim = room(['WATCHER']);
      place(sim.guards[0]!, LX - 5, LY);
      const cues = onlyKind(cuesAt(createSoundscape(), sim, mode, MOTOR_WARMUP), 'MOTOR');
      assert.equal(cues.length, 1);
      return cues[0]!.gain;
    }
    const easy = gainAt('EASY');
    const listen = gainAt('LISTEN');
    assert.ok(easy > 0, 'EASY 에서도 정위음은 난다 (재미 요소)');
    assert.ok(listen > easy * 2, `LISTEN 이 충분히 크지 않다 (EASY ${easy} / LISTEN ${listen})`);
  });

  it('LISTEN 의 발소리가 더 촘촘하고 숨소리가 더 강조된다', () => {
    function steps(mode: AudioMode): number {
      const sim = room(['SENTRY']);
      const g = sim.guards[0]!;
      place(g, LX - 2, LY);
      const st = createSoundscape();
      let n = 0;
      for (let i = 0; i < 300; i++) {
        g.x += i % 2 === 0 ? 200 : -200;
        n += countKind(updateSoundscape(st, sim, mode), 'FOOT_SENTRY');
      }
      return n;
    }
    assert.ok(TUNING.LISTEN.strideScale < TUNING.EASY.strideScale);
    assert.ok(steps('LISTEN') > steps('EASY'), '같은 이동인데 발소리 수가 같다');
    assert.ok(
      breathGain(0.5, false, TUNING.LISTEN) > breathGain(0.5, false, TUNING.EASY) * 2,
      '숨소리 강조가 부족하다',
    );
  });
});

// ── 8. 읽기 전용 보증 ──────────────────────────────────────────────────────
//
// 오디오가 SimState 를 건드리면 잔상 재생이 어긋난다. 해시로 못 박는다.

describe('soundscape — 읽기 전용 보증', () => {
  it('updateSoundscape 를 반복 호출해도 SimState 해시가 그대로다', () => {
    const sim = createWorld(STAGES[0]!, []);
    for (let i = 0; i < 120; i++) stepWorld(sim, IN_RIGHT);

    const before = hashState(sim);
    const st = createSoundscape();
    for (let i = 0; i < 300; i++) {
      updateSoundscape(st, sim, 'LISTEN');
      updateSoundscape(st, sim, 'EASY');
    }
    assert.equal(hashState(sim), before, '오디오 계산이 SimState 를 변경했다');
  });

  it('정위 오디오를 끼워 돌린 런과 안 끼운 런의 최종 해시가 같다', () => {
    const inputs: number[] = [];
    for (let i = 0; i < 600; i++) inputs.push(i % 90 < 60 ? IN_RIGHT : IN_RIGHT | IN_RUN);

    const plain = createWorld(STAGES[0]!, []);
    for (const m of inputs) stepWorld(plain, m);

    const withAudio = createWorld(STAGES[0]!, []);
    const st = createSoundscape();
    for (const m of inputs) {
      stepWorld(withAudio, m);
      updateSoundscape(st, withAudio, 'LISTEN');
    }

    assert.equal(hashState(withAudio), hashState(plain), '오디오가 시뮬 경로를 바꿨다');
  });

  it('실제 스테이지를 굴리면 소리가 실제로 난다 (무음 통과 방지)', () => {
    const sim = createWorld(STAGES[0]!, []);
    const st = createSoundscape();
    const all: Cue[] = [];
    for (let i = 0; i < 600; i++) {
      stepWorld(sim, i % 90 < 60 ? IN_RIGHT : IN_RIGHT | IN_RUN);
      all.push(...updateSoundscape(st, sim, 'LISTEN'));
    }
    assert.ok(all.length > 0, '실제 스테이지에서 소리가 하나도 안 났다');
    assert.ok(countKind(all, 'BREATH') > 0, '숨소리가 안 났다');
    for (const c of all) {
      assert.ok(c.gain > 0 && c.gain <= 1, `게인 범위 이탈 ${c.gain}`);
      assert.ok(c.pan >= -1 && c.pan <= 1, `pan 범위 이탈 ${c.pan}`);
    }
  });
});
