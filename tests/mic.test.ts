/**
 * LISTEN 모드 회귀 테스트 — 마이크가 결정론을 깨뜨리지 않는다는 증명.
 *
 * 이 게임의 코어는 "잔상 = 저장된 입력 테이프를 매 루프 재실행"이고 재생 오차가
 * 정확히 0 이라는 것이다. 실시간 마이크를 시뮬에 직접 넣으면 매 루프 소리가 달라져
 * 잔상이 매번 다르게 행동하고 게임이 붕괴한다.
 *
 * 그래서 마이크 소리도 **테이프에 녹화**한다: 입력 바이트의 비트 6~7 이 마이크
 * 레벨(0~3)이다. 아래 테스트는 그 설계가 실제로 지켜지는지를 세 각도에서 확인한다.
 *
 *   1. 마이크 비트가 섞인 테이프도 2회 재생 시 상태 해시가 완전히 동일하다.
 *   2. 마이크 레벨이 높은 틱에 소음 이벤트가 실제로 발생하고, 레벨 0 이면 발생하지 않는다.
 *   3. 마이크 비트는 이동 비트를 오염시키지 않는다.
 *
 * 이 파일은 브라우저 API 를 전혀 쓰지 않는다 — `src/engine/mic.ts` 는 시뮬 밖이고,
 * 시뮬이 보는 것은 오직 정수 비트뿐이기 때문이다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  IN_DOWN,
  IN_LEFT,
  IN_MIC_MASK,
  IN_MIC_SHIFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  MIC_NOISE_RADIUS,
  NOISE_INTERVAL,
  NOISE_RADIUS,
  micLevelOf,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import type { LevelDef, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

/** 레벨(0..3)을 입력 마스크의 마이크 비트로. */
function mic(level: number): number {
  return (level & 3) << IN_MIC_SHIFT;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

const MOVE_BITS = [IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_RUN];

/** 이동 비트와 마이크 비트가 **둘 다** 들어 있는, 사람 조작 모양의 무작위 테이프. */
function noisyTape(rnd: () => number, length: number): Tape {
  const out = new Uint16Array(length);
  let move = 0;
  let level = 0;
  let hold = 0;
  for (let i = 0; i < length; i++) {
    if (hold === 0) {
      move = 0;
      const count = rnd() % 3;
      for (let k = 0; k <= count; k++) {
        move |= MOVE_BITS[rnd() % MOVE_BITS.length] ?? 0;
      }
      level = rnd() % 4;
      hold = 4 + (rnd() % 20);
    }
    out[i] = move | mic(level);
    hold--;
  }
  return out;
}

function simulate(level: LevelDef, ghosts: GhostSpec[], live: Tape): { hash: number; tick: number } {
  const s = createWorld(
    level,
    ghosts.map((g) => ({ tape: g.tape, corpse: g.corpse })),
  );
  for (let i = 0; i < live.length && s.outcome === 'RUNNING'; i++) {
    stepWorld(s, live[i]!);
  }
  return { hash: hashState(s), tick: s.tick };
}

// ── 1. 결정론 ──────────────────────────────────────────────────────────────

describe('LISTEN: 마이크 비트가 섞여도 재생 오차는 정확히 0 이다', () => {
  STAGES.forEach((level, stageIndex) => {
    it(`${level.id} ${level.name} — 마이크 포함 테이프 12세트 × 2회 재생, 불일치 0`, () => {
      const rnd = lcg(0x5bf03635 ^ (stageIndex + 1));
      let mismatches = 0;
      for (let i = 0; i < 12; i++) {
        const ghosts: GhostSpec[] = [];
        const ghostCount = rnd() % 4;
        for (let gi = 0; gi < ghostCount; gi++) {
          ghosts.push({
            tape: noisyTape(rnd, 1 + (rnd() % 900)),
            corpse: rnd() % 4 === 0,
          });
        }
        const live = noisyTape(rnd, 1200);
        const a = simulate(level, ghosts, live);
        const b = simulate(level, ghosts, live);
        if (a.hash !== b.hash || a.tick !== b.tick) mismatches++;
      }
      assert.equal(mismatches, 0, `${level.id}: ${mismatches}개 세트에서 상태 해시 불일치`);
    });
  });

  it('잔상은 실시간 소리가 아니라 **녹화된** 마이크 비트를 재생한다', () => {
    // 같은 잔상 테이프 + 같은 조작 입력이면, 조작 몸의 마이크 레벨이 무엇이든
    // 잔상의 궤적은 동일해야 한다. (실시간 마이크가 잔상에 새는 경로가 없다는 확인.)
    const level = STAGES[0]!;
    const ghost: GhostSpec = {
      tape: Uint16Array.from(
        Array.from({ length: 200 }, (_, i) => IN_RIGHT | mic(i % 4)),
      ),
      corpse: false,
    };

    const trace = (liveMicLevel: number): number[] => {
      const s = createWorld(level, [{ tape: ghost.tape, corpse: ghost.corpse }]);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(s, IN_DOWN | mic(liveMicLevel));
        const g = s.bodies[1]!;
        out.push(g.x, g.y);
      }
      return out;
    };

    assert.deepEqual(trace(3), trace(0));
  });
});

// ── 2. 소음 발생 ───────────────────────────────────────────────────────────

/**
 * 조작 몸을 제자리에 세워 둔 채 주어진 마스크로 굴리고, 이번 런에서 발생한
 * 소음 이벤트를 전부 모은다. `s.noises` 는 매 틱 비워지므로 틱마다 걷어야 한다.
 */
function collectNoises(level: LevelDef, mask: number, ticks: number): { radius: number }[] {
  const s = createWorld(level, []);
  const found: { radius: number }[] = [];
  for (let i = 0; i < ticks && s.outcome === 'RUNNING'; i++) {
    stepWorld(s, mask);
    for (const n of s.noises) found.push({ radius: n.radius });
  }
  return found;
}

describe('LISTEN: 마이크 레벨이 소음이 된다', () => {
  // 경비가 없는 THE CELL 에서 재야 소음 → 추격 → 상태 변화가 결과를 흐리지 않는다.
  const cell = STAGES[0]!;
  const TICKS = NOISE_INTERVAL * 4;

  it('레벨 0(대조군)은 소음을 전혀 내지 않는다', () => {
    assert.deepEqual(collectNoises(cell, mic(0), TICKS), []);
  });

  it('레벨 1~3 은 제자리에 서 있어도 소음을 낸다', () => {
    for (const lv of [1, 2, 3]) {
      const noises = collectNoises(cell, mic(lv), TICKS);
      assert.ok(noises.length > 0, `레벨 ${lv} 에서 소음이 발생하지 않았다`);
      const expected = MIC_NOISE_RADIUS[lv] ?? 0;
      for (const n of noises) {
        assert.equal(n.radius, expected, `레벨 ${lv} 의 소음 반경이 ${expected} 가 아니다`);
      }
    }
  });

  it('반경은 레벨에 비례한다', () => {
    const r = [1, 2, 3].map((lv) => collectNoises(cell, mic(lv), TICKS)[0]?.radius ?? 0);
    assert.ok(r[0]! > 0);
    assert.ok(r[0]! < r[1]!, `레벨1(${r[0]}) < 레벨2(${r[1]}) 가 아니다`);
    assert.ok(r[1]! < r[2]!, `레벨2(${r[1]}) < 레벨3(${r[2]}) 가 아니다`);
  });

  it('뛰면서 동시에 소리를 내도 소음 이벤트는 한 번만, 반경은 큰 쪽으로 난다', () => {
    // 달리기 소음(160px)과 마이크 레벨 3(272px)이 겹치는 틱.
    const both = collectNoises(cell, IN_DOWN | IN_RUN | mic(3), NOISE_INTERVAL);
    assert.equal(both.length, 1, `이벤트가 ${both.length}개 — 중복 발생했다`);
    assert.equal(both[0]!.radius, MIC_NOISE_RADIUS[3]);

    // 반대로 마이크가 작으면 달리기 반경이 이긴다.
    const quiet = collectNoises(cell, IN_DOWN | IN_RUN | mic(1), NOISE_INTERVAL);
    assert.equal(quiet.length, 1);
    assert.equal(quiet[0]!.radius, NOISE_RADIUS);
  });

  it('EASY 모드(마이크 비트 0)의 달리기 소음은 기존과 완전히 동일하다', () => {
    const runOnly = collectNoises(cell, IN_DOWN | IN_RUN, NOISE_INTERVAL * 3);
    assert.equal(runOnly.length, 3);
    for (const n of runOnly) assert.equal(n.radius, NOISE_RADIUS);
  });
});

// ── 3. 비트 오염 없음 ──────────────────────────────────────────────────────

describe('LISTEN: 마이크 비트는 이동 비트를 오염시키지 않는다', () => {
  const cell = STAGES[0]!;

  /** 40틱 동안의 조작 몸 좌표 궤적. */
  function walk(mask: number): number[] {
    const s = createWorld(cell, []);
    const out: number[] = [];
    for (let i = 0; i < 40; i++) {
      stepWorld(s, mask);
      const b = s.bodies[0]!;
      out.push(b.x, b.y, b.facing);
    }
    return out;
  }

  it('레벨 3 을 얹어도 이동 결과가 한 서브픽셀도 달라지지 않는다', () => {
    for (const move of [IN_DOWN, IN_RIGHT, IN_DOWN | IN_RIGHT, IN_DOWN | IN_RUN]) {
      assert.deepEqual(
        walk(move | mic(3)),
        walk(move),
        `이동 마스크 ${move} 가 마이크 비트에 오염되었다`,
      );
    }
  });

  it('비트 배치가 서로 겹치지 않는다', () => {
    const MOVE_ALL = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT | 16 | IN_RUN;
    assert.equal(MOVE_ALL & IN_MIC_MASK, 0, '이동/상호작용 비트와 마이크 비트가 겹친다');
    assert.equal(IN_MIC_MASK, 192);
    assert.equal(IN_MIC_SHIFT, 6);
    for (let lv = 0; lv <= 3; lv++) {
      assert.equal(micLevelOf(MOVE_ALL | mic(lv)), lv);
    }
    // 이동 + 마이크는 여전히 **한 바이트 안**이다. 테이프가 16비트로 넓어진 것은
    // 눈뽕(비트 8) 때문이며, 마이크 비트 배치는 한 칸도 움직이지 않았다.
    assert.ok((MOVE_ALL | mic(3)) <= 255);
  });
});
