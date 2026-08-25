/**
 * 구조 지원 QA — 실패 카운터 · 힌트 버튼 · 스테이지 포기.
 *
 * "한 스테이지를 못 깨면 무한 반복"의 탈출구가 명세대로 동작하는지 본다:
 * 실패 HINT_UNLOCK_FAILS 회 → `T ▸ HINT`, SKIP_UNLOCK_FAILS 회(STORY) → `N ▸ SKIP`.
 * 무엇이 실패로 세어지는가가 이 시스템의 핵심 경계다 — R 조기 확정(전략)은
 * 세지 않고, 몸을 잃는 사건(체포·시간 소진·전체 초기화)만 센다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  commitLoop,
  createSession,
  fullReset,
  hintUnlocked,
  nextStage,
  requestSkip,
  setPlayMode,
  skipUnlocked,
  startRun,
  tickSession,
  toggleHint,
  type PlayMode,
  type Session,
} from '../src/game/session';
import {
  HINT_UNLOCK_FAILS,
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  SKIP_ARM_TICKS,
  SKIP_UNLOCK_FAILS,
} from '../src/sim/constants';

function newSession(pm: PlayMode = 'STORY'): Session {
  const s = createSession();
  setPlayMode(s, pm);
  startRun(s, 0);
  return s;
}

function runTicks(s: Session, n: number): void {
  for (let i = 0; i < n; i++) tickSession(s, 0);
}

/** 한 루프를 굴리고 지정 사유로 확정한 뒤 전환 오버레이까지 소화한다. */
function commitAndAdvance(s: Session, reason: 'MANUAL' | 'CAPTURED' | 'TIMEUP'): void {
  runTicks(s, 10);
  commitLoop(s, reason);
  runTicks(s, LOOP_TRANSITION_TICKS);
}

// ── 1. 실패 카운터의 경계 ──────────────────────────────────────────────────

describe('실패 카운터: 몸을 잃는 사건만 센다', () => {
  it('R 조기 확정(MANUAL)은 실패가 아니다', () => {
    const s = newSession();
    for (let i = 0; i < MAX_AFTERIMAGES; i++) commitAndAdvance(s, 'MANUAL');
    assert.equal(s.failCount, 0, '전략적 확정이 실패로 세어졌다');
  });

  it('체포·시간 소진 확정은 각각 1 실패다', () => {
    const s = newSession();
    commitAndAdvance(s, 'CAPTURED');
    assert.equal(s.failCount, 1);
    commitAndAdvance(s, 'TIMEUP');
    assert.equal(s.failCount, 2);
  });

  it('전체 초기화는 실패 1 이고, 쌓인 카운트는 초기화를 넘어 살아남는다', () => {
    const s = newSession();
    commitAndAdvance(s, 'CAPTURED');
    commitAndAdvance(s, 'CAPTURED');
    fullReset(s);
    assert.equal(s.failCount, 3, '초기화가 카운트를 지웠거나 잘못 더했다');
  });

  it('마지막 몸의 강제 확정(LOOP FAILED)은 정확히 1 실패다 (이중 집계 금지)', () => {
    const s = newSession();
    for (let i = 0; i < MAX_AFTERIMAGES; i++) commitAndAdvance(s, 'MANUAL');
    assert.equal(s.failCount, 0);
    runTicks(s, 10);
    commitLoop(s, 'TIMEUP'); // 슬롯이 없다 → fullReset 경유
    assert.equal(s.failCount, 1, 'TIMEUP 과 fullReset 이 따로 세어졌다');
  });

  it('다른 스테이지로 넘어가면 0 으로 돌아간다', () => {
    const s = newSession();
    commitAndAdvance(s, 'CAPTURED');
    assert.equal(s.failCount, 1);
    nextStage(s);
    assert.equal(s.failCount, 0, '스테이지가 바뀌었는데 카운트가 남았다');
  });
});

// ── 2. 힌트 버튼 ───────────────────────────────────────────────────────────

describe(`힌트: 실패 ${HINT_UNLOCK_FAILS}회부터 열린다`, () => {
  it('그 전에는 잠겨 있고 T 는 무시된다', () => {
    const s = newSession();
    for (let i = 0; i < HINT_UNLOCK_FAILS - 1; i++) commitAndAdvance(s, 'CAPTURED');
    assert.equal(hintUnlocked(s), false);
    assert.equal(toggleHint(s), false);
    assert.equal(s.hintOpen, false);
  });

  it('문턱을 넘으면 열리고, T 가 배너를 토글한다', () => {
    const s = newSession();
    for (let i = 0; i < HINT_UNLOCK_FAILS; i++) commitAndAdvance(s, 'CAPTURED');
    assert.equal(hintUnlocked(s), true);
    assert.equal(toggleHint(s), true);
    assert.equal(s.hintOpen, true);
    assert.equal(toggleHint(s), true);
    assert.equal(s.hintOpen, false);
  });

  it('열어 둔 배너는 전체 초기화를 넘어 살아남고, 다음 스테이지에서는 닫힌다', () => {
    const s = newSession();
    for (let i = 0; i < HINT_UNLOCK_FAILS; i++) commitAndAdvance(s, 'CAPTURED');
    toggleHint(s);
    fullReset(s);
    assert.equal(s.hintOpen, true, '막힌 채 초기화했는데 힌트가 닫혔다');
    assert.equal(hintUnlocked(s), true);
    nextStage(s);
    assert.equal(s.hintOpen, false, '새 스테이지인데 이전 힌트가 열려 있다');
  });
});

// ── 3. 스테이지 포기 ───────────────────────────────────────────────────────

describe(`건너뛰기: STORY 에서 실패 ${SKIP_UNLOCK_FAILS}회부터, 두 번 눌러 확인`, () => {
  function stuckSession(pm: PlayMode = 'STORY'): Session {
    const s = newSession(pm);
    s.failCount = SKIP_UNLOCK_FAILS;
    return s;
  }

  it('문턱 전에는 잠겨 있다', () => {
    const s = newSession();
    s.failCount = SKIP_UNLOCK_FAILS - 1;
    assert.equal(skipUnlocked(s), false);
    assert.equal(requestSkip(s), 'IGNORED');
  });

  it('기록 모드(GAUNTLET/TIME_ATTACK)에서는 열리지 않는다', () => {
    for (const pm of ['GAUNTLET', 'TIME_ATTACK'] as const) {
      const s = stuckSession(pm);
      assert.equal(skipUnlocked(s), false, `${pm} 에서 건너뛰기가 열렸다`);
      assert.equal(requestSkip(s), 'IGNORED');
    }
  });

  it('첫 N 은 무장, 둘째 N 이 실행 — DEBT +1 로 다음 스테이지', () => {
    const s = stuckSession();
    assert.equal(requestSkip(s), 'ARMED');
    assert.equal(s.stageIndex, 0, '무장 단계에서 스테이지가 넘어갔다');
    assert.ok(s.skipArm > 0);

    assert.equal(requestSkip(s), 'SKIPPED');
    assert.equal(s.stageIndex, 1, '건너뛰기가 스테이지를 넘기지 않았다');
    assert.equal(s.debt, 1, '건너뛰기의 대가(DEBT +1)가 없다');
    assert.equal(s.failCount, 0, '새 스테이지의 실패 카운트가 이어졌다');
    assert.equal(s.phase, 'PLAY');
  });

  it('무장은 시한이 지나면 풀린다 — 늦은 둘째 N 은 다시 무장이다', () => {
    const s = stuckSession();
    assert.equal(requestSkip(s), 'ARMED');
    runTicks(s, SKIP_ARM_TICKS);
    assert.equal(s.skipArm, 0, '무장이 시한 뒤에도 남아 있다');
    assert.equal(requestSkip(s), 'ARMED', '풀린 무장인데 실행됐다');
    assert.equal(s.stageIndex, 0);
  });

  it('마지막 스테이지의 건너뛰기는 엔딩(ALLCLEAR)으로 간다', () => {
    const s = newSession();
    // STORY 진행을 그대로 흉내 낸다: 마지막 스테이지로 이동 후 막힘.
    for (let i = 1; i < STAGES.length; i++) nextStage(s);
    assert.equal(s.stageIndex, STAGES.length - 1);
    s.failCount = SKIP_UNLOCK_FAILS;

    assert.equal(requestSkip(s), 'ARMED');
    assert.equal(requestSkip(s), 'SKIPPED');
    assert.equal(s.phase, 'ALLCLEAR', '마지막 방 포기가 엔딩으로 가지 않았다');
    assert.equal(s.debt, 1, '포기의 대가가 엔딩 집계에 빠졌다');
  });
});

// ── 4. 힌트 데이터 — 15개 스테이지 전부 결정적 한 줄이 있다 ────────────────

describe('LevelDef.hint: 배너에 들어갈 결정적 한 줄', () => {
  it('전 스테이지가 비어 있지 않은 한 줄(개행 없음, 52자 이하)을 가진다', () => {
    for (const st of STAGES) {
      assert.ok(st.hint.length > 0, `${st.id}: 힌트가 비었다`);
      assert.ok(!st.hint.includes('\n'), `${st.id}: 힌트가 여러 줄이다`);
      assert.ok(
        st.hint.length <= 52,
        `${st.id}: 힌트가 ${st.hint.length}자 — 배너 폭(52자)을 넘는다`,
      );
    }
  });
});
