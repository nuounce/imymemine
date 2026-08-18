/**
 * 엔딩 분기 · 막별 호칭 · 겹치는 패널 (STORY.md §6 · §7).
 *
 * 여기서 지켜야 할 것은 셋이다.
 *   1. **분기**: 엔딩은 `DEBT` 하나로 갈리고, 경계는 0 과 3 딱 둘이다.
 *   2. **읽기 전용**: 엔딩 화면은 시뮬도 세션도 건드리지 않는다 (SPEC §4).
 *      속말과 같은 등급의 불변이라 여기서도 해시로 증명한다.
 *   3. **끝의 위치**: 마지막 스테이지는 `STAGES` 에서 유도된다 — 숫자를 박지 않는다.
 *
 * 그리고 화면을 덮는 패널(조작법·일시정지·단서)이 **겹쳐 읽히지 않는지** 확인한다.
 * 단서 패널은 월드 레이어 안에서 그려지므로, 위의 둘이 불투명하게 덮는 것이
 * 곧 "동시에 열리지 않는다"의 구현이다.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  commitLoop,
  createSession,
  endingFor,
  endingView,
  finalStageIndex,
  isFinalStage,
  nextStage,
  PLAY_MODES,
  startRun,
  startStage,
  tickSession,
  YIELD_DEBT,
  type EndingId,
  type PlayMode,
  type Session,
} from '../src/game/session';
import {
  actLine,
  actOf,
  ACT_COUNT,
  ACT_LINES,
  GLOBAL_LINES,
  resetWhisper,
  updateWhisper,
  type ActLineId,
} from '../src/game/whisper';
import { drawEnding, drawHelp, drawPause, topLayer } from '../src/render/hud';
import { C_BG, withAlpha } from '../src/render/palette';
import { CANVAS_H, CANVAS_W, LOOP_TRANSITION_TICKS } from '../src/sim/constants';
import { hashState } from '../src/sim/hash';

// ── 캔버스 스텁 ────────────────────────────────────────────────────────────
//
// 노드에는 캔버스가 없다. 그리기 호출을 **기록만** 하는 대역을 세워 두면
// "무엇을 어떤 색으로 덮었는가"를 그대로 검사할 수 있다.

interface FillRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

interface StubCtx {
  ctx: CanvasRenderingContext2D;
  rects: FillRect[];
  texts: string[];
}

function stubCtx(): StubCtx {
  const rects: FillRect[] = [];
  const texts: string[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  const impl: Record<string, unknown> = {
    ...state,
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h, fill: String(impl['fillStyle']) });
    },
    fillText(s: string): void {
      texts.push(s);
    },
    measureText(s: string): { width: number } {
      return { width: s.length * 6 };
    },
  };
  const proxy = new Proxy(impl, {
    get(t, prop): unknown {
      if (prop in t) return t[prop as string];
      return () => undefined; // 쓰지 않는 캔버스 API 는 조용히 무시한다.
    },
    set(t, prop, value): boolean {
      t[prop as string] = value;
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, rects, texts };
}

// ── 도우미 ─────────────────────────────────────────────────────────────────

/** 마지막 스테이지를 막 클리어한 상태의 세션. `nextStage` 한 번이면 엔딩이다. */
function atFinalStage(playMode: PlayMode, debt: number): Session {
  const s = createSession();
  s.playMode = playMode;
  startRun(s, finalStageIndex());
  s.debt = debt;
  return s;
}

function drive(s: Session, frames: number, input = 0, collect?: string[]): void {
  for (let i = 0; i < frames; i++) {
    tickSession(s, input);
    const v = updateWhisper(s);
    if (v !== null && collect !== undefined && collect[collect.length - 1] !== v.text) {
      collect.push(v.text);
    }
  }
}

/**
 * 스텐실과 인쇄체는 글자 뒤에 잉크 헤일로를 한 번 더 찍고, 흔들리는 인쇄체는
 * 글자를 하나씩 그린다. 그래서 기록된 `fillText` 를 그대로 이으면 같은 글자가
 * 두 번씩 들어간다 — 연속 중복만 걷어내면 화면에 읽히는 문장이 된다.
 */
function screenText(texts: readonly string[]): string {
  const out: string[] = [];
  for (const t of texts) if (out[out.length - 1] !== t) out.push(t);
  return out.join('');
}

function sessionFingerprint(s: Session): string {
  return [
    s.phase,
    s.mode,
    s.playMode,
    s.stageIndex,
    s.level.id,
    s.ghosts.length,
    s.recording.length,
    s.loopIndex,
    s.overwriteLeft,
    String(s.overwriteSlot),
    s.awaitingOverwritePick,
    s.debt,
    s.alerts,
    s.elapsedTicks,
    s.medal,
    s.transitionTimer,
    s.transitionMsg.join('|'),
    s.resetHold,
    s.paused,
    s.run.ticks,
    s.run.afterimages,
    s.run.alerts,
    s.run.medals,
    s.run.splits.length,
  ].join('/');
}

// ── 1. DEBT 분기 ───────────────────────────────────────────────────────────

describe('엔딩 — DEBT 분기', () => {
  it('경계값 0 · 1 · 2 · 3 · 5 가 의도한 엔딩을 고른다', () => {
    const table: [number, EndingId][] = [
      [0, 'TOGETHER'],
      [1, 'LEFT_BEHIND'],
      [2, 'LEFT_BEHIND'],
      [3, 'YIELD'],
      [5, 'YIELD'],
    ];
    for (const [debt, id] of table) {
      assert.equal(endingFor(debt), id, `DEBT ${debt} 의 엔딩이 다르다`);
    }
  });

  it('갈림은 0 과 YIELD_DEBT 딱 두 곳뿐이다', () => {
    for (let d = 0; d < 40; d++) {
      const expected: EndingId = d === 0 ? 'TOGETHER' : d < YIELD_DEBT ? 'LEFT_BEHIND' : 'YIELD';
      assert.equal(endingFor(d), expected, `DEBT ${d}`);
    }
  });

  it('말이 안 되는 값도 화면을 깨뜨리지 않는다', () => {
    assert.equal(endingFor(-3), 'TOGETHER');
    assert.equal(endingFor(Number.NaN), 'TOGETHER');
    assert.equal(endingFor(2.9), 'LEFT_BEHIND');
    assert.equal(endingFor(Number.POSITIVE_INFINITY), 'TOGETHER');
  });

  it('endingView 가 그 런의 요약을 함께 담는다', () => {
    const s = atFinalStage('GAUNTLET', 4);
    const v = endingView(s);
    assert.equal(v.id, 'YIELD');
    assert.equal(v.debt, 4);
    assert.equal(v.totals.debt, 4);
    assert.equal(v.playMode, 'GAUNTLET');
    assert.ok(v.totals.ticks >= 0);
    assert.ok(v.totals.stages >= 0);
  });
});

// ── 2. 엔딩은 시뮬/세션을 건드리지 않는다 ──────────────────────────────────

describe('엔딩 — 읽기 전용 보증', () => {
  it('endingView 와 엔딩 화면을 반복해도 SimState 해시와 세션이 그대로다', () => {
    for (const debt of [0, 1, 3]) {
      const s = atFinalStage('GAUNTLET', debt);
      drive(s, 120);
      const hashBefore = hashState(s.sim);
      const fpBefore = sessionFingerprint(s);

      for (let i = 0; i < 200; i++) endingView(s);
      for (let clock = 0; clock < 200; clock += 7) {
        drawEnding(stubCtx().ctx, s, clock);
      }

      assert.equal(hashState(s.sim), hashBefore, `DEBT ${debt}: 시뮬 해시가 바뀌었다`);
      assert.equal(sessionFingerprint(s), fpBefore, `DEBT ${debt}: 세션이 바뀌었다`);
    }
  });

  it('세 엔딩 모두 화면에 실제로 문구를 찍는다', () => {
    const seen: string[] = [];
    for (const debt of [0, 2, 3]) {
      const s = atFinalStage('STORY', debt);
      const stub = stubCtx();
      // 연출이 끝난 뒤(도장까지) 의 화면을 본다.
      drawEnding(stub.ctx, s, 400);
      const joined = screenText(stub.texts);
      assert.ok(joined.includes('배치 기록'), `DEBT ${debt}: 배치 기록이 없다`);
      assert.ok(joined.includes(String(debt)), `DEBT ${debt}: 회수량이 안 찍혔다`);
      seen.push(joined);
    }
    // `수율 양호.` 는 DEBT 3+ 에만 찍힌다.
    assert.ok(!seen[0]!.includes('수율 양호'), 'DEBT 0 에 도장이 찍혔다');
    assert.ok(!seen[1]!.includes('수율 양호'), 'DEBT 2 에 도장이 찍혔다');
    assert.ok(seen[2]!.includes('수율 양호'), 'DEBT 3 에 도장이 없다');
  });
});

// ── 3. 마지막 스테이지는 배열에서 나온다 ───────────────────────────────────

describe('엔딩 — 마지막 스테이지 유도', () => {
  it('finalStageIndex 는 STAGES 의 길이를 따라간다', () => {
    assert.equal(finalStageIndex(), STAGES.length - 1);
  });

  it('스테이지 수가 달라져도 같은 규칙이 선다', () => {
    for (const total of [1, 3, 7, 15, 40]) {
      assert.equal(finalStageIndex(total), total - 1, `총 ${total}개`);
      assert.equal(isFinalStage(total - 1, total), true, `총 ${total}개의 마지막`);
      if (total >= 2) {
        assert.equal(isFinalStage(total - 2, total), false, `총 ${total}개의 직전`);
      }
    }
    assert.equal(finalStageIndex(0), 0, '스테이지가 0개여도 음수를 내면 안 된다');
  });

  it('마지막 스테이지에서만 nextStage 가 엔딩으로 넘어간다', () => {
    const last = createSession();
    startRun(last, finalStageIndex());
    nextStage(last);
    assert.equal(last.phase, 'ALLCLEAR');

    const beforeLast = createSession();
    startRun(beforeLast, finalStageIndex() - 1);
    nextStage(beforeLast);
    assert.notEqual(beforeLast.phase, 'ALLCLEAR', '직전 스테이지에서 엔딩이 떴다');
    assert.equal(beforeLast.stageIndex, finalStageIndex());
  });
});

// ── 4. 세 플레이 방식 전부 ─────────────────────────────────────────────────

describe('엔딩 — 플레이 방식', () => {
  it('STORY · GAUNTLET · TIME_ATTACK 모두 마지막 스테이지에서 엔딩이 뜬다', () => {
    assert.equal(PLAY_MODES.length, 3);
    for (const pm of PLAY_MODES) {
      for (const [debt, id] of [
        [0, 'TOGETHER'],
        [2, 'LEFT_BEHIND'],
        [3, 'YIELD'],
      ] as [number, EndingId][]) {
        const s = atFinalStage(pm, debt);
        nextStage(s);
        assert.equal(s.phase, 'ALLCLEAR', `${pm}: 엔딩 페이즈로 가지 않았다`);
        assert.equal(endingView(s).id, id, `${pm} / DEBT ${debt}`);
        // 화면도 실제로 그려진다.
        const stub = stubCtx();
        drawEnding(stub.ctx, s, 400);
        assert.ok(stub.texts.length > 0, `${pm}: 엔딩 화면이 비었다`);
      }
    }
  });

  it('STORY 는 여전히 런 기록을 만들지 않는다 — 엔딩만 본다', () => {
    const s = atFinalStage('STORY', 1);
    nextStage(s);
    assert.equal(s.runResult, null);
    assert.equal(endingView(s).id, 'LEFT_BEHIND');
  });
});

// ── 5. 속말: 막별 호칭 ─────────────────────────────────────────────────────

describe('속말 — 막별 호칭', () => {
  beforeEach(() => {
    resetWhisper();
  });

  const IDS = Object.keys(ACT_LINES) as ActLineId[];

  it('레벨 id 가 막을 말한다 — 1막부터 4막까지 순서대로 오른다', () => {
    let prev = 0;
    for (const level of STAGES) {
      const act = actOf(level.id);
      assert.ok(act >= 1 && act <= ACT_COUNT, `${level.id} 의 막이 ${act}`);
      assert.ok(act >= prev, `${level.id} 에서 막이 뒤로 갔다`);
      prev = act;
    }
    assert.equal(actOf(STAGES[0]!.id), 1);
    assert.equal(actOf(STAGES[STAGES.length - 1]!.id), ACT_COUNT);
  });

  it('막마다 호칭이 실제로 다르다', () => {
    for (const id of IDS) {
      const lines = [1, 2, 3, 4].map((a) => actLine(id, a));
      assert.equal(new Set(lines).size, 4, `${id} 가 막을 넘어 같은 말을 쓴다`);
    }
    // 막 하나 안에서도 서로 다른 대사여야 한다 (같은 스테이지 중복 금지).
    for (let act = 1; act <= ACT_COUNT; act++) {
      const lines = IDS.map((id) => actLine(id, act));
      assert.equal(new Set(lines).size, lines.length, `${act}막 안에서 대사가 겹친다`);
    }
  });

  it('`우리` 는 4막에서만 나온다', () => {
    for (const id of IDS) {
      for (let act = 1; act < ACT_COUNT; act++) {
        assert.ok(
          !actLine(id, act).includes('우리'),
          `${act}막의 ${id} 가 '우리' 를 미리 썼다: ${actLine(id, act)}`,
        );
      }
      assert.ok(actLine(id, ACT_COUNT).includes('우리'), `4막의 ${id} 에 '우리' 가 없다`);
    }
    for (const line of Object.values(GLOBAL_LINES)) {
      assert.ok(!line.includes('우리'), `막과 무관한 대사가 '우리' 를 썼다: ${line}`);
    }
  });

  it('막 번호가 범위를 벗어나도 가장 가까운 막으로 떨어진다', () => {
    for (const id of IDS) {
      assert.equal(actLine(id, 0), actLine(id, 1));
      assert.equal(actLine(id, 99), actLine(id, ACT_COUNT));
    }
  });

  it('실제 플레이에서 1막은 `우리` 를 말하지 않고 4막은 말한다', () => {
    const first = createSession();
    startStage(first, 0);
    const saidFirst: string[] = [];
    drive(first, 200, 0, saidFirst);
    commitLoop(first, 'MANUAL');
    drive(first, LOOP_TRANSITION_TICKS + 1200, 0, saidFirst);
    assert.ok(saidFirst.length > 0, '1막에서 속말이 하나도 안 나왔다');
    for (const line of saidFirst) {
      assert.ok(!line.includes('우리'), `1막이 '우리' 를 말했다: ${line}`);
    }

    resetWhisper();
    const last = createSession();
    startStage(last, finalStageIndex());
    const saidLast: string[] = [];
    drive(last, 200, 0, saidLast);
    commitLoop(last, 'MANUAL');
    drive(last, LOOP_TRANSITION_TICKS + 1200, 0, saidLast);
    assert.ok(
      saidLast.some((l) => l.includes('우리')),
      `4막에서 '우리' 가 나오지 않았다: ${saidLast.join(' / ')}`,
    );
  });
});

// ── 6. 겹치는 패널 ─────────────────────────────────────────────────────────

describe('오버레이 — 일시정지와 단서는 동시에 열리지 않는다', () => {
  it('우선순위는 조작법 > 일시정지 > 단서 하나뿐이다', () => {
    assert.equal(topLayer({ help: false, paused: false, note: false }), 'NONE');
    assert.equal(topLayer({ help: false, paused: false, note: true }), 'NOTE');
    assert.equal(topLayer({ help: false, paused: true, note: true }), 'PAUSE');
    assert.equal(topLayer({ help: true, paused: false, note: true }), 'HELP');
    assert.equal(topLayer({ help: true, paused: true, note: true }), 'HELP');
  });

  it('단서가 펼쳐져 있어도 일시정지·조작법이 열리면 단서 차례는 오지 않는다', () => {
    for (const paused of [true, false]) {
      for (const help of [true, false]) {
        if (!paused && !help) continue;
        assert.notEqual(
          topLayer({ help, paused, note: true }),
          'NOTE',
          `paused=${paused} help=${help} 인데 단서가 위로 올라왔다`,
        );
      }
    }
  });

  it('일시정지와 조작법은 화면을 불투명하게 덮는다 — 아래 단서가 배어 나오지 않는다', () => {
    const opaque = withAlpha(C_BG, 1);
    for (const [name, draw] of [
      ['일시정지', drawPause],
      ['조작법', drawHelp],
    ] as [string, (ctx: CanvasRenderingContext2D) => void][]) {
      const stub = stubCtx();
      draw(stub.ctx);
      const first = stub.rects[0];
      assert.ok(first !== undefined, `${name}: 아무것도 그리지 않았다`);
      assert.deepEqual(
        { x: first.x, y: first.y, w: first.w, h: first.h, fill: first.fill },
        { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, fill: opaque },
        `${name}: 화면을 불투명하게 덮지 않는다`,
      );
    }
  });
});
