/**
 * I.MY.ME.MINE — 주인공의 속말 (whisper).
 *
 * HUD 하단의 정적인 힌트 한 줄은 **설명서**였다. 이 모듈은 그 자리를
 * 주인공의 생각으로 바꾼다. 지금 눈앞의 상황을 보고 혼잣말을 흘리고,
 * 플레이어가 오래 막히면 조금씩 더 구체적으로 말해 준다.
 *
 * ## 이 파일의 두 가지 규칙
 *
 * 1. **읽기 전용.** `SimState` 와 `Session` 의 어떤 필드도 쓰지 않는다.
 *    속말이 시뮬을 1비트라도 건드리면 잔상 재생이 어긋나고 결정론이 무너진다
 *    (SPEC §4). 관찰에 필요한 모든 기억은 이 파일의 모듈 스코프에만 쌓인다.
 * 2. **DOM 무접근.** 무엇을 언제 말할지만 정하고, 그리는 일은 `render/hud.ts` 가 한다.
 *
 * 속말 타이머는 **프레임 기준**이다(틱이 아니라). 순수 연출이라 프레임레이트에
 * 따라 길이가 조금 달라져도 무방하고, 대신 TRANSITION 처럼 시뮬 틱이 멈추는
 * 구간에서도 대사가 그대로 굳지 않는다.
 */

import {
  BODY_SUB,
  MAX_AFTERIMAGES,
  MAX_TICKS,
  SUBPIXEL,
  TICK_HZ,
  TILE_SUB,
} from '../sim/constants';
import { aabbOverlap } from '../sim/physics';
import type { Body, SimState } from '../sim/types';
import type { Session } from './session';

// ── 연출 상수 ──────────────────────────────────────────────────────────────

/** 한 대사가 화면에 머무는 프레임 수 (≈3.5초). */
export const WHISPER_HOLD_FRAMES = 210;
const FADE_IN_FRAMES = 12;
const FADE_OUT_FRAMES = 30;

/** 진전 서명이 이만큼 그대로면 다음 단계 힌트를 준다 (≈12초). */
export const STALL_FRAMES = 720;

/** 발판 위에 서 있는 시간 임계 (프레임). */
const PLATE_MUSE_FRAMES = 120; // 2초
const PLATE_COMMIT_FRAMES = 180; // 3초

/** "부딪혔다"로 볼 게이트와의 여유 거리. */
const BUMP_MARGIN = 4 * SUBPIXEL;

/** 남은 시간이 이보다 적으면 조급해진다. */
const TIME_LOW_TICKS = TICK_HZ * 10;

/** 자리가 없어 대기시킬 수 있는 대사 수와, 그 이상 기다리면 버리는 시한. */
const PENDING_MAX = 2;
const PENDING_EXPIRE_FRAMES = 480;

// ── 대사 ───────────────────────────────────────────────────────────────────

/** 스테이지와 무관하게 상황이 만들면 나오는 속말. */
export const GLOBAL_LINES = {
  gateBlocked: '안 열려. ...안에서는.',
  plateOn: '밟고 있는 동안만 열려 있네.',
  plateStand: '내가 여기 계속 있으면... 문도 계속 열려 있는 거잖아.',
  plateCommit: 'R 누르면 되겠지. 여기다 나를 하나 두고 가는 거야.',
  firstCommit: '...저게 나였어.',
  ghostOnPlate: '쟤는 계속 밟고 있어. 지금 가야 해.',
  core: '가져왔어. 이제 나가면 돼.',
  suspicious: '...봤나?',
  chase: '들켰어!',
  timeLow: '시간이 없어.',
  noSelves: '더 남길 나는 없어.',
  captured: '괜찮아. 저 자리도 쓸 데가 있어.',
} as const;

export interface StageWhisper {
  /** 스테이지에 들어서자마자 한 번. */
  opening: string;
  /** 막힐수록 순서대로 구체화된다. 바로 정답을 주면 퍼즐이 죽는다. */
  steps: string[];
}

/**
 * 키는 `LevelDef.id`. 15개 스테이지 전부 오프닝 + 2단계 이상을 가진다.
 *
 * 새 장치는 설명하지 않고 **발밑에서 느끼게** 한다 ("발밑이 울린다").
 * 힌트는 뒤로 갈수록만 구체적이어야 한다 — 첫 단계가 정답이면 퍼즐이 죽는다.
 */
export const STAGE_WHISPERS: Record<string, StageWhisper> = {
  // ── 1막 수용 ────────────────────────────────────────────────────────────
  '01_I': {
    opening: '문은 저쪽. 발판은 이쪽. ...하.',
    steps: [
      '몸이 하나인데 둘 다 어떻게 하냐고.',
      '발판 밟은 채로 나를 하나 두고, 그 다음에 문으로 가면 되잖아.',
    ],
  },
  '02_I': {
    opening: '버튼은 저 끝에 있고, 문은 여기 있고.',
    steps: [
      '뛰어봤어. 닫히기 전엔 못 와.',
      '순서를 바꾸면 되네. 내가 문 앞에 먼저 서 있고, 누르는 건 나중의 내가.',
    ],
  },
  '03_I': {
    opening: '발판이 둘. 나는 하나. 셈이 안 맞아.',
    steps: [
      '저 상자... 꽤 무겁겠지?',
      '발판은 무겁기만 하면 눌리잖아. 사람일 필요는 없고.',
    ],
  },
  '04_I': {
    opening: '문을 열었는데 또 문이야. 뭐야 이거.',
    steps: [
      '안쪽 발판은 바깥 문을 지나야 닿는데.',
      '바깥 문 붙잡아 줄 나를 하나 세워 놓고, 그 다음에 안으로 들어가는 거지.',
    ],
  },

  // ── 2막 감시 ────────────────────────────────────────────────────────────
  '05_MY': {
    opening: '간수. 복도 저쪽에서 안 비켜.',
    steps: [
      '저 사람은 눈보다 귀야. 소리 나는 쪽으로 가.',
      '한쪽에서 누가 시끄럽게 뛰면 반대쪽은 비겠지.',
      '버튼은 잠깐만 열어 줘. 눌리는 순간 내가 이미 문 앞이어야 해.',
    ],
  },
  '06_MY': {
    opening: '밟으면 울리는 바닥이네. 조용히는 못 가겠다.',
    steps: [
      '빙 돌아가는 길도 있긴 해. 오래 걸리고.',
      '누가 울릴지 정하는 게 다야. 시끄러운 쪽을 하나 떼어 놓으면 되잖아.',
    ],
  },
  '07_MY': {
    opening: '저 눈, 계속 이쪽저쪽 훑고 있어.',
    steps: [
      '레버를 내리면 저거 감기겠지.',
      '레버 내리고 멈추지 말고 발판까지 쭉 가면, 하나로 둘 다 되겠는데.',
    ],
  },
  '08_MY': {
    opening: '스위치가 하필 저 격자 한복판이야.',
    steps: [
      '어떻게 가도 울려. 그러면 간수가 오고.',
      '울리는 건 다른 나한테 맡기고, 소리 잦아들면 내가 가면 되고.',
    ],
  },

  // ── 3막 통제 ────────────────────────────────────────────────────────────
  '09_ME': {
    opening: '버튼에 번호가 붙어 있어. 순서대로 밟으라는 거지.',
    steps: [
      '하나만 틀려도 처음부터야. 되감기는 없고.',
      '두 번째 문도 세 번째 문도 마찬가지야. 누가 올라서 있어야 열려.',
      '발판은 지도 양쪽 끝이고. 몸 하나로 양쪽을 어떻게 누르냐고.',
    ],
  },
  '10_ME': {
    opening: '빛이 끊기는 데 박자가 있어. 하나, 둘...',
    steps: [
      '외울 것도 없어. 언제 출발하느냐만 맞추면 돼.',
      '나도, 저쪽의 나도, 각자 자기 틈에 건너면 되는 거잖아.',
    ],
  },
  '11_ME': {
    opening: '문마다 버튼이 따로야. 그것도 전부 반대편에.',
    steps: [
      '눌러 놓고 뛰어도 도착하면 이미 닫혀 있어.',
      '내가 언제 지나갈지를 먼저 정하고, 거기 맞춰 눌러 줄 나를 남겨.',
    ],
  },
  '12_ME': {
    opening: '...이건 한 번이라도 헛으로 쓰면 끝이야.',
    steps: [
      '내가 넷. 그게 전부야.',
      '상자를 발판에 얹으면 나 하나를 아낄 수 있어.',
      '시끄럽게 갈 쪽과 조용히 갈 쪽을 나눠야겠어.',
    ],
  },

  // ── 4막 경계 ────────────────────────────────────────────────────────────
  '13_MINE': {
    opening: '전기가 하나뿐이야. 문에 주면 저 눈이 같이 떠.',
    steps: [
      '눈부터 감기고 건너자. 문은 그 다음이고.',
      '발판 셋이 같이 눌리는 순간 전기가 문으로 넘어가. 그때 난 안 보여야 해.',
    ],
  },
  '14_MINE': {
    opening: '레이저에 눈에 문까지. 근데 전기는 하나.',
    steps: [
      '한 번에 하나만 끌 수 있어. 그럼 하나씩 지나가면 되는 거 아냐?',
      '켜는 순서가 곧 내가 지나가는 순서야.',
    ],
  },
  '15_MINE_FINAL': {
    opening: '마지막 문이네. ...여기까지 온 거 전부 써야 해.',
    steps: [
      '순서를 다 밟으면 빛도 눈도 같이 죽어.',
      '근데 문이 열리는 그 순간 전부 되살아나. 얄짤없네.',
      '문이 열리기 전에 이미 저쪽에 서 있어야 한다는 뜻이야.',
    ],
  },
};

// ── 공개 타입 ──────────────────────────────────────────────────────────────

/** 지금 화면에 떠야 할 속말. `null` 이면 아무 말도 하지 않는다. */
export interface WhisperView {
  text: string;
  /** 페이드 인/아웃이 반영된 0..1 알파. */
  alpha: number;
}

/** HUD 상단 목표 줄. 클리어 조건을 화면에서 지우지 않기 위한 것. */
export interface Objective {
  text: string;
  /** true = 코어를 손에 넣었다 → 이제 탈출구. */
  held: boolean;
}

// ── 모듈 스코프 상태 ───────────────────────────────────────────────────────

interface Runtime {
  /** 스테이지 동일성 키. 바뀌면 전부 리셋한다. */
  key: string;
  lastElapsed: number;
  /** 이 스테이지에서 이미 뱉은 대사 (중복 금지). */
  spoken: Set<string>;
  text: string | null;
  timer: number;
  /** 자리가 나기를 기다리는 대사. 시한이 지나면 버려진다. */
  pending: { text: string; expire: number }[];
  hintLevel: number;
  /** 이 스테이지에서 한 번이라도 본 진전 서명. */
  seen: Set<string>;
  stall: number;
  plateFrames: number;
  prevX: number;
  prevY: number;
  hasPrev: boolean;
}

function freshRuntime(key: string, elapsed: number): Runtime {
  return {
    key,
    lastElapsed: elapsed,
    spoken: new Set<string>(),
    text: null,
    timer: 0,
    pending: [],
    hintLevel: 0,
    seen: new Set<string>(),
    stall: 0,
    plateFrames: 0,
    prevX: 0,
    prevY: 0,
    hasPrev: false,
  };
}

let rt: Runtime = freshRuntime('', 0);

/** 테스트와 타이틀 복귀용. 다음 호출은 오프닝부터 다시 시작한다. */
export function resetWhisper(): void {
  rt = freshRuntime('', 0);
}

/** 테스트 전용 관찰창. 여기 말고는 내부 상태를 노출하지 않는다. */
export function whisperDebug(): {
  hintLevel: number;
  stall: number;
  spoken: string[];
} {
  return { hintLevel: rt.hintLevel, stall: rt.stall, spoken: [...rt.spoken] };
}

// ── 관찰 ───────────────────────────────────────────────────────────────────

function liveBodyOf(sim: SimState): Body | null {
  for (const b of sim.bodies) if (b.isLive) return b;
  return null;
}

function onPlate(sim: SimState, b: Body): boolean {
  for (const p of sim.plates) {
    if (aabbOverlap(b.x, b.y, BODY_SUB, BODY_SUB, p.x, p.y, p.w, p.h)) return true;
  }
  return false;
}

/**
 * 진전 서명 — "이 상황은 아까와 같은 상황인가"의 요약.
 *
 * 잔상 수 · 코어 소유 · 켜져 있는 채널 집합 · 조작 몸의 **타일** 좌표.
 * 퍼즐이 앞으로 나아갔다면 이 넷 중 하나는 반드시 바뀐다.
 */
function signatureOf(s: Session, live: Body | null): string {
  const sim = s.sim;
  const chans: string[] = [];
  for (const [name, on] of sim.channels) if (on) chans.push(name);
  chans.sort();
  const tx = live === null ? -1 : Math.floor(live.x / TILE_SUB);
  const ty = live === null ? -1 : Math.floor(live.y / TILE_SUB);
  return `${s.ghosts.length}|${sim.loot.taken ? 1 : 0}|${sim.loot.holderId}|${chans.join(',')}|${tx},${ty}`;
}

// ── 대사 선택 ──────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  text: string;
  /** true = 지금 떠 있는 대사를 밀어내고 즉시 끼어든다. */
  urgent: boolean;
}

/**
 * 우선순위 순서대로 조건을 훑어 아직 안 뱉은 첫 대사를 고른다.
 * 타이머 순서가 아니라 **상태**가 대사를 고른다는 게 핵심이다.
 */
function pickLine(s: Session, live: Body | null): Candidate | null {
  const sim = s.sim;
  const stage = STAGE_WHISPERS[s.level.id];
  const out: Candidate[] = [];

  // 급한 것부터 — 이 셋은 떠 있는 대사를 밀어낸다.
  if (sim.outcome === 'CAPTURED') {
    out.push({ id: 'captured', text: GLOBAL_LINES.captured, urgent: true });
  }
  let chasing = false;
  let suspicious = false;
  for (const g of sim.guards) {
    if (g.state === 'CHASE') chasing = true;
    if (g.state === 'SUSPICIOUS') suspicious = true;
  }
  if (chasing) out.push({ id: 'chase', text: GLOBAL_LINES.chase, urgent: true });
  if (sim.outcome === 'RUNNING' && MAX_TICKS - sim.tick < TIME_LOW_TICKS) {
    out.push({ id: 'timeLow', text: GLOBAL_LINES.timeLow, urgent: true });
  }

  // 스테이지에 막 들어섰을 때.
  if (stage !== undefined) {
    out.push({ id: 'opening', text: stage.opening, urgent: false });
  }

  if (live !== null && live.carryingLoot) {
    out.push({ id: 'core', text: GLOBAL_LINES.core, urgent: false });
  }
  if (s.ghosts.length >= MAX_AFTERIMAGES) {
    out.push({ id: 'noSelves', text: GLOBAL_LINES.noSelves, urgent: false });
  }
  if (s.ghosts.length >= 1) {
    out.push({ id: 'firstCommit', text: GLOBAL_LINES.firstCommit, urgent: false });
  }

  // 잔상이 발판 위에서 멈춰 있다 = 지금이 지나갈 창이다.
  for (const b of sim.bodies) {
    if (b.isLive || !b.frozen) continue;
    if (!onPlate(sim, b)) continue;
    out.push({ id: 'ghostOnPlate', text: GLOBAL_LINES.ghostOnPlate, urgent: false });
    break;
  }

  if (live !== null && onPlate(sim, live)) {
    // 순서가 곧 각본이다: "여기 남으면 문이 열려 있겠지" 다음에 "R — 남긴다".
    // 3초 조건은 2초 조건을 포함하므로, 우선순위를 이렇게 둬야 둘 다 이 순서로 나온다.
    if (rt.plateFrames >= PLATE_MUSE_FRAMES) {
      out.push({ id: 'plateStand', text: GLOBAL_LINES.plateStand, urgent: false });
    }
    if (rt.plateFrames >= PLATE_COMMIT_FRAMES && s.ghosts.length === 0) {
      out.push({ id: 'plateCommit', text: GLOBAL_LINES.plateCommit, urgent: false });
    }
    for (const p of sim.plates) {
      if (!p.on) continue;
      out.push({ id: 'plateOn', text: GLOBAL_LINES.plateOn, urgent: false });
      break;
    }
  }

  if (live !== null && bumpedClosedGate(sim, live)) {
    out.push({ id: 'gateBlocked', text: GLOBAL_LINES.gateBlocked, urgent: false });
  }
  if (suspicious) {
    out.push({ id: 'suspicious', text: GLOBAL_LINES.suspicious, urgent: false });
  }

  // 막힘 단계 힌트는 맨 마지막 — 상황이 스스로 말해주면 그쪽이 낫다.
  if (stage !== undefined && rt.hintLevel > 0) {
    const step = stage.steps[rt.hintLevel - 1];
    if (step !== undefined) {
      out.push({ id: `step${rt.hintLevel}`, text: step, urgent: false });
    }
  }

  for (const c of out) if (!rt.spoken.has(c.id)) return c;
  return null;
}

/** 닫힌 게이트에 붙어서, 가려는데 못 가고 있는가. */
function bumpedClosedGate(sim: SimState, live: Body): boolean {
  if (!rt.hasPrev) return false;
  if (live.x !== rt.prevX || live.y !== rt.prevY) return false; // 움직였으면 안 막힌 것
  if (live.lastInput === 0) return false;
  for (const g of sim.gates) {
    if (g.open) continue;
    if (
      aabbOverlap(
        live.x - BUMP_MARGIN,
        live.y - BUMP_MARGIN,
        BODY_SUB + BUMP_MARGIN * 2,
        BODY_SUB + BUMP_MARGIN * 2,
        g.x,
        g.y,
        g.w,
        g.h,
      )
    ) {
      return true;
    }
  }
  return false;
}

// ── 갱신 ───────────────────────────────────────────────────────────────────

/**
 * 스테이지가 바뀌었거나 초기화됐는지 본다.
 *
 * `startStage` 는 `elapsedTicks` 를 0 으로 되돌리므로 시간이 **뒤로 간 것**이
 * 곧 초기화의 서명이다. `fullReset` 은 `debt` 도 올리므로 같은 스테이지를
 * 그대로 다시 시작해도 키가 달라진다.
 */
function syncStage(s: Session): void {
  const key = `${s.level.id}#${s.stageIndex}#${s.debt}`;
  if (rt.key !== key || s.elapsedTicks < rt.lastElapsed) {
    rt = freshRuntime(key, s.elapsedTicks);
    return;
  }
  rt.lastElapsed = s.elapsedTicks;
}

function speak(line: string): void {
  rt.text = line;
  rt.timer = WHISPER_HOLD_FRAMES;
}

function advance(s: Session): void {
  const live = liveBodyOf(s.sim);

  // 발판 체류 시간 — 대사가 "지금 그러고 있다"를 알아야 한다.
  if (live !== null && onPlate(s.sim, live)) rt.plateFrames++;
  else rt.plateFrames = 0;

  // 막힘 감지: 처음 보는 서명이면 진전, 이미 본 서명이면 제자리걸음.
  const sig = signatureOf(s, live);
  if (rt.seen.has(sig)) {
    rt.stall++;
    const stage = STAGE_WHISPERS[s.level.id];
    const max = stage === undefined ? 0 : stage.steps.length;
    if (rt.stall >= STALL_FRAMES && rt.hintLevel < max) {
      rt.hintLevel++;
      rt.stall = 0;
    }
  } else {
    rt.seen.add(sig);
    rt.stall = 0;
  }

  if (rt.timer > 0) rt.timer--;

  // 조건은 순간적이다 — 게이트에 부딪힌 그 몇 프레임에 마침 다른 대사가 떠
  // 있으면 그대로 삼켜진다. 그래서 삼키지 않고 잠깐 물고 있는다.
  const next = pickLine(s, live);
  if (next !== null) {
    rt.spoken.add(next.id); // 물린 순간 "말한 것"으로 친다 — 다시 줄 서지 않게.
    if (rt.timer <= 0 || next.urgent) {
      speak(next.text);
    } else {
      if (rt.pending.length >= PENDING_MAX) rt.pending.shift();
      rt.pending.push({ text: next.text, expire: PENDING_EXPIRE_FRAMES });
    }
  }

  // 대기 중인 말은 자리가 나면 나가고, 너무 늦어지면 조용히 버린다.
  for (const p of rt.pending) p.expire--;
  rt.pending = rt.pending.filter((p) => p.expire > 0);
  if (rt.timer <= 0 && rt.pending.length > 0) {
    speak(rt.pending.shift()!.text);
  }

  if (live !== null) {
    rt.prevX = live.x;
    rt.prevY = live.y;
    rt.hasPrev = true;
  }
}

/**
 * 매 프레임 호출. 상태를 읽어 속말을 고르고, 지금 그려야 할 것을 돌려준다.
 * **인자로 받은 세션을 절대 변형하지 않는다.**
 */
export function updateWhisper(s: Session): WhisperView | null {
  syncStage(s);
  if (!s.paused && (s.phase === 'PLAY' || s.phase === 'TRANSITION')) advance(s);

  if (rt.text === null || rt.timer <= 0) return null;
  const elapsed = WHISPER_HOLD_FRAMES - rt.timer;
  const a = Math.min(1, elapsed / FADE_IN_FRAMES, rt.timer / FADE_OUT_FRAMES);
  return { text: rt.text, alpha: Math.max(0, a) };
}

/**
 * 지금 무엇을 해야 하는가. 이게 없으면 클리어 조건이 게임 어디에도 없다.
 * 잔상이 코어를 들고 있어도 **내가** 들지 않았으면 아직 1단계다 (SPEC §2).
 */
export function currentObjective(s: Session): Objective {
  const live = liveBodyOf(s.sim);
  const held = live !== null && live.carryingLoot;
  return {
    text: held ? '▸ 탈출구로' : '▸ 억제 코어를 손에 넣어라',
    held,
  };
}
