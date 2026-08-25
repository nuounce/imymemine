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
  SLOT_NAMES,
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
  gateBlocked: '아, 안 열리네. 안에서는 못 여는 거냐.',
  plateOn: '밟고 있는 동안만 열려 있네.',
  plateStand: '내가 여기 계속 있으면... 문도 계속 열려 있는 거잖아.',
  plateCommit: '여기다 하나 남기고 가면 되겠지.',
  core: '가져왔어. 이제 나가면 돼.',
  // 아이템은 설명서를 띄우지 않고 손에 쥔 사람이 알아채는 걸로 한다.
  flashPicked: '섬광탄이다. ...한 발뿐이네. F로 던지나 보다.',
  flashHold: '터뜨리면 쟤네 잠깐 못 보겠지. 하나뿐이니까 아껴야 된다.',
  flashUsed: '지금이야.',
  suspicious: '...봤나?',
  chase: '들켰어!',
  timeLow: '시간이 없어.',
} as const;

// ── 막에 따라 갈리는 대사 (STORY.md §7) ────────────────────────────────────
//
// 막이 오를수록 **잔상을 부르는 말**이 바뀐다. 사물 → 3인칭 → 망설임 → 1인칭 복수.
// 설명하지 않는다. 호칭만 바뀌고, 그 변화를 알아채는 것은 플레이어의 몫이다.
//
// 트리거도 막힘 단계도 그대로다 — 같은 상황에서 같은 id 가 한 번 나오고,
// 고르는 **문구**만 막을 따라간다.

/** 1막 ~ 4막. `ACT_COUNT` 는 슬롯 이름(I·MY·ME·MINE)의 수에서 나온다. */
export const ACT_COUNT = SLOT_NAMES.length;

/**
 * 레벨 id 의 슬롯 토큰이 곧 막이다: `01_I` → `I` → 1막, `15_MINE_FINAL` → `MINE` → 4막.
 * 스테이지 개수를 나눠 세지 않는다 — 스테이지가 늘어도 막은 id 가 말한다.
 * 알 수 없는 id 는 1막으로 떨어뜨린다(대사가 사라지는 것보다 낫다).
 */
export function actOf(levelId: string): number {
  const token = levelId.split('_')[1] ?? '';
  const i = (SLOT_NAMES as readonly string[]).indexOf(token);
  return i < 0 ? 1 : i + 1;
}

/**
 * 막마다 갈리는 대사. 배열은 1막부터 4막 순서다.
 *
 * **`우리` 는 4막에만 있다.** 그 한 단어가 이 이야기의 도착점이라, 앞선 막에서
 * 미리 쓰면 도착이 사라진다.
 */
export const ACT_LINES = {
  firstCommit: [
    '...저게 나였어.',
    '쟤가 나 대신 서 있어.',
    '쟤도... 나였지.',
    '우리 중 하나가 저기 서 있어.',
  ],
  ghostOnPlate: [
    '저거 계속 밟고 있어. 지금 가야 해.',
    '쟤는 계속 밟고 있어. 지금 가야 해.',
    '쟤가 버티고 있어. ...쟤도 난데. 지금 가야 해.',
    '우리가 밟고 있어. 지금 가야 해.',
  ],
  noSelves: [
    '남길 몸이 이제 없네. ...다 썼다.',
    '저쪽의 나까지 다 썼어.',
    '쟤도, 쟤도... 다 나였어. 더는 없어.',
    '우리 전부야. 더는 없어.',
  ],
  captured: [
    '됐어. 저 자리도 쓸 데가 있어.',
    '됐어. 쟤도 쓸 데가 있어.',
    '됐어. 쟤도... 나였는데.',
    '됐어. 우리는 아직 남았어.',
  ],
} as const;

export type ActLineId = keyof typeof ACT_LINES;

/** 막 번호(1..4)로 대사 하나. 범위를 벗어나면 가장 가까운 막으로 눌러 담는다. */
export function actLine(id: ActLineId, act: number): string {
  const lines = ACT_LINES[id];
  const i = Math.min(lines.length - 1, Math.max(0, Math.floor(act) - 1));
  return lines[i] ?? lines[0];
}

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
    opening: '"회수 후 퇴거"라. 뭘 회수하라는 거야. ...저 금색 덩어리?',
    steps: [
      '문은 저쪽. 발판은 이쪽. ...하.',
      '몸이 하나인데 둘 다 어떻게 하냐고.',
      '발판 밟은 채로 저기 하나 세워 두고, 그 다음에 문으로 가면 되잖아.',
      '여기 선 채로 남긴다. 그럼 이 자리는 계속 눌려 있는 거고.',
    ],
  },
  '02_I': {
    opening: '버튼은 저 끝에 있고, 문은 여기 있고.',
    steps: [
      '뛰어봤어. 닫히기 전엔 못 와.',
      '아, 순서를 바꾸면 되잖아. 문 앞엔 내가 먼저 가 있고, 버튼은 저기 하나 두고.',
      '버튼 누른 자리에 남긴다. 발판이 아니어도 되는 거네.',
    ],
  },
  '03_I': {
    opening: '발판이 둘, 몸은 하나. 계산이 안 맞잖아.',
    steps: [
      '저 상자... 꽤 무겁겠지?',
      '발판은 무겁기만 하면 눌리잖아. 사람일 필요는 없고.',
      '상자는 발판까지 밀어 두고, 남은 발판엔 내가 서서 남긴다.',
    ],
  },
  '04_I': {
    opening: '문을 열었는데 또 문이야. 뭐야 이거.',
    steps: [
      '안쪽 발판은 바깥 문을 지나야 닿는데.',
      '바깥 문 붙잡아 줄 걸 하나 세워 놓고, 그 다음에 안으로 들어가는 거지.',
      '순서가 문제네. 바깥 발판에 하나, 안쪽에 또 하나, 마지막에 내가 지나간다.',
    ],
  },

  // ── 2막 감시 ────────────────────────────────────────────────────────────
  '05_MY': {
    opening: '경비. 복도 저쪽에서 안 비켜.',
    steps: [
      '가만 보니 계속 고개를 돌려. 등 뒤만 노리는 걸론 안 되겠는데.',
      '저 경비, 귀가 밝네. 소리만 나면 바로 그쪽으로 간다.',
      '한쪽에서 누가 시끄럽게 뛰면 반대쪽은 비겠지.',
      '버튼은 잠깐만 열어 줘. 눌리는 순간 내가 이미 문 앞이어야 해.',
      '한 쟤는 남쪽에서 뛰다 발판으로, 다른 쟤는 버튼으로. 지나가는 건 지금 나고.',
    ],
  },
  '06_MY': {
    opening: '...개냐, 저거. 하필 바닥은 밟으면 울리는 철판이고.',
    steps: [
      '한번 물리면 끝까지 쫓아올 것 같은데. 뛰어서 될 상대가 아니다.',
      '빙 돌아가는 조용한 길도 있긴 해. 오래 걸리고.',
      '소리는 쟤한테 맡기자. 쟤가 그쪽에 붙어 있는 동안 내가 지나가면 되고.',
    ],
  },
  '07_MY': {
    opening: '저 덩치로 저 틈은 못 지나가겠는데. ...그럼 됐어.',
    steps: [
      '저 감시등부터 처리해야지. 레버 내리면 꺼지겠지.',
      '레버 내리고 멈추지 말고 발판까지 쭉 가면, 하나로 둘 다 되겠는데.',
      '코어는 저 위 끝이야. 낚아채고 바로 좁은 데로 떨어지면 못 따라와.',
    ],
  },
  '08_MY': {
    opening: '스위치가 하필 저 격자 한복판이야.',
    steps: [
      '어떻게 가도 울려. 그러면 저 덩치가 오고.',
      '이 방 문은 양쪽으로 한 칸씩. 쫓기면 그리로 몸을 던지면 돼.',
      '울리는 건 쟤한테 맡기고, 소리 잦아들면 내가 가면 되고.',
    ],
  },

  // ── 3막 통제 ────────────────────────────────────────────────────────────
  '09_ME': {
    opening: '금고문 앞의 저 사람, 안 움직이네. ...쫓아올 생각이 없는 거야. 부를 생각이지.',
    steps: [
      '버튼에 번호가 붙어 있어. 하나만 틀려도 처음부터야.',
      '두 번째 문도 세 번째 문도 마찬가지야. 누가 올라서 있어야 열려.',
      '발판이 방 양쪽 끝에 하나씩. 몸 하나로 양쪽을 어떻게 누르라는 거야.',
      '저 아래 발판까지 가는 길에 뭐가 하나 굴러다니던데. 거기 서 있을 놈은 어차피 들킬 텐데, 들고 있으라지.',
    ],
  },
  '10_ME': {
    opening: '빛이 끊기는 데 박자가 있어. 하나, 둘... 근데 저 버튼 올라가는 길에 뭐가 하나 떨어져 있네.',
    steps: [
      '외울 것도 없어. 언제 출발하느냐만 맞추면 돼.',
      '문 앞에서 얼쩡대면 감시등에 걸린다. 걸리면 덩치가 오고.',
      '나도, 쟤도... 쟤도 나였고. 각자 빛 꺼질 때 맞춰 건너면 되는 거잖아.',
    ],
  },
  '11_ME': {
    opening: '문마다 버튼이 따로야. 그것도 전부 반대편에. ...아랫길에 또 한 발 떨어져 있고.',
    steps: [
      '눌러 놓고 뛰어도 도착하면 이미 닫혀 있어.',
      '금고문 앞엔 또 감시등이네. 걸리면 개가 붙고.',
      '내가 언제 지나갈지를 먼저 정하고, 거기 맞춰 눌러 줄 쟤를 남긴다. ...쟤도 난데.',
    ],
  },
  '12_ME': {
    opening: '...여긴 한 번만 잘못 써도 끝이다.',
    steps: [
      '내가 넷. 그게 전부야.',
      '상자를 발판에 얹으면 나 하나를 아낄 수 있어.',
      '남쪽 개는 미끼로 붙잡아 놔야 된다. 오래 끌수록 길이 오래 빈다.',
      '북쪽 덩치는 저 세로 통로로 못 내려와. 탈출구는 그 위고.',
    ],
  },

  // ── 4막 경계 ────────────────────────────────────────────────────────────
  '13_MINE': {
    opening: '전기가 하나뿐이네. 문에 넣으면 감시등도 같이 켜지고.',
    steps: [
      '금고 안은 위아래로 레이저가 한 줄씩이네. 가운데만 비었고.',
      '감시등부터 끄고 건넌다. 문은 그다음.',
      '우리 셋이 같이 누르는 순간 전기가 문으로 넘어간다. 그 순간엔 감시등 앞에 있으면 안 된다.',
    ],
  },
  '14_MINE': {
    opening: '레이저에 감시등에 문까지. 근데 전기는 하나.',
    steps: [
      '한 번에 하나만 끌 수 있어. 그럼 하나씩 지나가면 되는 거 아냐?',
      '켜는 순서가 곧 내가 지나가는 순서야.',
      '가운데 방에 개가 있어. 저 다섯 칸을 안 밟고는 못 지나가고.',
      '복도는 한 칸이야. 금고 안의 덩치는 여기까지 못 따라 나와.',
    ],
  },
  '15_MINE_FINAL': {
    opening: '마지막 문이네. ...여태 한 거 전부 써야겠는데.',
    steps: [
      '버튼을 순서대로 다 누르면 레이저도 감시등도 같이 꺼진다.',
      '문으로 가는 길목을 개가 오르내려. 저기부터 넘어야 하고.',
      '근데 문이 열리는 그 순간 전부 되살아나. 봐주는 게 없네.',
      '문이 열리기 전에 우리가 이미 저쪽에 서 있어야 한다는 뜻이야.',
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
  /** 이 스테이지에서 한 번이라도 밟아 본 타일. 루프를 넘어 남는다. */
  seen: Set<string>;
  /** 마지막으로 본 진전 서명. 이게 바뀌면 막힘 카운터가 풀린다. */
  progressSig: string;
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
    progressSig: '',
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
 * 진전 서명 — "퍼즐이 아까보다 앞으로 갔는가"의 요약.
 *
 * 잔상 수 · 코어 소유 · 켜져 있는 채널 집합. **자리(타일)는 여기 없다.**
 *
 * 예전에는 조작 몸의 타일 좌표가 이 서명에 들어 있었다. 그래서 방을 돌아다니며
 * 새 타일을 밟을 때마다 막힘 카운터가 0 으로 돌아갔고, 정작 **헤매는 사람이
 * 곧 계속 움직이는 사람**이라 힌트가 그 사람에게만 영영 오지 않았다.
 * 돌아다니는 것은 진전이 아니다 — 진전은 세계가 바뀌는 것이다.
 */
function progressSigOf(s: Session): string {
  const sim = s.sim;
  const chans: string[] = [];
  for (const [name, on] of sim.channels) if (on) chans.push(name);
  chans.sort();
  return `${s.ghosts.length}|${sim.loot.taken ? 1 : 0}|${sim.loot.holderId}|${chans.join(',')}`;
}

/** 지금 서 있는 타일. 탐색이 끝났는지(=가본 데만 맴도는지) 보는 데만 쓴다. */
function tileOf(live: Body | null): string {
  if (live === null) return '-';
  return `${Math.floor(live.x / TILE_SUB)},${Math.floor(live.y / TILE_SUB)}`;
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
  // 지금 몇 막인가. 잔상을 부르는 말이 여기서 갈린다 (STORY.md §7).
  const act = actOf(s.level.id);

  // 급한 것부터 — 이 셋은 떠 있는 대사를 밀어낸다.
  if (sim.outcome === 'CAPTURED') {
    out.push({ id: 'captured', text: actLine('captured', act), urgent: true });
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

  // 눈뽕: 주운 순간 한 번, 그 뒤 들고 있는 동안 한 번 더.
  // 쓰는 법(F)은 첫 줄에서 흘리고 반복하지 않는다 — 두 번 말하면 설명서가 된다.
  if (live !== null && live.hasFlash) {
    out.push({ id: 'flashPicked', text: GLOBAL_LINES.flashPicked, urgent: false });
    out.push({ id: 'flashHold', text: GLOBAL_LINES.flashHold, urgent: false });
  }
  // 경비가 어지러운 동안 = 방금 터뜨린 직후. 지나갈 창이라는 걸 알려 준다.
  for (const g of sim.guards) {
    if (g.dazed <= 0) continue;
    out.push({ id: 'flashUsed', text: GLOBAL_LINES.flashUsed, urgent: true });
    break;
  }
  if (s.ghosts.length >= MAX_AFTERIMAGES) {
    out.push({ id: 'noSelves', text: actLine('noSelves', act), urgent: false });
  }
  if (s.ghosts.length >= 1) {
    out.push({ id: 'firstCommit', text: actLine('firstCommit', act), urgent: false });
  }

  // 잔상이 발판 위에서 멈춰 있다 = 지금이 지나갈 창이다.
  for (const b of sim.bodies) {
    if (b.isLive || !b.frozen) continue;
    if (!onPlate(sim, b)) continue;
    out.push({ id: 'ghostOnPlate', text: actLine('ghostOnPlate', act), urgent: false });
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
 * **다른 스테이지로 넘어갈 때만** 기억을 통째로 버린다. 같은 스테이지를 전체
 * 초기화(`fullReset`)로 다시 시작하는 것은 "새 방"이 아니라 **여기서 또 막혔다**
 * 는 뜻이므로, 힌트 단계와 이미 뱉은 대사는 그대로 안고 간다. 예전에는 키에
 * `debt` 가 섞여 있어서 초기화할 때마다 힌트가 1단계부터 다시 시작했고,
 * 가장 도움이 필요한 사람이 오히려 도움을 잃었다.
 *
 * `startStage` 가 `elapsedTicks` 를 0 으로 되돌리므로 시간이 **뒤로 간 것**이
 * 곧 초기화의 서명이다. 이때는 화면에 떠 있던 말만 걷어낸다.
 */
function syncStage(s: Session): void {
  const key = `${s.level.id}#${s.stageIndex}`;
  if (rt.key !== key) {
    rt = freshRuntime(key, s.elapsedTicks);
    return;
  }
  if (s.elapsedTicks < rt.lastElapsed) {
    // 같은 방을 다시 시작 — 지금 떠 있는 말과 대기열만 비운다.
    rt.text = null;
    rt.timer = 0;
    rt.pending = [];
    rt.plateFrames = 0;
    rt.hasPrev = false;
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

  // 막힘 감지 — 세 상태를 구분한다.
  //   진전(세계가 바뀜)   : 카운터를 0 으로 되돌린다. 힌트는 필요 없다.
  //   탐색(처음 밟는 타일): 카운터를 **유지**한다. 아직 스스로 찾는 중이다.
  //   맴돎(가본 자리뿐)   : 카운터를 올린다. 이 사람은 지금 막혀 있다.
  //
  // 가본 타일 기록(`seen`)은 루프를 넘어 남는다. 그래서 첫 루프는 온전히
  // 탐색에 쓰이고, 같은 방을 두 번째로 도는 사람에게는 힌트가 빨리 붙는다.
  const psig = progressSigOf(s);
  if (psig !== rt.progressSig) {
    rt.progressSig = psig;
    rt.stall = 0;
  } else {
    const tile = tileOf(live);
    if (rt.seen.has(tile)) {
      rt.stall++;
      const stage = STAGE_WHISPERS[s.level.id];
      const max = stage === undefined ? 0 : stage.steps.length;
      if (rt.stall >= STALL_FRAMES && rt.hintLevel < max) {
        rt.hintLevel++;
        rt.stall = 0;
      }
    } else {
      rt.seen.add(tile);
    }
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
    text: held ? '▸ 탈출구로' : '▸ 억제 코어 확보',
    held,
  };
}
