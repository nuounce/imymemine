/**
 * 플레이 모드 (STORY / GAUNTLET / TIME_ATTACK) 회귀 테스트.
 *
 * 가장 중요한 명제부터 검증한다: **플레이 모드는 시뮬레이션에 닿지 않는다.**
 * 모드는 세션/표시 레이어의 값이므로 `stepWorld` 의 결과가 모드에 따라 1비트라도
 * 달라지면 결정론(SPEC §4)이 무너진다. 그래서 "비슷하다"가 아니라 **상태 해시 동일**을 본다.
 *
 * 나머지는 각 모드가 약속한 성질이다 —
 * GAUNTLET 은 부채가 런을 관통하고, TIME_ATTACK 은 시간이 스테이지를 넘어 합산되며,
 * 두 축(플레이 방식 × 감지 방식)은 서로를 모른다. 그리고 기록 저장이 막힌 브라우저에서도
 * 게임은 죽지 않는다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  commitLoop,
  createSession,
  finishRun,
  fullReset,
  isBetterRun,
  loadBest,
  nextStage,
  PLAY_MODES,
  runTotals,
  saveBest,
  setPlayMode,
  startRun,
  startStage,
  tickSession,
  type Mode,
  type PlayMode,
  type Session,
} from '../src/game/session';
import { LOOP_TRANSITION_TICKS, MAX_AFTERIMAGES } from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import type { Tape } from '../src/sim/types';
import { D, L, O, R, U, seg, tape, tiles } from './tapes';

const MODES: Mode[] = ['EASY', 'LISTEN'];

function newSession(playMode: PlayMode, mode: Mode = 'EASY'): Session {
  const s = createSession();
  s.playMode = playMode;
  s.mode = mode;
  startRun(s, 0);
  return s;
}

function runTicks(s: Session, n: number, mask = 0): void {
  for (let i = 0; i < n; i++) tickSession(s, mask);
}

/** 확정 → 전환 90틱 → 다음 루프 시작까지. */
function commitAndAdvance(s: Session): void {
  commitLoop(s, 'MANUAL');
  runTicks(s, LOOP_TRANSITION_TICKS);
}

// ── 1. 모드는 시뮬레이션에 영향을 주지 않는다 (가장 중요) ─────────────────

/**
 * 1번 스테이지의 실제 정답 흐름을 그대로 태운다:
 * 발판 위에서 조기 확정 → 잔상이 눌러주는 게이트로 통과 → loot → escape.
 * 잔상 재생·확정·클리어·스플릿 기록까지 한 번에 지난다.
 */
const LOOP_1: Tape = tape([seg(L, tiles(1)), seg(D, tiles(3)), seg(O, 4)]);
const LOOP_2: Tape = tape([
  seg(D, tiles(1)),
  seg(R, tiles(11)),
  seg(U, tiles(2)),
  seg(D, tiles(4)),
]);

interface Trace {
  /** 25틱마다 찍은 시뮬 상태 해시 + 마지막 상태. */
  marks: number[];
  finalHash: number;
  tick: number;
  ghosts: number;
  phase: string;
  splits: string;
}

function traceScript(playMode: PlayMode, mode: Mode): Trace {
  const s = newSession(playMode, mode);
  const marks: number[] = [];
  const play = (t: Tape): void => {
    for (const m of t) {
      tickSession(s, m);
      if (s.sim.tick % 25 === 0) marks.push(hashState(s.sim));
    }
  };

  play(LOOP_1);
  commitAndAdvance(s);
  play(LOOP_2);

  return {
    marks,
    finalHash: hashState(s.sim),
    tick: s.sim.tick,
    ghosts: s.ghosts.length,
    phase: s.phase,
    // 스플릿은 표시용 기록이지만, 모드에 따라 달라지면 안 되는 값이다.
    splits: JSON.stringify(s.run.splits),
  };
}

describe('플레이 모드는 시뮬레이션 결과를 바꾸지 않는다', () => {
  it('세 모드에서 같은 입력 테이프의 상태 해시 궤적이 완전히 같다', () => {
    const base = traceScript('STORY', 'EASY');
    assert.equal(base.phase, 'CLEAR', '테스트 전제: 이 테이프는 1번 스테이지를 클리어한다');
    assert.ok(base.marks.length > 10, '해시 표본이 너무 적다');

    for (const pm of PLAY_MODES) {
      const t = traceScript(pm, 'EASY');
      assert.deepEqual(t.marks, base.marks, `${pm}: 중간 상태 해시가 갈라졌다`);
      assert.equal(t.finalHash, base.finalHash, `${pm}: 최종 상태 해시가 다르다`);
      assert.equal(t.tick, base.tick, `${pm}: 틱 수가 다르다`);
      assert.equal(t.ghosts, base.ghosts, `${pm}: 잔상 수가 다르다`);
      assert.equal(t.phase, base.phase, `${pm}: 페이즈가 다르다`);
      assert.equal(t.splits, base.splits, `${pm}: 스테이지 스플릿이 다르다`);
    }
  });

  it('플레이 모드 × 감지 방식 6조합 전부 같은 해시를 낸다', () => {
    const base = traceScript('STORY', 'EASY');
    for (const pm of PLAY_MODES) {
      for (const m of MODES) {
        const t = traceScript(pm, m);
        assert.equal(t.finalHash, base.finalHash, `${pm}+${m}: 최종 상태 해시가 다르다`);
        assert.deepEqual(t.marks, base.marks, `${pm}+${m}: 중간 상태 해시가 갈라졌다`);
      }
    }
  });
});

// ── 2. GAUNTLET — 부채는 런을 관통한다 ────────────────────────────────────

describe('GAUNTLET: DEBT 는 스테이지를 넘어도 누적되고 리셋되지 않는다', () => {
  it('스테이지를 넘길 때마다 쌓인 부채가 그대로 남는다', () => {
    const s = newSession('GAUNTLET');
    assert.equal(s.debt, 0, '런 시작 시 부채는 0');

    fullReset(s);
    fullReset(s);
    assert.equal(s.debt, 2);

    const stages = Math.min(4, STAGES.length);
    for (let i = 1; i < stages; i++) {
      nextStage(s);
      assert.equal(s.stageIndex, i, `${i}번 스테이지로 넘어가지 않았다`);
      assert.equal(s.debt, 2 + (i - 1), `스테이지 ${i} 진입에서 부채가 변했다`);
      fullReset(s); // 스테이지마다 한 번씩 더 쌓는다
      assert.equal(s.debt, 2 + i, `스테이지 ${i} 의 초기화가 부채를 올리지 않았다`);
    }

    assert.equal(runTotals(s).debt, s.debt, '런 누적 부채가 세션 부채와 다르다');
    assert.ok(s.debt >= 2 + stages - 1);
  });

  it('4번째 강제 확정(LOOP FAILED)의 초기화도 부채로 남는다', () => {
    const s = newSession('GAUNTLET');
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      runTicks(s, 10);
      commitAndAdvance(s);
    }
    assert.equal(s.ghosts.length, MAX_AFTERIMAGES);
    assert.equal(s.debt, 0);

    runTicks(s, 10);
    commitLoop(s, 'TIMEUP'); // 남길 나가 없는데 강제 확정 → 초기화 (R 은 차단된다)
    assert.equal(s.ghosts.length, 0);
    assert.equal(s.debt, 1);

    runTicks(s, LOOP_TRANSITION_TICKS);
    nextStage(s);
    assert.equal(s.debt, 1, '다음 스테이지가 부채를 지웠다');
  });

  it('런의 잔상 사용량은 스테이지를 넘어 합산된다', () => {
    const s = newSession('GAUNTLET');
    runTicks(s, 10);
    commitAndAdvance(s);
    runTicks(s, 10);
    commitAndAdvance(s);
    assert.equal(runTotals(s).afterimages, 2);

    nextStage(s);
    assert.equal(runTotals(s).afterimages, 2, '스테이지를 넘기며 누적 잔상이 사라졌다');
    runTicks(s, 10);
    commitAndAdvance(s);
    assert.equal(runTotals(s).afterimages, 3);
  });
});

// ── 3. TIME ATTACK — 시간은 합산되고, 조기 확정이 기록을 줄인다 ───────────

describe('TIME_ATTACK: 누적 시간', () => {
  it('스테이지를 넘어가도 경과 시간이 합산된다', () => {
    const s = newSession('TIME_ATTACK');
    const stages = Math.min(3, STAGES.length);
    const per = 30; // 0.5초 — 어떤 레벨에서도 서 있는 것만으로 잡히지 않는 길이

    for (let i = 0; i < stages; i++) {
      runTicks(s, per);
      assert.equal(s.phase, 'PLAY', `스테이지 ${i} 에서 루프가 조기 종료됐다`);
      assert.equal(
        runTotals(s).ticks,
        per * (i + 1),
        `스테이지 ${i} 까지의 누적 시간이 맞지 않는다`,
      );
      if (i < stages - 1) nextStage(s);
    }
  });

  it('조기 확정이 총 시간을 줄인다 (같은 루프 수, 짧은 루프 vs 긴 루프)', () => {
    /** 1번 스테이지에서 `loopTicks` 짜리 루프를 3번 확정한 런의 총 시간. */
    const totalOf = (loopTicks: number): number => {
      const s = newSession('TIME_ATTACK');
      for (let i = 0; i < MAX_AFTERIMAGES; i++) {
        runTicks(s, loopTicks);
        assert.equal(s.phase, 'PLAY', '루프가 조기 종료됐다 — 시간 비교의 전제가 깨졌다');
        commitAndAdvance(s);
      }
      return runTotals(s).ticks;
    };

    const early = totalOf(60);
    const late = totalOf(600);

    assert.equal(early, 60 * MAX_AFTERIMAGES, '짧은 루프의 총 시간이 합과 다르다');
    assert.equal(late, 600 * MAX_AFTERIMAGES, '긴 루프의 총 시간이 합과 다르다');
    assert.ok(early < late, `조기 확정이 기록을 줄이지 못했다 (${early} >= ${late})`);
  });

  it('초기화(fullReset)는 이미 흘러간 시간을 되돌려주지 않는다', () => {
    const s = newSession('TIME_ATTACK');
    runTicks(s, 120);
    assert.equal(runTotals(s).ticks, 120);
    fullReset(s);
    assert.equal(s.elapsedTicks, 0, '스테이지 시계는 되감겨야 한다');
    assert.equal(runTotals(s).ticks, 120, '런 시계까지 되감겼다 — 리셋이 시간을 지웠다');
    runTicks(s, 60);
    assert.equal(runTotals(s).ticks, 180);
  });
});

// ── 4. 두 축의 독립성 ─────────────────────────────────────────────────────

describe('playMode 와 mode(EASY/LISTEN)는 독립적으로 조합된다', () => {
  it('6조합이 전부 그대로 유지된다', () => {
    for (const pm of PLAY_MODES) {
      for (const m of MODES) {
        const s = newSession(pm, m);
        assert.equal(s.playMode, pm);
        assert.equal(s.mode, m);
      }
    }
  });

  it('한 축을 바꿔도 다른 축은 그대로다', () => {
    const s = createSession();
    s.mode = 'LISTEN';
    setPlayMode(s, 'GAUNTLET');
    assert.equal(s.mode, 'LISTEN', '플레이 방식 변경이 감지 방식을 건드렸다');
    assert.equal(s.playMode, 'GAUNTLET');

    s.mode = 'EASY';
    assert.equal(s.playMode, 'GAUNTLET', '감지 방식 변경이 플레이 방식을 건드렸다');
  });

  it('스테이지 시작·초기화·다음 스테이지가 두 축을 건드리지 않는다', () => {
    const s = newSession('TIME_ATTACK', 'LISTEN');
    startStage(s, 0);
    assert.equal(s.playMode, 'TIME_ATTACK');
    assert.equal(s.mode, 'LISTEN');

    fullReset(s);
    assert.equal(s.playMode, 'TIME_ATTACK');
    assert.equal(s.mode, 'LISTEN');

    nextStage(s);
    assert.equal(s.playMode, 'TIME_ATTACK');
    assert.equal(s.mode, 'LISTEN');
  });

  it('런 도중에는 플레이 방식이 바뀌지 않는다 (기록 기준이 흔들리면 안 된다)', () => {
    const s = newSession('GAUNTLET');
    setPlayMode(s, 'STORY');
    assert.equal(s.playMode, 'GAUNTLET', 'PLAY 중에 플레이 방식이 바뀌었다');

    s.phase = 'TITLE';
    setPlayMode(s, 'STORY');
    assert.equal(s.playMode, 'STORY', '타이틀에서는 바뀌어야 한다');
  });
});

// ── 5. 기록 저장 — 실패해도 게임은 죽지 않는다 ───────────────────────────

/** node 에는 localStorage 가 없다. 테스트마다 직접 심고 원상복구한다. */
function withStorage(value: PropertyDescriptor | null, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (value === null) delete (globalThis as Record<string, unknown>)['localStorage'];
  else Object.defineProperty(globalThis, 'localStorage', value);
  try {
    fn();
  } finally {
    if (original === undefined) delete (globalThis as Record<string, unknown>)['localStorage'];
    else Object.defineProperty(globalThis, 'localStorage', original);
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(k: string): string | null {
      return map.get(k) ?? null;
    },
    key(i: number): string | null {
      return [...map.keys()][i] ?? null;
    },
    removeItem(k: string): void {
      map.delete(k);
    },
    setItem(k: string, v: string): void {
      map.set(k, v);
    },
  } as Storage;
}

/** 접근하는 것만으로 예외를 던지는 저장소 (사파리 프라이빗 모드 등). */
const THROWING_STORAGE: PropertyDescriptor = {
  configurable: true,
  get(): Storage {
    throw new Error('SecurityError: localStorage 접근이 차단되었습니다');
  },
};

/** getItem/setItem 에서만 던지는 저장소 (용량 초과 등). */
function throwingMethods(): PropertyDescriptor {
  return {
    configurable: true,
    writable: true,
    value: {
      get length(): number {
        return 0;
      },
      clear(): void {},
      getItem(): string | null {
        throw new Error('read blocked');
      },
      key(): string | null {
        return null;
      },
      removeItem(): void {},
      setItem(): void {
        throw new Error('QuotaExceededError');
      },
    } as Storage,
  };
}

/** 마지막 스테이지까지 간 척하고 런을 끝낸다. 시간·부채·잔상만 통제한다. */
function finishRunWith(
  playMode: PlayMode,
  opts: { ticks?: number; debt?: number; ghosts?: number } = {},
): Session {
  const s = newSession(playMode);
  runTicks(s, opts.ticks ?? 0);
  for (let i = 0; i < (opts.ghosts ?? 0); i++) commitAndAdvance(s);
  for (let i = 0; i < (opts.debt ?? 0); i++) fullReset(s);
  // fullReset 은 잔상을 지우지만 이미 런 누적치로 넘어간 값은 남는다.
  startStage(s, STAGES.length - 1);
  nextStage(s); // 마지막 스테이지를 넘김 = 런 종료
  return s;
}

describe('기록 저장: localStorage 가 막혀도 세션은 정상 동작한다', () => {
  it('접근 자체가 예외를 던져도 런이 끝까지 굴러간다', () => {
    withStorage(THROWING_STORAGE, () => {
      const s = finishRunWith('GAUNTLET', { ticks: 45, debt: 2 });

      assert.equal(s.phase, 'ALLCLEAR', '런이 끝나지 않았다');
      assert.notEqual(s.runResult, null, '런 결과가 만들어지지 않았다');
      const r = s.runResult!;
      assert.equal(r.previousBest, null, '읽지 못한 기록을 읽은 척했다');
      assert.equal(r.newBest, true, '기록이 없으면 이번 런이 최고 기록이다');
      assert.equal(r.saved, false, '저장에 실패했는데 성공으로 보고했다');
      assert.equal(r.totals.debt, 2);
      assert.equal(r.totals.ticks, 45);

      // 저장이 막혔어도 그 다음 런이 정상적으로 시작되고 굴러간다.
      startRun(s, 0);
      runTicks(s, 30);
      assert.equal(s.phase, 'PLAY');
      assert.equal(s.debt, 0);
      assert.equal(runTotals(s).ticks, 30);
    });
  });

  it('getItem/setItem 이 던지는 저장소에서도 loadBest/saveBest 가 조용히 실패한다', () => {
    withStorage(throwingMethods(), () => {
      assert.equal(loadBest('GAUNTLET', 'EASY'), null);
      assert.equal(
        saveBest('GAUNTLET', 'EASY', { ticks: 1, debt: 0, afterimages: 0, stages: 1 }),
        false,
      );
      const s = finishRunWith('TIME_ATTACK', { ticks: 60 });
      assert.equal(s.runResult?.saved, false);
      assert.equal(s.runResult?.totals.ticks, 60);
    });
  });

  it('localStorage 자체가 없는 환경(node 기본)에서도 던지지 않는다', () => {
    withStorage(null, () => {
      assert.equal(loadBest('TIME_ATTACK', 'LISTEN'), null);
      assert.equal(
        saveBest('TIME_ATTACK', 'LISTEN', { ticks: 1, debt: 0, afterimages: 0, stages: 1 }),
        false,
      );
      const s = finishRunWith('GAUNTLET', { ticks: 10 });
      assert.equal(s.phase, 'ALLCLEAR');
      assert.equal(s.runResult?.saved, false);
    });
  });
});

describe('기록 저장: 모드별 최고 기록', () => {
  it('TIME_ATTACK 은 최단 시간만 갈아치운다', () => {
    withStorage({ configurable: true, writable: true, value: memoryStorage() }, () => {
      const first = finishRunWith('TIME_ATTACK', { ticks: 300 });
      assert.equal(first.runResult?.newBest, true);
      assert.equal(first.runResult?.saved, true);

      const slower = finishRunWith('TIME_ATTACK', { ticks: 600 });
      assert.equal(slower.runResult?.newBest, false, '느린 런이 기록을 갈아치웠다');
      assert.equal(slower.runResult?.previousBest?.ticks, 300);

      const faster = finishRunWith('TIME_ATTACK', { ticks: 120 });
      assert.equal(faster.runResult?.newBest, true);
      assert.equal(loadBest('TIME_ATTACK', 'EASY')?.ticks, 120);
    });
  });

  it('GAUNTLET 은 최소 DEBT, 동률이면 최소 잔상으로 가른다', () => {
    withStorage({ configurable: true, writable: true, value: memoryStorage() }, () => {
      const base = finishRunWith('GAUNTLET', { debt: 3, ghosts: 2, ticks: 20 });
      assert.equal(base.runResult?.newBest, true);
      assert.equal(base.runResult?.totals.debt, 3);
      assert.equal(base.runResult?.totals.afterimages, 2);

      const worse = finishRunWith('GAUNTLET', { debt: 4, ghosts: 0, ticks: 20 });
      assert.equal(worse.runResult?.newBest, false, '부채가 더 많은데 기록이 됐다');

      const tieFewerGhosts = finishRunWith('GAUNTLET', { debt: 3, ghosts: 1, ticks: 20 });
      assert.equal(tieFewerGhosts.runResult?.newBest, true, '동률에서 잔상이 적은 쪽이 이겨야 한다');

      const best = loadBest('GAUNTLET', 'EASY');
      assert.equal(best?.debt, 3);
      assert.equal(best?.afterimages, 1);
    });
  });

  it('EASY 기록과 LISTEN 기록은 서로 다른 칸에 들어간다', () => {
    withStorage({ configurable: true, writable: true, value: memoryStorage() }, () => {
      saveBest('GAUNTLET', 'EASY', { ticks: 100, debt: 0, afterimages: 0, stages: 5 });
      assert.equal(loadBest('GAUNTLET', 'LISTEN'), null, 'LISTEN 칸에 EASY 기록이 새어 들어갔다');
      assert.equal(loadBest('GAUNTLET', 'EASY')?.ticks, 100);
      assert.equal(loadBest('STORY', 'EASY'), null, '다른 플레이 방식 칸이 오염됐다');
    });
  });

  it('망가진 값이 저장돼 있으면 기록 없음으로 친다', () => {
    const store = memoryStorage();
    store.setItem('imm.best.GAUNTLET.EASY', '{ 이건 JSON 이 아니다');
    withStorage({ configurable: true, writable: true, value: store }, () => {
      assert.equal(loadBest('GAUNTLET', 'EASY'), null);
      store.setItem('imm.best.GAUNTLET.EASY', '{"ticks":"많이","debt":1}');
      assert.equal(loadBest('GAUNTLET', 'EASY'), null);
    });
  });

  it('STORY 는 기록을 남기지 않는다', () => {
    withStorage({ configurable: true, writable: true, value: memoryStorage() }, () => {
      const s = finishRunWith('STORY', { ticks: 100 });
      assert.equal(s.phase, 'ALLCLEAR');
      assert.equal(s.runResult, null, 'STORY 가 런 결과를 만들었다');
      assert.equal(loadBest('STORY', 'EASY'), null);
    });
  });

  it('isBetterRun: 기록이 없으면 무조건 최고 기록이다', () => {
    const totals = { stages: 1, ticks: 10, afterimages: 0, alerts: 0, medals: 0, debt: 0 };
    assert.equal(isBetterRun('TIME_ATTACK', totals, null), true);
    assert.equal(isBetterRun('GAUNTLET', totals, null), true);
  });

  it('finishRun 은 런의 현재 성적을 그대로 담는다', () => {
    withStorage({ configurable: true, writable: true, value: memoryStorage() }, () => {
      const s = newSession('GAUNTLET');
      runTicks(s, 90);
      commitAndAdvance(s);
      fullReset(s);
      finishRun(s);
      const r = s.runResult!;
      assert.equal(r.playMode, 'GAUNTLET');
      assert.equal(r.mode, 'EASY');
      assert.equal(r.totals.debt, 1);
      assert.equal(r.totals.ticks, runTotals(s).ticks);
      assert.equal(r.totals.afterimages, runTotals(s).afterimages);
    });
  });
});

// ── 6. 스플릿 기록 ────────────────────────────────────────────────────────

describe('스테이지 스플릿은 클리어할 때 딱 한 번 쌓인다', () => {
  it('1번 스테이지를 클리어하면 스플릿 1개와 메달이 기록된다', () => {
    const s = newSession('TIME_ATTACK');
    for (const m of LOOP_1) tickSession(s, m);
    commitAndAdvance(s);
    for (const m of LOOP_2) tickSession(s, m);

    assert.equal(s.phase, 'CLEAR');
    assert.equal(s.run.splits.length, 1);
    const sp = s.run.splits[0]!;
    assert.equal(sp.stageIndex, 0);
    assert.equal(sp.name, STAGES[0]!.name);
    assert.equal(sp.afterimages, 1);
    assert.equal(sp.ticks, s.elapsedTicks);
    assert.equal(sp.medal, s.medal);
    assert.equal(runTotals(s).medals, s.medal ? 1 : 0);

    // 클리어 후에도 계속 틱을 넣어봐야 스플릿이 늘지 않는다.
    runTicks(s, 30);
    assert.equal(s.run.splits.length, 1, '스플릿이 중복 기록됐다');
    assert.equal(runTotals(s).stages, 1);
  });
});
