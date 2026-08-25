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
 * 문구는 `hints/v3.md` 가 원본이다. 여기서는 마크다운 백틱만 벗겨 담는다.
 * 힌트는 뒤로 갈수록만 구체적이어야 한다 — 첫 단계가 정답이면 퍼즐이 죽는다.
 */
export const STAGE_WHISPERS: Record<string, StageWhisper> = {
  // ── 1막 수용 ────────────────────────────────────────────────────────────
  '01_I': {
    opening: '금색 코어가 목표물이다. 하지만 문과 발판은 서로 반대편에 있다.',
    steps: [
      '발판에서 내려오는 순간 문이 닫힌다. 혼자서는 발판과 문을 동시에 맡을 수 없다.',
      'R을 누르면 잔상이 남고 새 루프가 시작된다. 발판 위의 나는 그 자리에 남는다.',
      '먼저 발판 위까지 가서 R을 누른다. 다음 루프에서는 잔상이 문을 열어 둔다.',
      '발판 위에서 R을 누르면, 새로 시작한 내가 열린 문을 지나 코어와 출구로 간다.',
    ],
  },
  '02_I': {
    opening: '버튼과 문이 너무 멀다. 누른 뒤 출발하면 문이 먼저 닫힌다.',
    steps: [
      '달려도 늦는다. 문제는 속도가 아니라 버튼을 누르는 순서다.',
      '먼저 문 앞까지 간 뒤 기다린다. 그동안 잔상은 반대편에서 버튼으로 간다.',
      '잔상은 버튼 앞에서 기다렸다가 내가 문 앞에 올 때 E를 누른다.',
    ],
  },
  '03_I': {
    opening: '발판은 둘인데 몸은 하나다. 둘 다 계속 눌러야 문이 열린다.',
    steps: [
      '주변의 상자도 발판을 누를 만큼 무겁다.',
      '상자를 첫 번째 발판까지 밀어 놓으면 그 발판은 계속 켜진다.',
      '남은 발판 위에서 R을 눌러 잔상을 남기면 두 발판이 함께 눌린다.',
    ],
  },
  '04_I': {
    opening: '첫 문 뒤에 또 다른 문이 있다. 두 발판을 누르는 순서가 중요하다.',
    steps: [
      '안쪽 발판은 바깥 문을 통과해야만 닿을 수 있다.',
      '첫 잔상은 바깥 발판을 맡아 바깥 문을 계속 열어 둬야 한다.',
      '열린 바깥 문을 지나 안쪽 발판으로 가서 두 번째 R을 누른다.',
    ],
  },

  // ── 2막 감시 ────────────────────────────────────────────────────────────
  '05_MY': {
    opening: '금고로 가는 복도를 경비가 지키고 있다. 발판과 버튼도 서로 멀리 떨어져 있다.',
    steps: [
      '경비는 시야뿐 아니라 소리에도 반응한다. 뛰면 소리가 난다.',
      '남쪽 방에서 뛰면 경비가 복도 밖으로 간다. 그 몸은 그대로 발판까지 간다.',
      '남쪽에서 뛴 다음 그대로 발판까지 가서 잔상을 남긴다. 이 잔상이 경비와 발판을 함께 맡는다.',
      '버튼은 잠깐만 문을 연다. 현재의 나는 문 앞에 미리 도착해 있어야 한다.',
      '첫 잔상은 경비와 발판, 둘째는 버튼, 마지막 몸은 문을 맡는다.',
    ],
  },
  '06_MY': {
    opening: '가운데 철망 바닥은 걸어도 소리가 난다. 사냥개는 그 길을 끝까지 따른다.',
    steps: [
      '철망 소리를 들은 사냥개는 끝까지 따라온다. 달려서는 오래 못 버틴다.',
      '아래쪽에는 멀지만 소리가 나지 않는 우회로가 있다.',
      '첫 잔상은 발판, 둘째는 철망을 밟아 소리를 내며 버튼으로 간다.',
    ],
  },
  '07_MY': {
    opening: '감시안이 길을 보고 있다. 하지만 큰 경비는 한 칸짜리 통로로 들어오지 못한다.',
    steps: [
      '먼저 레버를 내려 감시안을 꺼야 안전하게 지나갈 수 있다.',
      '레버를 내린 잔상이 발판까지 가면, 감시안을 끄고 문도 연다.',
      '다른 잔상은 시간차 버튼을 누른다. 마지막 몸은 그때 코어로 간다.',
    ],
  },
  '08_MY': {
    opening: '발판은 왼쪽 끝에 있고, 감시안 레버는 시끄러운 철망 한가운데에 있다.',
    steps: [
      '레버로 가면 반드시 소리가 난다. 그 소리를 들은 큰 경비가 철망 쪽으로 온다.',
      '소리 낼 잔상과 금고 갈 몸을 나눈다. 한 칸 문은 쫓길 때 탈출로다.',
      '레버 잔상이 큰 경비를 남쪽으로 유인한다. 마지막 몸은 남쪽 끝에서 출발한다.',
    ],
  },

  // ── 3막 통제 ────────────────────────────────────────────────────────────
  '09_ME': {
    opening: '번호가 붙은 버튼 세 개와 양끝의 발판 두 개가 있다.',
    steps: [
      '버튼은 왼쪽부터 차례로 눌러야 한다. 순서를 틀리면 처음부터다.',
      '두 번째와 세 번째 버튼 앞의 문은 각각 다른 발판이 눌려야 열린다.',
      '발판이 양쪽 끝에 하나씩이라 한 몸으로는 둘을 동시에 밟을 수 없다.',
      '각 발판에 잔상을 남긴다. 동쪽 잔상은 섬광탄을 주워 들키면 사용한다.',
    ],
  },
  '10_ME': {
    opening: '레이저는 일정한 박자로 켜졌다 꺼진다. 버튼으로 가는 길에는 섬광탄도 하나 있다.',
    steps: [
      '레이저는 외울 필요가 없다. 꺼진 순간에 맞춰 출발하면 된다.',
      '문 앞 경비에게 들키면 경보가 울린다. 섬광탄을 쓰면 잠시 안전해진다.',
      '버튼 잔상이 섬광탄으로 경비를 멈춘 뒤 버튼을 누른다.',
    ],
  },
  '11_ME': {
    opening: '짧게만 열리는 문이 여러 개다. 각 문을 여는 버튼도 서로 다른 곳에 있다.',
    steps: [
      '버튼을 누른 다음 달려가면 문이 닫힌 뒤에 도착한다.',
      '금고문 앞 경비에게 들키면 사냥개가 붙는다.',
      '버튼은 내가 닿을 때, 섬광탄은 문 앞이 빌 때 쓰게 녹화한다.',
    ],
  },
  '12_ME': {
    opening: '할 일은 많지만 쓸 수 있는 몸은 넷뿐이다. 상자로 한 역할을 대신해야 한다.',
    steps: [
      '발판 둘, 레버, 버튼, 사냥개 유인까지 모두 몸으로 하면 인원이 모자란다.',
      '상자를 첫 발판에 올리면 그 발판을 맡을 몸 하나가 필요 없어진다.',
      '한 잔상은 레버와 버튼, 다른 잔상은 남쪽에서 뛰며 사냥개를 유인한다.',
      '마지막 몸은 남쪽 길로 코어에 간다. 큰 경비는 북쪽에 갇혀 출구도 안전하다.',
    ],
  },

  // ── 4막 경계 ────────────────────────────────────────────────────────────
  '13_MINE': {
    opening: '전력은 하나다. 문을 열면 감시안이 켜지고, 감시안을 끄면 문은 닫힌다.',
    steps: [
      '감시안을 끈 상태와 문이 열린 상태는 동시에 만들 수 없다.',
      '금고 위쪽에는 큰 경비와 코어가 있고, 아래쪽에는 사냥개와 출구가 있다.',
      '감시안을 끈 뒤 복도를 건너고, 세 번째 발판 잔상은 늦게 남긴다.',
    ],
  },
  '14_MINE': {
    opening: '레이저, 감시안, 금고문이 모두 하나의 전력을 나눠 쓴다.',
    steps: [
      '한 번에 하나만 끌 수 있다. 레버를 누르는 순서가 안전하게 지나는 순서가 된다.',
      '첫 잔상은 레이저를 끄고 발판으로 간다.',
      '감시안이 꺼지면 사냥개가 끝에 있을 때 가운데 방을 지난다.',
      '문이 열리면 레이저와 감시안이 다시 켜진다. 큰 경비는 문칸까지 못 온다.',
    ],
  },
  '15_MINE_FINAL': {
    opening: '마지막 문이 열리면 레이저와 감시안은 다시 켜진다. 문 앞 대기는 위험하다.',
    steps: [
      '세 버튼을 모두 누르면 레이저와 감시안은 꺼진다.',
      '사냥개는 버튼 뒤 문으로 가는 길을 막는다. 끝에 있을 때 건넌다.',
      '문이 열리기 전에 레이저를 건너 동쪽에서 기다려야 한다.',
      '첫째와 둘째 잔상은 바로 발판으로, 셋째만 늦게 마지막 발판으로 간다.',
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
