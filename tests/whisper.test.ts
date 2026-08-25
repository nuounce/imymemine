/**
 * 속말(whisper) 검증.
 *
 * 속말은 연출이지만 **시뮬 옆에서 매 프레임 도는 연출**이라, 여기서 지켜야 할
 * 것이 두 가지다.
 *   1. 연출로서: 같은 대사를 두 번 뱉지 않고, 막힐 때만 더 구체적으로 말한다.
 *   2. 시스템으로서: 시뮬과 세션을 **한 비트도** 건드리지 않는다. 건드리는 순간
 *      잔상 재생이 어긋나고 결정론(SPEC §4)이 무너진다.
 *
 * 마지막 블록(§4)이 가장 중요하다 — 상태 해시로 불변을 증명한다.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  commitLoop,
  createSession,
  fullReset,
  startStage,
  tickSession,
  type Session,
} from '../src/game/session';
import {
  GLOBAL_LINES,
  resetWhisper,
  STAGE_WHISPERS,
  STALL_FRAMES,
  updateWhisper,
  whisperDebug,
} from '../src/game/whisper';
import { IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP, LOOP_TRANSITION_TICKS } from '../src/sim/constants';
import { hashState } from '../src/sim/hash';

/** 세션을 프레임 단위로 굴리며 속말도 같이 갱신한다 (실제 drawHud 경로와 동일). */
function drive(s: Session, frames: number, input = 0, collect?: string[]): void {
  for (let i = 0; i < frames; i++) {
    tickSession(s, input);
    const v = updateWhisper(s);
    if (collect !== undefined && v !== null) {
      if (collect[collect.length - 1] !== v.text) collect.push(v.text);
    }
  }
}

function freshSession(stageIndex: number): Session {
  resetWhisper();
  const s = createSession();
  startStage(s, stageIndex);
  return s;
}

// ── 1. 같은 대사를 한 스테이지에서 두 번 뱉지 않는다 ───────────────────────

describe('whisper — 대사 중복', () => {
  beforeEach(() => {
    resetWhisper();
  });

  it('스테이지 1을 실제로 플레이하는 동안 같은 대사가 두 번 나오지 않는다', () => {
    const s = freshSession(0);
    const said: string[] = [];

    // THE CELL: 스폰(4,4) · 발판(3,7) · 게이트(9,5). 걷기 512/틱 = 16틱에 1타일.
    drive(s, 60, 0, said); // 가만히 — 오프닝
    drive(s, 16, IN_DOWN, said); // 게이트가 있는 y=5 복도로
    drive(s, 120, IN_RIGHT, said); // 닫힌 게이트에 부딪힌다
    drive(s, 32, IN_DOWN, said); // y=7 로
    drive(s, 82, IN_LEFT, said); // 발판 위로
    drive(s, 420, 0, said); // 발판 위에서 버티기 (2초 / 3초 대사)
    commitLoop(s, 'MANUAL');
    drive(s, LOOP_TRANSITION_TICKS + 10, 0, said); // 전환 → 루프 2
    drive(s, 400, IN_RIGHT, said); // 잔상이 눌러준 문으로
    drive(s, 900, 0, said); // 다시 막힘 → 단계 힌트

    assert.equal(new Set(said).size, said.length, `중복 대사: ${said.join(' / ')}`);
    assert.ok(said.length >= 8, `대사가 너무 적게 나왔다 (${said.length}): ${said.join(' / ')}`);
    // 각본 순서: 발판에 남는 생각이 확정 권유보다 먼저 와야 한다.
    assert.ok(
      said.indexOf(GLOBAL_LINES.plateStand) < said.indexOf(GLOBAL_LINES.plateCommit),
      '확정 권유가 그 이유보다 먼저 나왔다',
    );
    assert.ok(said.includes(GLOBAL_LINES.gateBlocked), '닫힌 문에 부딪힌 대사가 삼켜졌다');
  });

  it('5개 스테이지 전부, 오래 방치해도 대사가 반복되지 않는다', () => {
    for (let i = 0; i < STAGES.length; i++) {
      const s = freshSession(i);
      const said: string[] = [];
      // 3200 프레임 = 막힘 단계가 전부 소진되고 남은 시간 경고까지 나오는 길이.
      drive(s, 3200, 0, said);
      assert.equal(
        new Set(said).size,
        said.length,
        `스테이지 ${i + 1} 중복 대사: ${said.join(' / ')}`,
      );
      assert.ok(said.length >= 3, `스테이지 ${i + 1} 대사 부족: ${said.join(' / ')}`);
    }
  });
});

// ── 2. 막힘 → 단계 상승 / 진전 → 상승 없음 ─────────────────────────────────

describe('whisper — 막힘 감지', () => {
  beforeEach(() => {
    resetWhisper();
  });

  it('제자리에 머물면 힌트 단계가 올라간다', () => {
    const s = freshSession(0);
    assert.equal(whisperDebug().hintLevel, 0);
    drive(s, STALL_FRAMES + 60);
    assert.ok(whisperDebug().hintLevel >= 1, '막혔는데 힌트가 올라가지 않았다');
  });

  it('같은 총 프레임이라도 중간에 진전이 있으면 단계가 올라가지 않는다', () => {
    // A) 진전 없이 1290 프레임 → 올라간다.
    const stuck = freshSession(0);
    drive(stuck, 1290);
    assert.equal(whisperDebug().hintLevel, 1);

    // B) 같은 1290 프레임이지만 중간에 잔상을 하나 확정한다 = 진전.
    const moving = freshSession(0);
    drive(moving, 700);
    assert.equal(whisperDebug().hintLevel, 0);
    commitLoop(moving, 'MANUAL');
    drive(moving, 1290 - 700);
    assert.equal(whisperDebug().hintLevel, 0, '진전이 있었는데 힌트 단계가 올라갔다');
  });

  it('힌트 단계는 스테이지가 정의한 개수를 넘지 않는다', () => {
    const s = freshSession(0);
    const max = STAGE_WHISPERS[STAGES[0]!.id]!.steps.length;
    drive(s, STALL_FRAMES * (max + 3));
    assert.equal(whisperDebug().hintLevel, max);
  });

  // 이 검사가 이 파일에서 가장 중요하다. 예전에는 진전 서명에 조작 몸의 타일
  // 좌표가 들어 있어서, 방을 **돌아다니기만 해도** 막힘 카운터가 매번 0 으로
  // 돌아갔다. 그래서 정작 헤매는 사람(=계속 움직이는 사람)에게는 힌트가 영영
  // 오지 않았다. 실측으로 5분을 헤매도 1단계에서 멈췄다.
  it('방을 헤매고 다니는 사람에게도 힌트가 끝까지 올라간다', () => {
    const s = freshSession(0);
    const max = STAGE_WHISPERS[STAGES[0]!.id]!.steps.length;

    // 20~60 프레임마다 방향을 바꾸며 방을 도는, 전형적인 탐색 행동.
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const dirs = [IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT];
    let dir = dirs[0]!;
    let hold = 0;
    for (let f = 0; f < 60 * 90; f++) {
      if (hold <= 0) {
        dir = dirs[Math.floor(rnd() * 4)]!;
        hold = 20 + Math.floor(rnd() * 40);
      }
      hold--;
      drive(s, 1, dir);
    }

    assert.equal(
      whisperDebug().hintLevel,
      max,
      '헤매는 동안 힌트가 끝까지 올라가지 않았다 — 정답 단계가 영영 안 나온다',
    );
  });

  // 같은 방에서 또 막혀 초기화한 사람은 도움이 **더** 필요하다. 예전에는
  // 막힘 키에 debt 가 섞여 있어서 초기화할 때마다 힌트가 1단계로 되감겼다.
  it('전체 초기화로 같은 스테이지를 다시 시작해도 힌트 단계가 남는다', () => {
    const s = freshSession(0);
    drive(s, STALL_FRAMES * 2 + 60);
    const before = whisperDebug().hintLevel;
    assert.ok(before >= 2, `초기화 전 힌트 단계가 ${before} 뿐이다`);

    fullReset(s);
    drive(s, 60);
    assert.equal(
      whisperDebug().hintLevel,
      before,
      '초기화했더니 힌트가 처음으로 되감겼다 — 가장 막힌 사람이 도움을 잃는다',
    );
  });
});

// ── 3. 모든 스테이지에 대사가 정의돼 있다 ─────────────────────────────────

describe('whisper — 스테이지 대사 정의', () => {
  it('모든 스테이지가 오프닝과 최소 2단계 힌트를 가진다', () => {
    // 개수를 박아 두지 않는다 — 스테이지가 늘거나 줄어도 이 검사는 그대로 유효해야 한다.
    // 하한만 둬서 "STAGES 가 통째로 비면 루프가 공회전한다"만 막는다.
    assert.ok(STAGES.length >= 5, `스테이지가 ${STAGES.length}개뿐이다`);
    const all: string[] = [];
    for (const level of STAGES) {
      const w = STAGE_WHISPERS[level.id];
      assert.ok(w !== undefined, `${level.id} 대사 없음`);
      assert.ok(w.opening.trim().length > 0, `${level.id} 오프닝 비어 있음`);
      assert.ok(w.steps.length >= 2, `${level.id} 힌트 단계 ${w.steps.length}개 (2개 이상 필요)`);
      for (const step of w.steps) {
        assert.ok(step.trim().length > 0, `${level.id} 빈 힌트`);
      }
      all.push(w.opening, ...w.steps);
    }
    assert.equal(new Set(all).size, all.length, '스테이지 간에도 같은 문장을 재사용했다');
  });
});

// ── 4. 속말은 시뮬/세션을 변형하지 않는다 (가장 중요) ──────────────────────

/** 세션에서 시뮬 밖의 진행 상태를 뽑아 문자열로 굳힌다. */
function sessionFingerprint(s: Session): string {
  return [
    s.phase,
    s.mode,
    s.stageIndex,
    s.level.id,
    s.ghosts.length,
    s.ghosts.map((g) => `${g.tape.length}:${g.corpse ? 1 : 0}`).join(','),
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
  ].join('/');
}

describe('whisper — 읽기 전용 보증', () => {
  beforeEach(() => {
    resetWhisper();
  });

  it('updateWhisper 를 반복 호출해도 SimState 해시와 Session 이 그대로다', () => {
    for (let stage = 0; stage < STAGES.length; stage++) {
      const s = freshSession(stage);
      // 여러 국면(시작 직후 / 이동 중 / 확정 후)에서 각각 확인한다.
      const checkpoints: (() => void)[] = [
        () => {},
        () => drive(s, 240, IN_DOWN),
        () => {
          commitLoop(s, 'MANUAL');
          drive(s, LOOP_TRANSITION_TICKS + 30, IN_RIGHT);
        },
      ];
      for (const step of checkpoints) {
        step();
        const hashBefore = hashState(s.sim);
        const fpBefore = sessionFingerprint(s);
        for (let i = 0; i < 200; i++) updateWhisper(s);
        assert.equal(hashState(s.sim), hashBefore, `스테이지 ${stage + 1}: 시뮬 해시가 바뀌었다`);
        assert.equal(sessionFingerprint(s), fpBefore, `스테이지 ${stage + 1}: 세션이 바뀌었다`);
      }
    }
  });

  it('속말을 끼워 돌린 런과 안 끼운 런의 최종 해시가 같다', () => {
    const script: number[] = [];
    for (let i = 0; i < 900; i++) {
      // 결정론적 의사 스크립트 — 난수 금지.
      script.push(i % 7 === 0 ? IN_RIGHT : i % 5 === 0 ? IN_DOWN : i % 3 === 0 ? IN_LEFT : 0);
    }

    for (let stage = 0; stage < STAGES.length; stage++) {
      resetWhisper();
      const withWhisper = createSession();
      startStage(withWhisper, stage);
      for (const input of script) {
        tickSession(withWhisper, input);
        updateWhisper(withWhisper);
      }

      const plain = createSession();
      startStage(plain, stage);
      for (const input of script) tickSession(plain, input);

      assert.equal(
        hashState(withWhisper.sim),
        hashState(plain.sim),
        `스테이지 ${stage + 1}: 속말이 시뮬을 오염시켰다`,
      );
      assert.equal(sessionFingerprint(withWhisper), sessionFingerprint(plain));
    }
  });
});
