/**
 * 결정론 회귀 테스트 (SPEC §4, §10-2).
 *
 * 잔상은 궤적이 아니라 입력 테이프다. 같은 테이프를 두 번 재생했을 때
 * 최종 상태 해시가 1비트라도 다르면 게임의 핵심 mechanic 이 무너진다.
 * 그래서 "거의 같다"가 아니라 **불일치 0** 을 요구한다.
 *
 * 입력은 시드 고정 LCG 로 만든다 — 테스트 자체도 결정론적이어야 재현 가능한 회귀가 된다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  MAX_AFTERIMAGES,
  MAX_TICKS,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import type { LevelDef, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

/** 스테이지당 생성할 무작위 입력 세트 수. 5 스테이지 × 20 = 100 세트. */
const SETS_PER_STAGE = 20;
/** 잔상 테이프는 짧게(조기 확정 전략을 흉내) 만들어 frozen 경로까지 함께 검증한다. */
const GHOST_TICKS = 900;

const ALL_BITS = [IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT, IN_INTERACT, IN_RUN];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** 몇 틱씩 같은 입력을 유지하는, 사람 조작과 비슷한 모양의 무작위 테이프. */
function randomTape(rnd: () => number, length: number): Tape {
  const out = new Uint16Array(length);
  let mask = 0;
  let hold = 0;
  for (let i = 0; i < length; i++) {
    if (hold === 0) {
      mask = 0;
      const count = rnd() % 3;
      for (let k = 0; k <= count; k++) {
        mask |= ALL_BITS[rnd() % ALL_BITS.length]!;
      }
      hold = 4 + (rnd() % 24);
    }
    out[i] = mask;
    hold--;
  }
  return out;
}

interface InputSet {
  ghosts: GhostSpec[];
  live: Tape;
}

function makeSet(rnd: () => number): InputSet {
  const ghostCount = rnd() % (MAX_AFTERIMAGES + 1);
  const ghosts: GhostSpec[] = [];
  for (let i = 0; i < ghostCount; i++) {
    ghosts.push({
      tape: randomTape(rnd, 1 + (rnd() % GHOST_TICKS)),
      corpse: rnd() % 4 === 0,
    });
  }
  return { ghosts, live: randomTape(rnd, MAX_TICKS) };
}

/** 항상 새 월드에서 시작한다 — 상태 재사용으로 결정론이 위장되지 않게. */
function simulate(level: LevelDef, set: InputSet): { hash: number; tick: number } {
  const s = createWorld(
    level,
    set.ghosts.map((g) => ({ tape: g.tape, corpse: g.corpse })),
  );
  for (let i = 0; i < set.live.length && s.outcome === 'RUNNING'; i++) {
    stepWorld(s, set.live[i]!);
  }
  return { hash: hashState(s), tick: s.tick };
}

describe('결정론: 같은 입력 테이프는 같은 최종 상태를 만든다', () => {
  STAGES.forEach((level, stageIndex) => {
    it(`${level.id} ${level.name} — 무작위 ${SETS_PER_STAGE}세트 × 2회 재생, 불일치 0`, () => {
      const rnd = lcg(0x9e3779b9 ^ (stageIndex + 1));
      let mismatches = 0;
      for (let i = 0; i < SETS_PER_STAGE; i++) {
        const set = makeSet(rnd);
        const a = simulate(level, set);
        const b = simulate(level, set);
        if (a.hash !== b.hash || a.tick !== b.tick) mismatches++;
      }
      assert.equal(mismatches, 0, `${level.id}: ${mismatches}개 세트에서 상태 해시 불일치`);
    });
  });

  it('입력이 한 틱만 달라져도 해시가 달라진다 (해시가 상태를 실제로 덮는지 확인)', () => {
    const level = STAGES[0]!;
    // 벽에 클램프되지 않는 짧은 하강. 한 틱을 빼면 정확히 512 서브픽셀 차이가 남는다.
    const straight = new Uint16Array(40).fill(IN_DOWN);
    const skipped = straight.slice();
    skipped[10] = 0;

    const a = simulate(level, { ghosts: [], live: straight });
    const b = simulate(level, { ghosts: [], live: skipped });

    assert.notEqual(a.hash, b.hash);
  });
});
