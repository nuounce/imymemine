/**
 * HUD · 오버레이 · 타이틀 (SPEC §8).
 *
 * 이 게임의 HUD는 장식이 아니라 **자원 표시기**다. 남은 시간·남은 몸·남은
 * 덮어쓰기·누적 부채가 곧 전략의 입력값이라, 넷 다 항상 화면에 있어야 한다.
 *
 * **아트 방향: 홀로그램이 아니라 시설 표지판이다.** 세계가 콘크리트 지하 시설이므로
 * 정보도 공중에 떠 있는 SF 인터페이스가 아니라 **벽에 붙은 강철 표지판·스텐실 도장·
 * 산업용 계기**로 보여야 한다. 그래서 이 파일에는 세 가지 규칙이 있다:
 *
 * 1. 밴드·패널은 **불투명**하다. 반투명 발광 패널은 즉시 홀로그램으로 읽힌다.
 * 2. 테두리는 발광하지 않는다 — 금속 모서리에 조명이 걸린 1px 하이라이트뿐이다.
 * 3. 위험 정보(DEBT / ALERTS / 남은 시간 부족 / 남은 몸 0)는 **경고 사선**으로 말한다.
 *
 * 단 색은 새로 발명하지 않는다: 전부 `palette.ts` 의 콘크리트·강철·조명 토큰에서
 * 파생시킨다. 잔상 4색(C_SLOT)은 정체성 시스템이라 그대로 둔다.
 *
 * 그리고 **가독성이 분위기보다 우선한다.** 저채도로 내려가도 명도는 내리지 않는다 —
 * 스텐실 라벨은 글자 뒤에 어두운 잉크 헤일로를 깔아 얼룩진 판 위에서도 대비를 지킨다.
 */
import {
  BODY_SUB,
  CANVAS_H,
  CANVAS_W,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  INTERACT_RANGE,
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  MAX_TICKS,
  RESET_HOLD_TICKS,
  SLOT_NAMES,
  SUBPIXEL,
  TICK_HZ,
  TILE_SUB,
} from '../sim/constants';
import {
  PICK_PADS,
  PICK_PANEL,
  STICK_DEAD_R,
  STICK_R,
  STICK_RUN_R,
  TOUCH_PADS,
  type PadId,
  type TouchPad,
  type TouchView,
} from '../engine/touch';
import {
  loadBest,
  runTotals,
  type BestRecord,
  type Mode,
  type PlayMode,
  type RunResult,
  type Session,
  type StageSplit,
} from '../game/session';
import { STAGES } from '../game/levels';
import { currentObjective, updateWhisper, type WhisperView } from '../game/whisper';
import type { MicView } from '../engine/mic';
import type { Body } from '../sim/types';
import { drawKeycap, keycapBox } from './keycap';
import {
  A_SLOT,
  C_BG,
  C_CORPSE,
  C_DANGER,
  C_I_CORE,
  C_I_RING,
  C_LAMP,
  C_LOOT,
  C_METAL_DARK,
  C_METAL_LIP,
  C_OFF,
  C_ON,
  C_RUST,
  C_SEAM,
  C_SEAM_LIP,
  C_SLOT,
  C_TEXT,
  C_TEXT_DIM,
  C_VOID,
  font,
  MONO,
  mulHex,
  withAlpha,
} from './palette';

const PAD = 14;

// ── 표지판 자재 (전부 palette 토큰에서 파생) ───────────────────────────────

/** 표지판 강철판. 불투명하게 칠할 때의 바탕. */
const C_PLATE = mulHex(C_METAL_DARK, 0.78);
/** 판에 파인 홈(계기 트랙·비어 있는 명찰). 판보다 어두워야 "파였다"로 읽힌다. */
const C_PLATE_LO = mulHex(C_METAL_DARK, 0.5);
/** 모서리에 걸린 빛 한 줄. **발광이 아니다** — 금속 립(C_METAL_LIP)을 그대로 쓴다. */
const C_EDGE = C_METAL_LIP;
/** 스텐실 도장 흰색 = 형광등 색. 저채도인데 명도가 높아 가독성을 안 깎는다. */
const C_STENCIL = C_LAMP;
/** 보조 라벨용 스텐실. 판 위에서 여전히 4:1 이상 대비가 남는 선까지만 내렸다. */
const C_STENCIL_DIM = mulHex(C_LAMP, 0.58);
/**
 * 경고 사선의 노랑. 세계의 셔터 도색(C_HAZARD)은 조명 밖 금속이라 더 어둡고,
 * CORE 금색(C_LOOT)은 화면에서 유일한 "주목물"이라 더 밝다. HUD 사선은 그 사이 —
 * 산업 현장의 노랑으로 읽히되 CORE 의 자리를 다투지 않는다.
 */
const C_STRIPE = mulHex(C_LOOT, 0.66);

const BAND_TOP_H = 50;
const BAND_BOT_H = 40;

// ── 터치 UI 스위치 ─────────────────────────────────────────────────────────
//
// 터치 기기에서만 켜진다. **꺼져 있는 동안 이 파일의 출력은 한 픽셀도 달라지지
// 않는다** — 데스크톱 화면을 지키는 장치가 이 플래그 하나다. 새 코드는 전부
// `if (touchUi)` 안에서만 그리거나, 삼항으로 기존 값을 그대로 되돌린다.

let touchUi = false;

/** main.ts 가 터치 기기를 판정한 순간 한 번 켠다. */
export function setTouchUi(on: boolean): void {
  touchUi = on;
}

// ── 탭 히트 영역 ───────────────────────────────────────────────────────────
//
// 메뉴/오버레이는 캔버스에 그려지므로 DOM 히트테스트가 없다. 그래서 **그리는 데
// 쓰는 상수 그대로** 사각형을 내보내고 main.ts 가 탭 좌표를 그 위에 얹는다.
// 손가락은 마우스보다 크므로 히트 영역은 보이는 칩보다 넉넉하다(칩 캡션 줄까지 덮는다).

export interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 타이틀의 세로 리듬. 각 줄은 칩(28) → 칩별 캡션(+12) → 설명 한 줄(+30) 을 쓴다.
 * 그 아래 조작 안내(432) · PLAY(444) · 인트로(496) · 키 목록(524~) 순으로 내려간다.
 * (TITLE_HITS 가 이 값들을 읽으므로 선언이 먼저 와야 한다 — TDZ.)
 */
const ROW1_Y = 288;
const ROW2_Y = 356;
const CHIP_H = 28;

/** 플레이 방식 칩 한 줄의 기하. drawPlayModeRow 와 TITLE_HITS 가 공유한다. */
const PM_CHIP_W = 176;
const PM_GAP = 12;
/** 감지 방식 칩 한 줄의 기하. */
const DT_CHIP_W = 200;
const DT_GAP = 16;

const PLAY_BTN_W = 220;
const PLAY_BTN_H = 36;
const PLAY_BTN_Y = 444;

/** 터치에서만 그려지는 두 버튼. 데스크톱의 키 목록 자리를 대신 쓴다. */
const TOUCH_INTRO_BTN = { x: 268, y: 524, w: 200, h: 34 } as const;
const TOUCH_MUTE_BTN = { x: 492, y: 524, w: 200, h: 34 } as const;

function rowStartX(chipW: number, gap: number, count: number): number {
  return (CANVAS_W - (chipW * count + gap * (count - 1))) / 2;
}

/** 타이틀의 탭 대상. id 는 main.ts 가 그대로 분기한다. */
export const TITLE_HITS: readonly HitRect[] = [
  ...[0, 1, 2].map((i) => ({
    id: `PLAY_MODE_${i}`,
    x: rowStartX(PM_CHIP_W, PM_GAP, 3) + i * (PM_CHIP_W + PM_GAP),
    y: ROW1_Y - 8,
    w: PM_CHIP_W,
    h: CHIP_H + 24,
  })),
  ...[0, 1].map((i) => ({
    id: `DETECT_${i}`,
    x: rowStartX(DT_CHIP_W, DT_GAP, 2) + i * (DT_CHIP_W + DT_GAP),
    y: ROW2_Y - 8,
    w: DT_CHIP_W,
    h: CHIP_H + 24,
  })),
  { id: 'PLAY', x: (CANVAS_W - PLAY_BTN_W) / 2 - 10, y: PLAY_BTN_Y - 6, w: PLAY_BTN_W + 20, h: PLAY_BTN_H + 12 },
  { id: 'INTRO', ...TOUCH_INTRO_BTN },
  { id: 'MUTE', ...TOUCH_MUTE_BTN },
];

const PAUSE_RESUME_BTN = { x: 260, y: 400, w: 200, h: 46 } as const;
const PAUSE_MUTE_BTN = { x: 500, y: 400, w: 200, h: 46 } as const;
/** 일시정지에서 조작법으로. 손가락에게는 `H` 키가 존재하지 않는다. */
const PAUSE_HELP_BTN = { x: 380, y: 462, w: 200, h: 42 } as const;

/** 일시정지 화면의 탭 대상(터치 전용). */
export const PAUSE_HITS: readonly HitRect[] = [
  { id: 'RESUME', ...PAUSE_RESUME_BTN },
  { id: 'MUTE', ...PAUSE_MUTE_BTN },
  { id: 'HELP', ...PAUSE_HELP_BTN },
];

/**
 * 우상단 `?` 버튼. 터치 기기에서 조작법 패널로 들어가는 유일한 문이다.
 * 상단 밴드(0..50) 아래, PAUSE 패드(x 905..947) 왼쪽 — 어느 것도 가리지 않는다.
 */
const HELP_BTN = { x: 846, y: 54, w: 44, h: 44 } as const;

/** `?` 버튼의 탭 영역. 손가락은 마우스보다 크므로 보이는 원보다 넉넉하다. */
export const HELP_HITS: readonly HitRect[] = [
  { id: 'HELP', x: HELP_BTN.x - 8, y: HELP_BTN.y - 8, w: HELP_BTN.w + 16, h: HELP_BTN.h + 16 },
];

/** 점이 사각형 안인가. 경계는 포함한다. */
export function hitTest(hits: readonly HitRect[], x: number, y: number): string | null {
  for (const h of hits) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.id;
  }
  return null;
}

// ── 상황별 키 프롬프트 ─────────────────────────────────────────────────────
//
// 키 표를 읽고 외우게 하는 방식은 통하지 않는다. 그래서 여기서는 **필요한 순간에
// 필요한 키 하나만** 조작 중인 몸 옆에 띄운다. 그 상황이 처음 됐을 때 3초, 페이드로
// 들어오고 나가며, 해당 키를 실제로 누르면 즉시 사라진다(= 배웠다는 신호).
//
// **이 블록은 Session/SimState 를 읽기만 한다.** 표시 상태는 전부 아래 모듈 스코프
// 변수와 localStorage 에만 있다 — 세션에 한 바이트라도 쓰면 결정론이 깨진다.

export type PromptId = 'MOVE' | 'INTERACT' | 'COMMIT' | 'OVERWRITE' | 'RUN' | 'TIMEUP';

interface PromptCopy {
  /** 키보드용 키캡 라벨. 빈 문자열이면 키캡 없이 문구만. */
  key: string;
  /** 터치용 버튼 라벨. 화면에 실제로 있는 그 버튼의 이름이어야 한다. */
  touchKey: string;
  line: string;
  color: string;
  /** 이 게임의 핵심 동작 — 더 크게, 경고 사선까지 두른다. */
  big?: boolean;
}

const PROMPT_COPY: Readonly<Record<PromptId, PromptCopy>> = {
  MOVE: { key: 'WASD', touchKey: '스틱', line: '움직여 봐', color: C_STENCIL },
  INTERACT: { key: 'E', touchKey: 'E', line: '만져 본다', color: C_ON },
  COMMIT: { key: 'R', touchKey: 'COMMIT', line: '여기 나를 남긴다', color: C_LOOT, big: true },
  OVERWRITE: { key: 'Q', touchKey: 'Q', line: '잔상 하나를 다시 녹화', color: C_LOOT },
  RUN: { key: 'SHIFT', touchKey: '링 밖', line: '뛰면 소리가 난다', color: C_DANGER },
  TIMEUP: { key: '', touchKey: '', line: '곧 강제로 확정된다', color: C_DANGER },
};

/**
 * 동시에 두 개를 띄우지 않는다 — 배울 것이 둘이면 아무것도 배우지 않는다.
 * 앞에 있는 것이 먼저다: 지금 위험한 것(R / 발각) → 지금 할 수 있는 것 → 나머지.
 */
const PROMPT_ORDER: readonly PromptId[] = [
  'COMMIT',
  'RUN',
  'INTERACT',
  'OVERWRITE',
  'TIMEUP',
  'MOVE',
];

/** 표시 시간 약 3초. 60fps 렌더 프레임 기준(시뮬 틱이 아니다). */
const PROMPT_FRAMES = 180;
const PROMPT_FADE_IN = 12;
const PROMPT_FADE_OUT = 20;
/** 키를 실제로 눌렀을 때의 퇴장. "즉시"이되 툭 끊기지는 않는 값. */
const PROMPT_DISMISS_FRAMES = 6;

/** 몸 중심에서 프롬프트까지의 거리. 몸(24px)을 확실히 비켜 간다. */
const PROMPT_OFFSET = 34;
const PROMPT_MARGIN = 16;
/**
 * 프롬프트가 들어갈 수 있는 세로 띠.
 *
 * 아래 경계 496 은 **좌하단 속말 자리를 침범하지 않기 위한 값**이다: 속말 말풍선의
 * 상단은 `CANVAS_H - 54 - 26 = 520` 이므로(drawWhisper 참고) 24px 이 남는다.
 * 위 경계 92 는 상단 밴드(50) · 목표 표지판(~76) · LISTEN 계기판(58..82) 아래다.
 */
const PROMPT_TOP = 92;
const PROMPT_BOTTOM = 496;
/** 터치에서는 위아래 모두 좁다: 위는 `?`/PAUSE 패드(53..98), 아래는 액션 패드(372~). */
const PROMPT_TOP_TOUCH = 104;
const PROMPT_BOTTOM_TOUCH = 366;

/** 이미 배운 안내. 다음 플레이에서도 반복하지 않으므로 localStorage 에 남는다. */
const TAUGHT_KEY = 'imm.taught';
const taught = new Set<PromptId>();
let taughtLoaded = false;

/**
 * 저장소가 막힌 환경(사파리 프라이빗 모드·쿠키 차단)에서 localStorage 는 **접근만
 * 해도** 예외를 던진다. 안내가 매 판 다시 나오는 것이 게임이 죽는 것보다 낫다.
 */
function loadTaught(): void {
  if (taughtLoaded) return;
  taughtLoaded = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(TAUGHT_KEY);
    if (raw === null) return;
    for (const part of raw.split(',')) {
      if (part in PROMPT_COPY) taught.add(part as PromptId);
    }
  } catch {
    /* 저장소 없음 — 이번 판만 안내가 나온다. */
  }
}

function saveTaught(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TAUGHT_KEY, [...taught].join(','));
  } catch {
    /* 위와 같음 */
  }
}

/** 렌더 프레임 카운터(프롬프트 전용). 시뮬 상태가 아니다. */
let promptClock = 0;
let promptId: PromptId | null = null;
let promptStart = 0;
let promptEnd = 0;
/** 조작법 패널이 열려 있는가. 열린 동안 프롬프트 시계는 멈춘다. */
let helpOpen = false;

/** main.ts 가 `H` / `?` / 탭으로 패널을 열고 닫을 때 알린다. */
export function setHelpOpen(on: boolean): void {
  helpOpen = on;
}

export function isHelpOpen(): boolean {
  return helpOpen;
}

/**
 * 그 키를 실제로 써 봤다 = 배웠다. 떠 있던 프롬프트는 즉시 물러간다.
 *
 * 이동/상호작용/달리기는 입력 마스크에서 직접 읽히지만, `R`/`Q` 는 테이프에 녹화되지
 * 않는 메타키라 마스크에 없다 — 그 둘만 main.ts 가 이 함수로 알려준다.
 */
export function learnPrompt(id: PromptId): void {
  if (taught.has(id)) return;
  taught.add(id);
  saveTaught();
  if (promptId === id) {
    promptEnd = Math.min(promptEnd, promptClock + PROMPT_DISMISS_FRAMES);
  }
}

/** 안내를 처음부터 다시 받는다. 지금은 부르는 곳이 없다 — 개발 중 확인용. */
export function resetTaught(): void {
  taught.clear();
  taughtLoaded = true;
  saveTaught();
  promptId = null;
}

/** 조작 중인 몸(I). 없으면 undefined — 전환 직후 한두 프레임 그럴 수 있다. */
function liveBody(s: Session): Body | undefined {
  return s.sim.bodies.find((b) => b.isLive);
}

/**
 * 내가 밟고 있는 발판이 지금 ON 인가.
 *
 * "채널이 ON 됐다"만 보면 잔상이 밟은 것까지 걸린다. 이 프롬프트가 가르치려는 것은
 * **내가 여기 서 있어야 문이 열린다 → 그러니 나를 여기 남긴다** 이므로, 판정은
 * 반드시 조작 중인 몸과 발판의 겹침이어야 한다.
 */
function standingOnLivePlate(s: Session): boolean {
  const me = liveBody(s);
  if (me === undefined) return false;
  for (const p of s.sim.plates) {
    if (!p.on) continue;
    if (me.x < p.x + p.w && p.x < me.x + BODY_SUB && me.y < p.y + p.h && p.y < me.y + BODY_SUB) {
      return true;
    }
  }
  return false;
}

/** 지금 이 상황인가. 전부 Session/SimState **읽기**뿐이다. */
function promptArmed(id: PromptId, s: Session): boolean {
  switch (id) {
    case 'MOVE':
      // 스테이지 1의 첫 루프. "아직 안 움직였다"는 taught 가 대신 말한다 —
      // 이동 비트가 한 번이라도 들어오면 그 즉시 배운 것으로 기록된다.
      return s.stageIndex === 0 && s.ghosts.length === 0 && s.loopIndex === 0;
    case 'INTERACT':
      // 터치 INTERACT 패드가 살아나는 판정과 **같은 함수**를 쓴다(사거리 규칙 1개).
      return nearInteractable(s);
    case 'COMMIT':
      return standingOnLivePlate(s);
    case 'OVERWRITE':
      // 잔상이 있고, par 를 넘겼고, 아직 이 스테이지의 덮어쓰기가 남아 있다.
      return s.ghosts.length >= 1 && s.ghosts.length > s.level.par && s.overwriteLeft > 0;
    case 'RUN':
      // `spotted` = 이번 루프에 간수/감시안에 발각된 적이 있는가 (sim 이 세우는 깃발).
      return liveBody(s)?.spotted === true;
    case 'TIMEUP':
      return MAX_TICKS - s.sim.tick < TICK_HZ * 10;
    default:
      return false;
  }
}

/**
 * 프롬프트 상태 갱신. 매 렌더 프레임 1회, `drawHud` 안에서만 불린다.
 *
 * 한 번 띄우고 시간이 다 되면 그 안내는 **끝난 것으로 확정**한다(taught + 저장).
 * ponytail: 그래서 안내를 흘려보낸 사람은 다시 못 본다 — 대신 `H` 조작법 패널이
 * 언제든 열린다. 반복 노출이 필요하다고 판단되면 여기에 표시 횟수(2회 상한)를 둘 것.
 */
function updatePrompt(s: Session): void {
  if (helpOpen || s.paused) return;
  loadTaught();
  promptClock++;

  // 마스크에 실려 오는 세 키는 여기서 직접 배움 판정을 한다.
  const inp = liveBody(s)?.lastInput ?? 0;
  if ((inp & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT)) !== 0) learnPrompt('MOVE');
  if ((inp & IN_INTERACT) !== 0) learnPrompt('INTERACT');
  if ((inp & IN_RUN) !== 0) learnPrompt('RUN');

  if (promptId !== null && promptClock >= promptEnd) {
    taught.add(promptId);
    saveTaught();
    promptId = null;
  }
  if (promptId !== null || s.phase !== 'PLAY' || s.awaitingOverwritePick) return;

  for (const id of PROMPT_ORDER) {
    if (taught.has(id)) continue;
    if (!promptArmed(id, s)) continue;
    promptId = id;
    promptStart = promptClock;
    promptEnd = promptClock + PROMPT_FRAMES;
    return;
  }
}

function promptAlpha(): number {
  const inA = (promptClock - promptStart) / PROMPT_FADE_IN;
  const outA = (promptEnd - promptClock) / PROMPT_FADE_OUT;
  return Math.max(0, Math.min(1, inA, outA));
}

/**
 * 프롬프트 한 개. 조작 중인 몸 **위쪽**에 붙되 화면 밖으로 나가지 않고,
 * 좌하단 속말·상단 계기판·터치 패드 어느 것도 가리지 않는 띠 안으로 클램프된다.
 */
function drawPrompt(
  ctx: CanvasRenderingContext2D,
  s: Session,
  cam: { x: number; y: number } | null,
): void {
  if (promptId === null || helpOpen || s.paused || s.awaitingOverwritePick) return;
  const a = promptAlpha();
  if (a <= 0) return;
  const c = PROMPT_COPY[promptId];
  const big = c.big === true;
  const keySize = big ? 20 : 14;
  const textSize = big ? 15 : 12;
  const key = touchUi ? c.touchKey : c.key;

  const cap = key === '' ? { w: 0, h: 0 } : keycapBox(ctx, key, { size: keySize, touch: touchUi });
  const gap = key === '' ? 0 : 12;
  ctx.font = font(textSize, 'bold');
  const tw = Math.round(ctx.measureText(c.line).width);
  const w = 15 + cap.w + gap + tw + 15;
  const h = Math.max(cap.h + 12, textSize + 24);

  // 몸의 화면 좌표. 카메라를 못 받았으면 화면 중앙에 둔다(안내가 사라지는 편보다 낫다).
  const me = liveBody(s);
  const cx = me !== undefined && cam !== null ? cam.x + (me.x + BODY_SUB / 2) / SUBPIXEL : CANVAS_W / 2;
  const cy = me !== undefined && cam !== null ? cam.y + (me.y + BODY_SUB / 2) / SUBPIXEL : CANVAS_H / 2;

  const top = touchUi ? PROMPT_TOP_TOUCH : PROMPT_TOP;
  const bottom = touchUi ? PROMPT_BOTTOM_TOUCH : PROMPT_BOTTOM;
  let x = Math.round(cx - w / 2);
  let y = Math.round(cy - PROMPT_OFFSET - h);
  // 위가 좁으면 아래로 뒤집는다 — 몸 위에 겹쳐 놓지는 않는다.
  if (y < top) y = Math.round(cy + PROMPT_OFFSET);
  x = Math.max(PROMPT_MARGIN, Math.min(CANVAS_W - PROMPT_MARGIN - w, x));
  y = Math.max(top, Math.min(bottom - h, y));

  plate(ctx, x, y, w, h, 0.96 * a);
  frame(ctx, x, y, w, h, c.color, (big ? 0.8 : 0.5) * a, big ? 2 : 1);
  rivets(ctx, x, y, w, h);
  // 핵심 동작에만 경고 사선 — 산업 현장에서 "이게 그거다"라고 말하는 방식.
  if (big) hazard(ctx, x + 2, y + h - 5, w - 4, 3, 0.75 * a);

  // 말꼬리: 이 안내가 **그 몸**에 붙은 것임을 말한다.
  const tipX = Math.max(x + 12, Math.min(x + w - 12, Math.round(cx)));
  const above = y + h <= cy;
  ctx.fillStyle = withAlpha(C_PLATE, 0.96 * a);
  ctx.beginPath();
  if (above) {
    ctx.moveTo(tipX - 6, y + h - 1);
    ctx.lineTo(tipX + 6, y + h - 1);
    ctx.lineTo(tipX, y + h + 6);
  } else {
    ctx.moveTo(tipX - 6, y + 1);
    ctx.lineTo(tipX + 6, y + 1);
    ctx.lineTo(tipX, y - 6);
  }
  ctx.closePath();
  ctx.fill();

  let ix = x + 15;
  if (key !== '') {
    drawKeycap(ctx, ix, y + Math.round((h - cap.h) / 2), key, {
      size: keySize,
      color: c.color,
      alpha: a,
      touch: touchUi,
    });
    ix += cap.w + gap;
  }
  stencil(
    ctx,
    c.line,
    ix,
    y + Math.round(h / 2) + Math.round(textSize * 0.36),
    textSize,
    withAlpha(big ? c.color : C_STENCIL, a),
    'left',
  );
}

// ── 조작법 패널 (H / ?) ────────────────────────────────────────────────────
//
// 키-동작 1:1 나열이 아니라 **기능별 묶음 + 평범한 말**이다. 플레이어가 알고 싶은 것은
// "R 이 무엇인가"가 아니라 "여기서 내가 뭘 할 수 있나"이므로, 제목이 그 질문의 답이다.

interface HelpRow {
  /** 키보드 키캡들. 여러 개면 `join` 으로 잇는다. */
  keys: readonly string[];
  /** 터치 버튼 이름들. 손가락에게 키 이름은 거짓 정보다. */
  touchKeys: readonly string[];
  join?: string;
  line: string;
  color?: string;
}

interface HelpGroup {
  title: string;
  rows: readonly HelpRow[];
  /** 묶음 아래 한 줄 — 왜 이걸 하는지. */
  note?: string;
}

const HELP_GROUPS: readonly HelpGroup[] = [
  {
    title: '움직이기',
    rows: [
      { keys: ['WASD', '↑ ← ↓ →'], touchKeys: ['왼쪽 스틱'], join: '/', line: '방을 돌아다닌다' },
      {
        keys: ['SHIFT'],
        touchKeys: ['링 밖까지'],
        line: '달리기 — 발소리가 남고, 간수가 그 소리를 조사하러 온다',
        color: C_DANGER,
      },
    ],
  },
  {
    title: '나를 남기기',
    rows: [
      {
        keys: ['R'],
        touchKeys: ['COMMIT'],
        line: '지금까지의 나를 잔상으로 남기고 루프를 되감는다',
        color: C_LOOT,
      },
    ],
    note: '잔상은 궤적이 아니라 입력 테이프다 — 과거의 나가 같은 키를 다시 누른다. 혼자서는 못 누르는 두 버튼을 그렇게 함께 누른다.',
  },
  {
    title: '고치기',
    rows: [
      {
        keys: ['Q', '1 / 2 / 3'],
        touchKeys: ['Q'],
        join: '+',
        line: '잔상 하나를 지우고 그 자리를 다시 녹화 — 스테이지당 1회',
      },
      {
        keys: ['BACKSPACE'],
        touchKeys: ['⟲'],
        line: '2초 홀드 = 스테이지 전체 초기화. DEBT +1 은 지워지지 않는다',
        color: C_DANGER,
      },
    ],
  },
  {
    title: '그 외',
    rows: [
      { keys: ['E'], touchKeys: ['E'], line: '눈앞의 버튼 · 레버를 만진다' },
      { keys: ['ESC'], touchKeys: ['II'], line: '일시정지' },
      { keys: ['M'], touchKeys: ['뮤트'], line: '소리 끄기 / 켜기' },
      { keys: ['−', '='], touchKeys: [], join: '/', line: '마이크 감도 (LISTEN 모드) — 현장이 시끄러우면 낮춘다' },
    ],
  },
];

const HELP_PANEL = { x: 70, y: 44, w: 820, h: 512 } as const;
/** 키캡 열의 폭. 가장 긴 조합(`Q` + `1 / 2 / 3`)이 들어가는 값. */
const HELP_KEY_COL = 156;
const HELP_ROW_H = 30;
const HELP_KEY_SIZE = 12;

/**
 * 조작법 패널. `H` · `?` · (터치) 우상단 `?` 로 언제든 열린다.
 * 표가 아니라 **그림이 있는 안내**여야 하므로 모든 키를 `drawKeycap` 으로 그린다.
 */
export function drawHelp(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.88);
  const p = HELP_PANEL;
  plate(ctx, p.x, p.y, p.w, p.h);
  hazard(ctx, p.x + 2, p.y + 2, p.w - 4, 5);
  frame(ctx, p.x, p.y, p.w, p.h, C_EDGE, 0.55, 2);
  rivets(ctx, p.x, p.y, p.w, p.h);

  stencil(ctx, 'CONTROLS', p.x + 26, p.y + 34, 10, C_STENCIL_DIM);
  stencilBig(ctx, '조작법', CANVAS_W / 2, p.y + 42, 24, C_STENCIL, C_PLATE);

  let y = p.y + 66;
  for (const grp of HELP_GROUPS) {
    // 묶음 제목 — 이 줄이 "여기서 내가 뭘 할 수 있나"의 답이다.
    ctx.fillStyle = withAlpha(C_EDGE, 0.18);
    ctx.fillRect(p.x + 26, y + 6, p.w - 52, 1);
    stencil(ctx, grp.title, p.x + 26, y, 13, C_STRIPE);
    y += 22;

    for (const row of grp.rows) {
      drawHelpRow(ctx, p.x + 40, y, row);
      y += HELP_ROW_H;
    }
    if (grp.note !== undefined) {
      text(ctx, grp.note, p.x + 40, y + 2, 10, withAlpha(C_TEXT_DIM, 0.95), 'left');
      y += 20;
    }
    y += 8;
  }

  stencil(
    ctx,
    touchUi ? '아무 곳이나 탭해서 닫기' : 'H  또는  ESC  ▸  닫기',
    CANVAS_W / 2,
    p.y + p.h - 18,
    11,
    C_STENCIL_DIM,
    'center',
  );
}

/** 안내 한 줄: 키캡(들) + 평범한 말. 키 열의 폭은 고정이라 설명이 세로로 정렬된다. */
function drawHelpRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  row: HelpRow,
): void {
  const keys = touchUi ? row.touchKeys : row.keys;
  let kx = x;
  keys.forEach((k, i) => {
    if (i > 0 && row.join !== undefined) {
      stencil(ctx, row.join, kx + 6, y + 18, 11, C_STENCIL_DIM, 'left', 'normal');
      ctx.font = font(11, 'normal');
      kx += ctx.measureText(row.join).width + 12;
    }
    const box = drawKeycap(ctx, kx, y + 1, k, { size: HELP_KEY_SIZE, color: row.color });
    kx += box.w + 6;
  });
  // 터치에 해당 버튼이 없는 항목(마이크 감도)은 그 사실을 숨기지 않는다.
  if (keys.length === 0) {
    stencil(ctx, '키보드 전용', x, y + 18, 10, withAlpha(C_STENCIL_DIM, 0.8), 'left', 'normal');
  }
  text(ctx, row.line, x + HELP_KEY_COL, y + 18, 11, row.color ?? C_TEXT, 'left');
}

/** 우상단 `?` 버튼(터치 전용). 그리는 좌표가 곧 `HELP_HITS` 다. */
function drawHelpButton(ctx: CanvasRenderingContext2D): void {
  drawKeycap(ctx, HELP_BTN.x, HELP_BTN.y, '?', {
    size: 18,
    touch: true,
    color: C_STENCIL_DIM,
  });
}

// ── 플레이 방식 문구 ───────────────────────────────────────────────────────
// 두 축은 직교한다: 여기(플레이 방식)와 EASY/LISTEN(감지 방식)은 서로를 모른다.

const PLAY_MODE_LABEL: Readonly<Record<PlayMode, string>> = {
  STORY: '[ STORY ]',
  GAUNTLET: '[ GAUNTLET ]',
  TIME_ATTACK: '[ TIME ATTACK ]',
};

/** 칩 아래 한 줄. 셋 다 항상 보인다 — 고르기 전에 뭔지 알아야 한다. */
const PLAY_MODE_CAPTION: Readonly<Record<PlayMode, string>> = {
  STORY: '한 판씩',
  GAUNTLET: '부채 누적',
  TIME_ATTACK: '총 시간',
};

const PLAY_MODE_LINE: Readonly<Record<PlayMode, string>> = {
  STORY: '스테이지를 하나씩 클리어한다. 처음이라면 이쪽.',
  GAUNTLET: '부채는 끝까지 따라온다 — 처음부터 끝까지 이어서, DEBT 는 지워지지 않는다',
  TIME_ATTACK: '모든 루프의 시간이 합산된다 — 조기 확정(R)이 곧 기록 단축',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 틱 → `mm:ss.ff`. */
export function formatTime(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  const totalSec = Math.floor(t / TICK_HZ);
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const ff = Math.floor(((t % TICK_HZ) * 100) / TICK_HZ);
  return `${pad2(m)}:${pad2(sec)}.${pad2(ff)}`;
}

function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight: 'normal' | 'bold' = 'normal',
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

function scrim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = withAlpha(C_BG, alpha);
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// ── 시드 고정 질감 ─────────────────────────────────────────────────────────
//
// 거친 결은 **프레임마다 뽑지 않는다.** `Math.random()` 을 매 프레임 부르면 표지판이
// TV 노이즈처럼 지직거린다. 아래 값은 고정 시드에서 한 번 만들어 계속 재사용한다.

/** 렌더 전용 시드 난수(mulberry32). 시뮬은 이 함수를 절대 부르지 않는다. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEAR_TILE = 64;
let wearTile: HTMLCanvasElement | undefined;
let wearPat: CanvasPattern | undefined;
let wearCtx: CanvasRenderingContext2D | undefined;

/**
 * 도장면의 마모 반점 타일. 2px 알갱이에 문턱을 줘서 드문드문 박히게 만든다 —
 * 문턱이 없으면 모든 픽셀이 흔들려 강철판이 아니라 노이즈가 된다.
 */
function wearPattern(ctx: CanvasRenderingContext2D): CanvasPattern | undefined {
  if (wearTile === undefined) {
    if (typeof document === 'undefined') return undefined;
    const cv = document.createElement('canvas');
    cv.width = WEAR_TILE;
    cv.height = WEAR_TILE;
    const g = cv.getContext('2d');
    if (g === null) return undefined;
    const img = g.createImageData(WEAR_TILE, WEAR_TILE);
    const rnd = seeded(0x1f2e3d4c);
    const cells = WEAR_TILE / 2;
    const noise = new Float64Array(cells * cells);
    for (let i = 0; i < noise.length; i++) noise[i] = rnd();
    for (let y = 0; y < WEAR_TILE; y++) {
      for (let x = 0; x < WEAR_TILE; x++) {
        const v = noise[(y >> 1) * cells + (x >> 1)] ?? 0.5;
        const p = (y * WEAR_TILE + x) * 4;
        // 무채색 반점 — 어떤 색 위에 얹어도 색조를 밀지 않는다.
        const lum = v > 0.5 ? 255 : 0;
        img.data[p] = lum;
        img.data[p + 1] = lum;
        img.data[p + 2] = lum;
        const mag = Math.abs(v - 0.5) * 2;
        img.data[p + 3] = mag <= 0.72 ? 0 : 200;
      }
    }
    g.putImageData(img, 0, 0);
    wearTile = cv;
  }
  if (wearPat === undefined || wearCtx !== ctx) {
    const p = ctx.createPattern(wearTile, 'repeat');
    if (p === null) return undefined;
    wearPat = p;
    wearCtx = ctx;
  }
  return wearPat;
}

/** 판 위에 마모 반점을 얹는다. 패턴은 캔버스 원점에 고정이라 스크롤하지 않는다. */
function wear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const p = wearPattern(ctx);
  if (p === undefined) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** 밴드에 흘러내린 녹물 자국. 시드에서 한 번 뽑아 계속 같은 자리에 쓴다. */
let streaks: number[] | undefined;
function streakData(): number[] {
  if (streaks === undefined) {
    const rnd = seeded(0x6b1e2f07);
    const out: number[] = [];
    for (let i = 0; i < 16; i++) {
      out.push(Math.round(rnd() * CANVAS_W), 2 + Math.round(rnd() * 4), 4 + Math.round(rnd() * 11));
    }
    streaks = out;
  }
  return streaks;
}

/** 밴드의 한쪽 모서리에서 번져 나온 녹물. 글자보다 먼저 그려 대비를 깎지 않는다. */
function bandGrime(
  ctx: CanvasRenderingContext2D,
  y: number,
  h: number,
  fromTop: boolean,
): void {
  const st = streakData();
  ctx.fillStyle = withAlpha(C_RUST, 0.16);
  for (let i = 0; i < st.length; i += 3) {
    const sx = st[i] ?? 0;
    const sw = st[i + 1] ?? 2;
    const sh = Math.min(h, st[i + 2] ?? 6);
    ctx.fillRect(sx, fromTop ? y : y + h - sh, sw, sh);
  }
}

// ── 표지판 원시 도형 ───────────────────────────────────────────────────────

/**
 * 표지판 강철판. **불투명하다** — 반투명하게 두면 다시 홀로그램으로 읽힌다.
 * `edge` 는 위쪽 모서리에 걸린 빛 한 줄의 세기(0 이면 생략).
 */
function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
  edge = 0.26,
): void {
  ctx.fillStyle = withAlpha(C_PLATE, alpha);
  ctx.fillRect(x, y, w, h);
  wear(ctx, x, y, w, h, 0.05 * alpha);
  if (edge > 0) {
    ctx.fillStyle = withAlpha(C_EDGE, edge * alpha);
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = withAlpha(C_BG, 0.45 * alpha);
    ctx.fillRect(x, y + h - 1, w, 1);
  }
}

/** 투박한 실선 테두리. 발광하지 않는다 — 필요한 곳에만. */
function frame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
  lw = 1,
): void {
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = lw;
  const o = lw / 2;
  ctx.strokeRect(x + o, y + o, w - lw, h - lw);
}

/** 명찰을 판에 고정한 리벳 두 개. 1px 점 두 개로 "붙여 놓은 판"이 된다. */
function rivets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = withAlpha(C_EDGE, 0.4);
  ctx.fillRect(x + 2, y + 2, 1, 1);
  ctx.fillRect(x + w - 3, y + h - 3, 1, 1);
}

/**
 * 경고 사선. 노랑/검정 대각선은 산업 현장의 언어다 — 위험 정보에만 쓴다.
 * 사선 위에 글자를 얹지 않는다(대비가 무너진다). 띠·게이지 채움으로만 쓴다.
 */
function hazard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = withAlpha(C_STRIPE, alpha);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = withAlpha(C_BG, alpha * 0.9);
  const step = 12;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.lineTo(x + i + h + step / 2, y);
    ctx.lineTo(x + i + step / 2, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 위치를 시드로 한 0/1px 어긋남.
 *
 * 스텐실은 사람이 손으로 대고 찍은 것이라 줄이 딱 맞지 않는다. 단 **값이 아니라
 * 위치**를 시드로 써야 한다 — 문자열을 시드로 쓰면 `DEBT 3` → `DEBT 4` 에서
 * 글자가 튄다.
 */
function skew(x: number, y: number): number {
  const h = Math.imul(((x | 0) * 73856093) ^ ((y | 0) * 19349663), 0x85ebca6b);
  return (h >>> 30) & 1;
}

/**
 * 스텐실 도장 라벨.
 *
 * 글자 뒤에 어두운 잉크 헤일로를 깔아 **얼룩진 판·녹물 자국 위에서도** 명도 대비를
 * 지킨다. 저채도로 내려가면서 가독성을 잃지 않는 장치가 이 헤일로다.
 */
function stencil(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight: 'normal' | 'bold' = 'bold',
): void {
  const dy = skew(x, y);
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = withAlpha(C_BG, 0.82);
  ctx.fillText(str, x + 1, y + dy + 1);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y + dy);
}

/**
 * 큰 글자용 스텐실. 도장판의 **브리지**(글자를 잇느라 남는 틈) 두 줄을 배경색으로
 * 눌러 실제로 형판을 대고 찍은 것처럼 만든다. `cut` 은 반드시 **그 자리의 배경색**
 * 이어야 한다 — 아니면 글자를 가로지르는 밝은 줄이 생긴다.
 */
function stencilBig(
  ctx: CanvasRenderingContext2D,
  str: string,
  cx: number,
  y: number,
  size: number,
  color: string,
  cut: string,
): void {
  ctx.font = font(size, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(str).width;
  ctx.fillStyle = withAlpha(C_BG, 0.8);
  ctx.fillText(str, cx + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(str, cx, y);
  // 브리지는 얇아야 한다 — 글자 높이의 1/20 을 넘기면 글자가 끊겨 읽힌다.
  const lw = Math.max(1, Math.round(size / 22));
  ctx.fillStyle = cut;
  ctx.fillRect(cx - w / 2 - 2, y - size * 0.46, w + 4, lw);
  ctx.fillRect(cx - w / 2 - 2, y - size * 0.16, w + 4, lw);
}

// ── 인게임 HUD ─────────────────────────────────────────────────────────────

/**
 * @param cam 월드 원점의 화면 오프셋(`ViewState.camX/camY`). 상황별 키 프롬프트를
 *   조작 중인 몸 옆에 붙이는 데만 쓴다. 없으면 프롬프트가 화면 중앙에 선다.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  mic: MicView | null = null,
  cam: { x: number; y: number } | null = null,
): void {
  ctx.textBaseline = 'alphabetic';

  // 상단/하단 밴드 — 벽에 볼트로 박아 놓은 불투명 강철 띠.
  // 위아래 경계는 발광선이 아니라 모서리에 걸린 빛 한 줄 + 그 아래 그림자다.
  plate(ctx, 0, 0, CANVAS_W, BAND_TOP_H, 1, 0);
  bandGrime(ctx, 0, BAND_TOP_H, false);
  ctx.fillStyle = withAlpha(C_EDGE, 0.3);
  ctx.fillRect(0, BAND_TOP_H - 1, CANVAS_W, 1);
  ctx.fillStyle = withAlpha(C_BG, 0.75);
  ctx.fillRect(0, BAND_TOP_H, CANVAS_W, 2);

  const by = CANVAS_H - BAND_BOT_H;
  plate(ctx, 0, by, CANVAS_W, BAND_BOT_H, 1, 0);
  bandGrime(ctx, by, BAND_BOT_H, true);
  ctx.fillStyle = withAlpha(C_EDGE, 0.3);
  ctx.fillRect(0, by, CANVAS_W, 1);
  ctx.fillStyle = withAlpha(C_BG, 0.75);
  ctx.fillRect(0, by - 2, CANVAS_W, 2);

  // ── 상단 좌: 스테이지 / par ──
  // 이어서 하는 모드(GAUNTLET/TIME_ATTACK)에서는 스테이지 번호가 곧 런 진행도다.
  const stageNo = s.stageIndex + 1;
  const runMode = s.playMode !== 'STORY';
  stencil(
    ctx,
    runMode
      ? `STAGE ${stageNo} / ${STAGES.length} — ${s.level.name.toUpperCase()}`
      : `STAGE ${stageNo} — ${s.level.name.toUpperCase()}`,
    PAD,
    22,
    13,
    C_STENCIL,
  );
  const used = s.ghosts.length;
  const overPar = used > s.level.par;
  stencil(
    ctx,
    `PAR ${s.level.par}   AFTERIMAGES ${used}/${MAX_AFTERIMAGES}`,
    PAD,
    38,
    10,
    overPar ? C_DANGER : C_STENCIL_DIM,
  );

  // ── 상단 중앙: 60초 계기 + R ▸ COMMIT ──
  drawTimeGauge(ctx, s);

  // ── 상단 우: 슬롯 명찰 ──
  drawSlots(ctx, s);

  // ── 상단 중앙 아래: 지금의 목표 ──
  // 클리어 조건이 화면 어디에도 없으면 플레이어는 규칙이 아니라 우연을 배운다.
  drawObjective(ctx, s);

  // ── 하단 좌: OVERWRITE ──
  const owFull = s.overwriteLeft > 0;
  // 다 쓴 상태에서 라벨을 C_OFF 로 두면 판 위에서 1.8:1 밖에 안 나 **읽히지 않는다.**
  // "없음"은 ○ 표식과 옆의 `SPENT` 가 말한다 — 글자 자체는 명도를 지킨다.
  stencil(
    ctx,
    `OVERWRITE ${owFull ? '●' : '○'}`,
    PAD,
    CANVAS_H - 16,
    12,
    owFull ? C_ON : C_STENCIL_DIM,
  );
  stencil(
    ctx,
    owFull ? 'Q ▸ REWRITE A SELF' : 'SPENT',
    PAD + 134,
    CANVAS_H - 16,
    9,
    C_STENCIL_DIM,
  );

  // ── 하단 우: ALERTS / DEBT ──
  // 둘 다 위험 수치라 0 을 넘기면 밑에 경고 사선 띠가 깔린다.
  drawWarnStat(ctx, `ALERTS ${s.alerts}`, CANVAS_W - PAD - 132, 'left', s.alerts > 0, C_LOOT);
  drawWarnStat(ctx, `DEBT ${s.debt}`, CANVAS_W - PAD, 'right', s.debt > 0, C_DANGER);

  // ── LISTEN 배지 + 음량 미터 ──
  if (mic !== null) drawMicPanel(ctx, mic);

  // ── 주인공의 속말 ──
  // 상태 갱신과 그리기를 여기서 함께 한다. 세션은 읽기만 한다 (whisper.ts 참고).
  drawWhisper(ctx, updateWhisper(s));

  // ── 상황별 키 프롬프트 ──
  // 처음 그 상황이 됐을 때만 해당 키를 띄운다. 눌러 보면 `learnPrompt` 로 지워진다.
  updatePrompt(s);
  drawPrompt(ctx, s, cam);

  // ── 오버레이 ──
  if (s.awaitingOverwritePick) drawOverwritePicker(ctx, s);
  if (s.resetHold > 0) drawResetHold(ctx, s);

  // 터치 기기에서는 조작법을 열 수단이 키보드에 없으므로 `?` 버튼을 띄운다.
  if (touchUi) drawHelpButton(ctx);
}

/**
 * 위험 수치 한 칸. 값이 0 을 넘으면 숫자 **아래**에 경고 사선 띠가 깔린다 —
 * 사선을 글자 뒤에 깔면 숫자가 안 읽힌다.
 */
function drawWarnStat(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  align: 'left' | 'right',
  hot: boolean,
  col: string,
): void {
  const size = 12;
  ctx.font = font(size, 'bold');
  const w = ctx.measureText(label).width;
  const lx = align === 'right' ? x - w : x;
  if (hot) hazard(ctx, lx - 2, CANVAS_H - 11, w + 4, 3);
  stencil(ctx, label, x, CANVAS_H - 16, size, hot ? col : C_STENCIL_DIM, align);
}

// ── 목표 / 속말 ────────────────────────────────────────────────────────────

/** 렌더 전용 프레임 카운터 (탈출구 강조 맥동). 시뮬 상태가 아니다. */
let objectiveClock = 0;

/**
 * `▸ 억제 코어를 손에 넣어라` → `▸ 탈출구로`.
 * 벽에 붙은 작은 지시 표지판이다. 코어를 손에 넣으면 초록으로 바뀌고(장치 ON 색),
 * 맥동하며 탈출구 방향 화살표가 붙는다.
 */
function drawObjective(ctx: CanvasRenderingContext2D, s: Session): void {
  const obj = currentObjective(s);
  objectiveClock++;
  const col = obj.held ? C_ON : C_LOOT;
  const pulse = obj.held ? 0.6 + 0.4 * Math.abs(Math.sin(objectiveClock * 0.07)) : 1;

  const y = 68;
  ctx.font = font(12, 'bold');
  const boxW = ctx.measureText(obj.text).width + (obj.held ? 48 : 26);
  const x = Math.round((CANVAS_W - boxW) / 2);
  const h = 23;

  plate(ctx, x, y - 15, boxW, h);
  frame(ctx, x, y - 15, boxW, h, obj.held ? col : C_EDGE, obj.held ? 0.35 + pulse * 0.4 : 0.5);
  rivets(ctx, x, y - 15, boxW, h);
  stencil(ctx, obj.text, x + 13, y + 1, 12, withAlpha(col, obj.held ? 0.7 + pulse * 0.3 : 1));

  if (obj.held) drawExitArrow(ctx, s, x + boxW - 21, y - 3, col, pulse);
}

/**
 * 탈출구가 어느 쪽인지 가리키는 작은 삼각형.
 * 월드 좌표가 아니라 **방향**만 쓰므로 카메라와 무관하다.
 */
function drawExitArrow(
  ctx: CanvasRenderingContext2D,
  s: Session,
  cx: number,
  cy: number,
  col: string,
  pulse: number,
): void {
  const live = s.sim.bodies.find((b) => b.isLive);
  if (live === undefined) return;
  const dx = s.sim.escape.x + s.sim.escape.w / 2 - (live.x + BODY_SUB / 2);
  const dy = s.sim.escape.y + s.sim.escape.h / 2 - (live.y + BODY_SUB / 2);
  if (dx === 0 && dy === 0) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = withAlpha(col, 0.55 + pulse * 0.45);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 속말 말풍선. 화면 하단 **좌측** 전용 자리에 둔다 — 조작 중인 몸 위에 띄우면
 * 정작 봐야 할 것을 가린다. 말꼬리가 있어야 자막이 아니라 생각으로 읽힌다.
 *
 * HUD 수치들보다 **조용해야** 한다: 테두리는 거의 없고, 글자는 스텐실 흰색을 한
 * 단계 내린 값이다. 단 읽히기는 해야 하므로 헤일로는 그대로 남긴다.
 */
function drawWhisper(ctx: CanvasRenderingContext2D, w: WhisperView | null): void {
  if (w === null || w.alpha <= 0) return;

  const size = 12;
  ctx.font = `italic ${size}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const boxW = Math.round(ctx.measureText(w.text).width) + 26;
  const boxH = 26;
  const x = PAD + 0.5;
  const y = CANVAS_H - 54 - boxH + 0.5;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + boxW, y);
  ctx.lineTo(x + boxW, y + boxH);
  ctx.lineTo(x + 30, y + boxH);
  ctx.lineTo(x + 16, y + boxH + 9);
  ctx.lineTo(x + 14, y + boxH);
  ctx.lineTo(x, y + boxH);
  ctx.closePath();
  ctx.fillStyle = withAlpha(C_PLATE, 0.94 * w.alpha);
  ctx.fill();
  ctx.strokeStyle = withAlpha(C_EDGE, 0.18 * w.alpha);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `italic ${size}px ${MONO}`;
  ctx.fillStyle = withAlpha(C_BG, 0.7 * w.alpha);
  ctx.fillText(w.text, x + 14, y + 18);
  ctx.fillStyle = withAlpha(C_STENCIL_DIM, 0.95 * w.alpha);
  ctx.fillText(w.text, x + 13, y + 17);
}

// ── LISTEN 모드 계기판 ─────────────────────────────────────────────────────

const METER_CELLS = 4;
const METER_CELL_W = 15;
const METER_CELL_H = 11;
const METER_GAP = 3;

/**
 * 렌더 전용 프레임 카운터(펄스 위상). 시뮬 상태가 아니다 — `Date.now()` 를 쓰면
 * 프레임레이트에 따라 위상이 달라지고, 시뮬 틱을 쓰면 TRANSITION 중에 멈춘다.
 */
let micPulseClock = 0;

/**
 * 4칸 음량 미터. 칸 경계(0.25 / 0.5 / 0.75)가 곧 레벨 1/2/3 임계라서,
 * "몇 칸이 찼는가"가 그대로 "지금 테이프에 녹화되는 값"이다.
 * 임계를 넘긴 동안(레벨 ≥ 1) 판 위에 경고 사선 띠가 뜨고 칸이 붉게 맥동한다.
 */
function drawMicPanel(ctx: CanvasRenderingContext2D, mic: MicView): void {
  const x = PAD;
  const y = 58;
  micPulseClock++;
  const over = mic.level > 0;
  const pulse = over ? 0.55 + 0.45 * Math.abs(Math.sin(micPulseClock * 0.16)) : 0;
  const accent = over ? C_DANGER : C_ON;

  const w = 284;
  const h = 24;
  plate(ctx, x, y, w, h);
  frame(ctx, x, y, w, h, over ? C_DANGER : C_EDGE, over ? 0.45 + pulse * 0.4 : 0.4);
  rivets(ctx, x, y, w, h);
  // 소음이 새어나가는 동안 판 아래 모서리에 경고 사선이 깔린다.
  if (over) hazard(ctx, x + 1, y + h - 4, w - 2, 3, 0.45 + pulse * 0.55);

  stencil(ctx, 'LISTEN', x + 8, y + 16, 10, accent);

  let cx = x + 60;
  for (let i = 0; i < METER_CELLS; i++) {
    const fill = Math.max(0, Math.min(1, (mic.meter - i * 0.25) / 0.25));
    ctx.fillStyle = C_PLATE_LO;
    ctx.fillRect(cx, y + 6, METER_CELL_W, METER_CELL_H);
    if (fill > 0) {
      // 첫 칸은 안전 구간(레벨 0)이라 초록, 나머지는 소음이 새어나가는 구간.
      const col = i === 0 ? C_ON : C_DANGER;
      ctx.fillStyle = withAlpha(col, i === 0 ? 0.85 : 0.55 + pulse * 0.45);
      ctx.fillRect(cx, y + 6, Math.round(METER_CELL_W * fill), METER_CELL_H);
    }
    frame(ctx, cx, y + 6, METER_CELL_W, METER_CELL_H, i === 0 ? C_ON : C_DANGER, 0.3);
    cx += METER_CELL_W + METER_GAP;
  }

  stencil(ctx, `LV ${mic.level}`, cx + 10, y + 16, 9, over ? C_DANGER : C_STENCIL_DIM);
  stencil(
    ctx,
    `SENS ${mic.sensitivity}/${mic.sensitivitySteps}  − / =`,
    x + w - 9,
    y + 16,
    9,
    C_STENCIL_DIM,
    'right',
    'normal',
  );
}

/**
 * 캘리브레이션 화면. 이 2초가 없으면 시끄러운 현장에서 절대 임계값에 걸려
 * 시작하자마자 레벨 3 으로 굳는다 — 그러면 플레이 자체가 불가능하다.
 *
 * 이어폰 안내가 여기 있는 이유는 분위기가 아니라 **기능**이다. LISTEN 은 마이크로
 * 플레이어 소리를 듣는데, 게임이 스피커로 발소리·경보를 내면 그 소리가 마이크로
 * 되돌아와 **게임이 스스로를 발각시킨다.** 안 껴도 플레이는 되게 하되(그 완충이
 * 측정 2초 동안 함께 재생되는 게임 소리다), 이유는 한 줄로 분명히 말한다.
 *
 * EASY 에는 뜨지 않는다 — `main.ts` 의 `micView()` 가 LISTEN 에서만 `MicView` 를
 * 넘기므로, 마이크를 쓰지 않는 모드에는 이 화면 자체가 존재하지 않는다.
 */
export function drawCalibration(ctx: CanvasRenderingContext2D, mic: MicView): void {
  // 아래 화면(타이틀 로고 / 월드)이 비치면 글자가 겹쳐 읽히지 않는다. 완전히 덮는다.
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const waiting = mic.phase === 'REQUEST';

  const panelW = 620;
  const panelH = 264;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;
  plate(ctx, px, py, panelW, panelH);
  // 시설 안내판의 머리띠. 권한 대기 중이면 경고 사선(사용자 행동이 필요하다).
  if (waiting) hazard(ctx, px + 2, py + 2, panelW - 4, 6);
  frame(ctx, px, py, panelW, panelH, waiting ? C_LOOT : C_EDGE, 0.55, 2);
  rivets(ctx, px, py, panelW, panelH);

  stencil(ctx, 'LISTEN MODE', CANVAS_W / 2, py + 28, 10, C_STENCIL_DIM, 'center');

  // ── 이어폰 안내판 ──
  // 화면에서 가장 큰 글자다. 이 모드에서 제일 먼저 알아야 하는 사실이기 때문이다.
  const bw = panelW - 56;
  const bx = px + 28;
  const by = py + 44;
  const bh = 74;
  ctx.fillStyle = C_PLATE_LO;
  ctx.fillRect(bx, by, bw, bh);
  hazard(ctx, bx, by, bw, 5);
  frame(ctx, bx, by, bw, bh, C_LOOT, 0.7, 2);
  stencilBig(ctx, '이어폰을 껴 주세요', CANVAS_W / 2, by + 40, 26, C_LOOT, C_PLATE_LO);
  text(
    ctx,
    '스피커로 들으면 게임 소리를 게임이 듣습니다.',
    CANVAS_W / 2,
    by + 62,
    12,
    C_TEXT,
    'center',
  );

  stencilBig(
    ctx,
    waiting ? '마이크 권한을 허용해 주세요' : '조용히 해주세요 — 환경음 측정 중',
    CANVAS_W / 2,
    py + 150,
    20,
    waiting ? C_LOOT : C_STENCIL,
    C_PLATE,
  );

  // 산업용 계기: 파인 홈 + 눈금 + 채움.
  const w = panelW - 120;
  const h = 12;
  const x = (CANVAS_W - w) / 2;
  const y = py + 168;
  ctx.fillStyle = C_PLATE_LO;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = withAlpha(C_LAMP, 0.8);
  ctx.fillRect(x, y, Math.round(w * mic.calibration), h);
  for (let i = 1; i < 10; i++) {
    ctx.fillStyle = withAlpha(C_BG, 0.55);
    ctx.fillRect(Math.round(x + (w * i) / 10), y, 1, h);
  }
  frame(ctx, x, y, w, h, C_EDGE, 0.45);

  text(
    ctx,
    waiting
      ? '브라우저의 마이크 요청을 허용하면 시작합니다.'
      : '지금 이 방의 소음을 바닥값으로 잡습니다.',
    CANVAS_W / 2,
    y + 30,
    11,
    C_TEXT,
    'center',
  );
  text(
    ctx,
    waiting
      ? '거부하거나 응답하지 않아도 EASY 모드로 계속 진행됩니다.'
      : '이어폰이 없어도 플레이할 수 있습니다 — 지금 들리는 게임 소리를 바닥값에 함께 넣습니다.',
    CANVAS_W / 2,
    y + 48,
    10,
    C_TEXT_DIM,
    'center',
  );
  text(
    ctx,
    '오디오는 저장하지도 전송하지도 않습니다. 테이프에 남는 것은 틱당 2비트의 음량 레벨뿐입니다.',
    CANVAS_W / 2,
    y + 70,
    10,
    withAlpha(C_TEXT_DIM, 0.75),
    'center',
  );
}

/**
 * 60초 계기.
 *
 * 매끈한 네온 바가 아니라 **판에 파인 홈 + 눈금 + 채움**이다. 눈금은 5초마다 얇은
 * 홈, 10초마다 판을 관통하는 굵은 홈이라 "몇 초 남았나"를 숫자 없이도 셀 수 있다.
 * 마지막 10초는 채움 자체가 경고 사선으로 바뀐다.
 */
function drawTimeGauge(ctx: CanvasRenderingContext2D, s: Session): void {
  const w = 300;
  const h = 12;
  const x = (CANVAS_W - w) / 2;
  const y = 13;
  const left = Math.max(0, MAX_TICKS - s.sim.tick);
  const frac = Math.max(0, Math.min(1, left / MAX_TICKS));
  const urgent = left < TICK_HZ * 10;

  ctx.fillStyle = C_PLATE_LO;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = withAlpha(C_BG, 0.5);
  ctx.fillRect(x, y, w, 1);

  const fw = Math.round(w * frac);
  if (urgent) {
    hazard(ctx, x, y, fw, h);
  } else {
    ctx.fillStyle = withAlpha(C_LOOT, 0.92);
    ctx.fillRect(x, y, fw, h);
    // 아래쪽 절반을 눌러 평면 바가 아니라 원통형 계기로 보이게.
    ctx.fillStyle = withAlpha(C_BG, 0.24);
    ctx.fillRect(x, y + h - 4, fw, 4);
  }

  for (let i = 1; i < 12; i++) {
    const tx = Math.round(x + (w * i) / 12);
    const major = i % 2 === 0;
    ctx.fillStyle = withAlpha(C_BG, major ? 0.7 : 0.38);
    ctx.fillRect(tx, major ? y : y + h - 5, 1, major ? h : 5);
  }
  frame(ctx, x, y, w, h, urgent ? C_DANGER : C_EDGE, urgent ? 0.8 : 0.45);

  // 남은 시간은 네 개 핵심 수치 중 하나다 — 계기 옆에 크게, 최대 명도로.
  stencil(ctx, formatTime(left), x - 10, y + h - 1, 13, urgent ? C_DANGER : C_STENCIL, 'right');
  stencil(ctx, 'R ▸ COMMIT', x + w + 10, y + h - 1, 11, C_STENCIL);

  if (s.playMode === 'STORY') {
    stencil(ctx, `LOOP ${s.loopIndex + 1}`, CANVAS_W / 2, y + h + 15, 9, C_STENCIL_DIM, 'center');
    return;
  }
  drawRunStrip(ctx, s, y + h + 15);
  // TIME ATTACK 의 성적은 이 숫자 하나다 — 게이지 위, 화면 맨 위 중앙에 상시 노출.
  if (s.playMode === 'TIME_ATTACK') drawTotalClock(ctx, s);
}

/**
 * 이어서 하는 모드의 상시 표시줄: `LOOP 2 · RUN 7/15 · GHOSTS 9 · DEBT 3`.
 * 조각마다 색이 달라 한 번에 그릴 수 없으므로 폭을 재서 직접 중앙 정렬한다.
 */
function drawRunStrip(ctx: CanvasRenderingContext2D, s: Session, y: number): void {
  const t = runTotals(s);
  const parts: [string, string][] = [
    [`LOOP ${s.loopIndex + 1}`, C_STENCIL_DIM],
    [`RUN ${s.stageIndex + 1}/${STAGES.length}`, C_STENCIL],
    [`GHOSTS ${t.afterimages}`, C_STENCIL_DIM],
    // 누적 부채 — 런 전체를 관통하는 값이라 0 이 아니면 항상 붉다.
    [`DEBT ${t.debt}`, t.debt > 0 ? C_DANGER : C_STENCIL_DIM],
  ];

  const SEP = '   ·   ';
  ctx.font = font(9, 'bold');
  const sepW = ctx.measureText(SEP).width;
  let total = sepW * (parts.length - 1);
  for (const p of parts) total += ctx.measureText(p[0]).width;

  let x = (CANVAS_W - total) / 2;
  parts.forEach((p, i) => {
    stencil(ctx, p[0], x, y, 9, p[1]);
    ctx.font = font(9, 'bold');
    x += ctx.measureText(p[0]).width;
    if (i < parts.length - 1) {
      text(ctx, SEP, x, y, 9, withAlpha(C_STENCIL_DIM, 0.5), 'left', 'bold');
      x += sepW;
    }
  });
}

/** 런 누적 시계. 루프를 넘고 스테이지를 넘어도 계속 올라간다. */
function drawTotalClock(ctx: CanvasRenderingContext2D, s: Session): void {
  const label = formatTime(runTotals(s).ticks);
  ctx.font = font(13, 'bold');
  const w = ctx.measureText(label).width;
  stencil(ctx, 'TOTAL', CANVAS_W / 2 - w / 2 - 8, 11, 9, C_STENCIL_DIM, 'right');
  stencil(ctx, label, CANVAS_W / 2, 11, 13, C_LOOT, 'center');
}

/**
 * 슬롯 인디케이터 = **각인된 수용자 명찰**. 리벳으로 박혀 있고 글자는 판에 눌러
 * 새긴 것처럼 보인다. 각 슬롯 색은 잔상 정체성 시스템이므로 그대로 유지한다.
 */
function drawSlots(ctx: CanvasRenderingContext2D, s: Session): void {
  const boxW = 40;
  const boxH = 22;
  const gap = 4;
  const total = SLOT_NAMES.length * boxW + (SLOT_NAMES.length - 1) * gap;
  let x = CANVAS_W - PAD - total;
  const y = 14;

  for (let i = 0; i < SLOT_NAMES.length; i++) {
    const name = SLOT_NAMES[i] ?? '?';
    const ghost = i === 0 ? undefined : s.ghosts[i - 1];
    const filled = i === 0 || ghost !== undefined;
    const corpse = ghost !== undefined && ghost.corpse;
    const col = C_SLOT[i] ?? C_I_CORE;
    const a = A_SLOT[i] ?? 1;

    if (filled) {
      plate(ctx, x, y, boxW, boxH);
      // 명찰에 칠해진 그 몸의 색. 판 위에 얇게 얹어 색만 남기고 발광은 없다.
      ctx.fillStyle = withAlpha(col, 0.12 + a * 0.1);
      ctx.fillRect(x + 1, y + 1, boxW - 2, boxH - 2);
    } else {
      // 비어 있는 자리는 판이 아니라 **파인 홈**이다.
      ctx.fillStyle = C_PLATE_LO;
      ctx.fillRect(x, y, boxW, boxH);
      ctx.fillStyle = withAlpha(C_BG, 0.5);
      ctx.fillRect(x, y, boxW, 1);
    }
    frame(ctx, x, y, boxW, boxH, filled ? col : C_OFF, filled ? 0.85 : 0.55);
    rivets(ctx, x, y, boxW, boxH);

    const label = corpse ? `${name}✕` : name;
    stencil(
      ctx,
      label,
      x + boxW / 2,
      y + 15,
      9,
      corpse ? C_CORPSE : filled ? col : C_OFF,
      'center',
    );
    x += boxW + gap;
  }

  const left = MAX_AFTERIMAGES - s.ghosts.length;
  const label = left > 0 ? `${left} SELVES LEFT` : 'NO ONE LEFT TO BECOME.';
  ctx.font = font(10, 'bold');
  const lw = ctx.measureText(label).width;
  // 더 될 수 있는 나가 없다 = 이 스테이지에서 가장 위험한 정보. 사선 띠를 깐다.
  // 글자와 띠 둘 다 **밴드 안(0..BAND_TOP_H)** 에 들어와야 한다 — 넘치면 띠가 월드
  // 위에 걸쳐 뜨고, 그러면 벽에 붙은 표지판이 아니라 떠 있는 오버레이로 되돌아간다.
  const ly = y + boxH + 9;
  if (left === 0) hazard(ctx, CANVAS_W - PAD - lw - 2, ly + 1, lw + 4, 3);
  stencil(ctx, label, CANVAS_W - PAD, ly, 10, left > 0 ? C_STENCIL : C_DANGER, 'right');
}

function drawOverwritePicker(ctx: CanvasRenderingContext2D, s: Session): void {
  if (touchUi) {
    drawTouchPicker(ctx, s);
    return;
  }
  const h = 96;
  const y = (CANVAS_H - h) / 2;
  plate(ctx, 0, y, CANVAS_W, h, 0.96, 0);
  // 시설 작업 구역 표시 — 위아래를 경고 사선으로 잘라낸다.
  hazard(ctx, 0, y, CANVAS_W, 4);
  hazard(ctx, 0, y + h - 4, CANVAS_W, 4);

  stencilBig(
    ctx,
    'PICK A SELF TO REWRITE — 1 / 2 / 3',
    CANVAS_W / 2,
    y + 32,
    16,
    C_LOOT,
    C_PLATE,
  );

  // 실제로 존재하는 잔상만 고를 수 있다는 걸 명찰로 보여준다.
  const chipW = 96;
  const gap = 12;
  const total = MAX_AFTERIMAGES * chipW + (MAX_AFTERIMAGES - 1) * gap;
  let x = (CANVAS_W - total) / 2;
  for (let i = 0; i < MAX_AFTERIMAGES; i++) {
    const ghost = s.ghosts[i];
    const has = ghost !== undefined;
    const col = C_SLOT[i + 1] ?? C_I_CORE;
    const cy = y + 44;
    if (has) {
      plate(ctx, x, cy, chipW, 30);
      ctx.fillStyle = withAlpha(col, 0.16);
      ctx.fillRect(x + 1, cy + 1, chipW - 2, 28);
    } else {
      ctx.fillStyle = C_PLATE_LO;
      ctx.fillRect(x, cy, chipW, 30);
    }
    frame(ctx, x, cy, chipW, 30, has ? col : C_OFF, has ? 0.9 : 0.5, has ? 2 : 1);
    rivets(ctx, x, cy, chipW, 30);
    const nm = SLOT_NAMES[i + 1] ?? '?';
    stencil(
      ctx,
      `${i + 1} ▸ ${nm}${ghost !== undefined && ghost.corpse ? ' ✕' : ''}`,
      x + chipW / 2,
      cy + 20,
      11,
      has ? col : C_OFF,
      'center',
    );
    x += chipW + gap;
  }

  // 아래 사선 띠(4px)에 글자가 닿지 않도록 한 줄 위로 올린다.
  stencil(ctx, 'Q ▸ CANCEL', CANVAS_W / 2, y + h - 13, 9, C_STENCIL_DIM, 'center', 'normal');
}

/**
 * 터치용 슬롯 선택. 명찰이 96×30 이면 손가락에 너무 작아서 옆 슬롯을 지운다 —
 * 되돌릴 수 없는 조작이므로 여기서만은 판을 크게 키운다.
 * 기하는 `PICK_PADS` / `PICK_PANEL` 하나뿐이다 — 그려지는 판이 곧 탭 영역이다.
 */
function drawTouchPicker(ctx: CanvasRenderingContext2D, s: Session): void {
  scrim(ctx, 0.72);
  const p = PICK_PANEL;
  plate(ctx, p.x, p.y, p.w, p.h, 0.97);
  hazard(ctx, p.x, p.y, p.w, 5);
  hazard(ctx, p.x, p.y + p.h - 5, p.w, 5);
  frame(ctx, p.x, p.y, p.w, p.h, C_LOOT, 0.55, 2);
  rivets(ctx, p.x, p.y, p.w, p.h);

  stencilBig(ctx, '지울 나를 고르시오', CANVAS_W / 2, p.y + 52, 22, C_LOOT, C_PLATE);
  stencil(
    ctx,
    '고른 잔상의 테이프는 사라지고 이 루프를 다시 녹화한다 — 스테이지당 1회',
    CANVAS_W / 2,
    p.y + 74,
    10,
    C_STENCIL_DIM,
    'center',
    'normal',
  );

  for (const pad of PICK_PADS) {
    if (pad.id === 'CANCEL') {
      tapButton(ctx, pad, 'CANCEL', C_STENCIL_DIM);
      continue;
    }
    const i = pad.id === 'SLOT1' ? 0 : pad.id === 'SLOT2' ? 1 : 2;
    const ghost = s.ghosts[i];
    const has = ghost !== undefined;
    const col = C_SLOT[i + 1] ?? C_I_CORE;
    if (has) {
      plate(ctx, pad.x, pad.y, pad.w, pad.h);
      ctx.fillStyle = withAlpha(col, 0.16);
      ctx.fillRect(pad.x + 1, pad.y + 1, pad.w - 2, pad.h - 2);
    } else {
      ctx.fillStyle = C_PLATE_LO;
      ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
    }
    frame(ctx, pad.x, pad.y, pad.w, pad.h, has ? col : C_OFF, has ? 0.9 : 0.5, has ? 2 : 1);
    rivets(ctx, pad.x, pad.y, pad.w, pad.h);
    const nm = SLOT_NAMES[i + 1] ?? '?';
    stencil(
      ctx,
      `${nm}${has && ghost.corpse ? ' ✕' : ''}`,
      pad.cx,
      pad.y + 48,
      24,
      has ? col : C_OFF,
      'center',
    );
    stencil(
      ctx,
      has ? '탭해서 덮어쓰기' : '비어 있음',
      pad.cx,
      pad.y + 74,
      10,
      has ? C_STENCIL_DIM : C_OFF,
      'center',
      'normal',
    );
  }
}

/**
 * BACKSPACE 홀드 인디케이터. 산업용 다이얼 — 판에 박힌 원형 계기다.
 * 전체 초기화는 DEBT 를 남기므로 사선 띠를 함께 깐다.
 */
function drawResetHold(ctx: CanvasRenderingContext2D, s: Session): void {
  const frac = Math.max(0, Math.min(1, s.resetHold / RESET_HOLD_TICKS));
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H - 96;
  const r = 26;

  ctx.fillStyle = withAlpha(C_PLATE, 0.94);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(C_EDGE, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = C_PLATE_LO;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = C_DANGER;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();

  stencil(ctx, `${Math.round(frac * 100)}%`, cx, cy + 4, 12, C_DANGER, 'center');

  const label = 'HOLD ▸ FULL RESET   (DEBT +1)';
  ctx.font = font(10, 'bold');
  const lw = ctx.measureText(label).width;
  hazard(ctx, cx - lw / 2 - 3, cy + r + 27, lw + 6, 3);
  stencil(ctx, label, cx, cy + r + 22, 10, C_DANGER, 'center');
}

// ── 타이틀 ─────────────────────────────────────────────────────────────────

/**
 * 타이틀이 보여줘야 하는 것 전부. 두 축은 **각각 한 줄**을 차지한다:
 * 위가 플레이 방식(STORY / GAUNTLET / TIME ATTACK), 아래가 감지 방식(EASY / LISTEN).
 * `focusRow` 는 지금 ← → 가 조작하는 줄이다 (0 = 위, 1 = 아래).
 */
export interface TitleView {
  mode: Mode;
  playMode: PlayMode;
  focusRow: 0 | 1;
  notice: string | null;
}

/** 타이틀 배경의 콘크리트 이음새. 시드에서 한 번 뽑는다 — 격자가 아니어야 한다. */
let titleSeams: number[] | undefined;
function seamData(): number[] {
  if (titleSeams === undefined) {
    const rnd = seeded(0x3c9a17d5);
    const out: number[] = [];
    // [수평 여부, 좌표] 쌍. 규칙적 간격이 아니라 시드로 흩뿌린다.
    for (let i = 0; i < 5; i++) out.push(1, Math.round(40 + rnd() * (CANVAS_H - 80)));
    for (let i = 0; i < 4; i++) out.push(0, Math.round(40 + rnd() * (CANVAS_W - 80)));
    titleSeams = out;
  }
  return titleSeams;
}

let lampGrad: CanvasGradient | undefined;
let lampGradCtx: CanvasRenderingContext2D | undefined;

/**
 * 타이틀 배경 = 콘크리트 벽. 발광 격자선 대신 **슬래브 이음새 + 골재 반점 +
 * 위에서 내려오는 형광등 빛**으로 같은 시설임을 말한다.
 */
function drawTitleBackdrop(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = C_VOID;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const seams = seamData();
  for (let i = 0; i < seams.length; i += 2) {
    const horiz = seams[i] === 1;
    const v = seams[i + 1] ?? 0;
    ctx.fillStyle = withAlpha(C_SEAM, 0.9);
    if (horiz) ctx.fillRect(0, v, CANVAS_W, 2);
    else ctx.fillRect(v, 0, 2, CANVAS_H);
    // 이음새의 빛 받는 쪽 립 1px — 이게 있어야 선이 아니라 "파인 자리"가 된다.
    ctx.fillStyle = withAlpha(C_SEAM_LIP, 0.16);
    if (horiz) ctx.fillRect(0, v - 1, CANVAS_W, 1);
    else ctx.fillRect(v - 1, 0, 1, CANVAS_H);
  }

  wear(ctx, 0, 0, CANVAS_W, CANVAS_H, 0.05);

  if (lampGrad === undefined || lampGradCtx !== ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, withAlpha(C_LAMP, 0.07));
    g.addColorStop(0.45, withAlpha(C_LAMP, 0.015));
    g.addColorStop(1, withAlpha(C_BG, 0.5));
    lampGrad = g;
    lampGradCtx = ctx;
  }
  ctx.fillStyle = lampGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/**
 * 제목이 곧 메커니즘이다: 네 개의 격(I / MY / ME / MINE)이 네 개의 몸이고,
 * 로고에 겹친 오프셋 고스트 텍스트가 곧 잔상이다. 로고는 그대로 두고 **배경만**
 * 콘크리트로 내렸다.
 */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  t: number,
  view: TitleView,
): void {
  const { mode, playMode, focusRow, notice } = view;
  drawTitleBackdrop(ctx);

  const size = 58;
  const baseY = 205;
  const parts = ['I', 'MY', 'ME', 'MINE'];

  ctx.font = font(size, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 각 격의 폭을 먼저 재서 전체를 중앙 정렬한다.
  const dotW = ctx.measureText('.').width;
  const widths = parts.map((p) => ctx.measureText(p).width);
  const totalW =
    widths.reduce((a, b) => a + b, 0) + dotW * (parts.length - 1);
  const startX = (CANVAS_W - totalW) / 2;

  // 잔상 레이어: 뒤로 갈수록 옅고 멀리. 오른쪽에서 왼쪽으로 흘러 들어온다.
  for (let g = 3; g >= 1; g--) {
    const off = g * 7 + Math.sin(t * 0.02 + g) * 2;
    let x = startX;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] ?? '';
      const col = C_SLOT[g] ?? C_I_CORE;
      ctx.fillStyle = withAlpha(col, 0.22 / g + 0.06);
      ctx.fillText(p, x + off, baseY);
      x += (widths[i] ?? 0) + dotW;
    }
  }

  // 본체: 격은 흰색, 점은 슬롯 색 — 네 개로 쪼개져 있다는 사실을 점이 말한다.
  let x = startX;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? '';
    ctx.fillStyle = C_I_CORE;
    ctx.fillText(p, x, baseY);
    x += widths[i] ?? 0;
    if (i < parts.length - 1) {
      ctx.fillStyle = C_SLOT[i + 1] ?? C_I_CORE;
      ctx.fillText('.', x, baseY);
      x += dotW;
    }
  }

  // 격 아래 작은 라벨 — I 는 지금의 나, 나머지는 잔상.
  {
    let lx = startX;
    const labels = ['NOW', 'LOOP 2', 'LOOP 3', 'LOOP 4'];
    for (let i = 0; i < parts.length; i++) {
      const w = widths[i] ?? 0;
      stencil(
        ctx,
        labels[i] ?? '',
        lx + w / 2,
        baseY + 22,
        9,
        withAlpha(C_SLOT[i] ?? C_I_CORE, i === 0 ? 0.9 : 0.55),
        'center',
      );
      lx += w + dotW;
    }
  }

  // 표어는 시설 벽에 찍힌 스텐실 도장이다.
  stencilBig(ctx, 'Fail now. Escape later.', CANVAS_W / 2, baseY + 48, 18, C_STRIPE, C_VOID);
  text(
    ctx,
    '실패할 때마다 과거의 내가 동료가 되는 60초 타임루프 탈출극',
    CANVAS_W / 2,
    baseY + 68,
    11,
    C_TEXT_DIM,
    'center',
  );

  // ── 두 축 — 위 줄: 플레이 방식 / 아래 줄: 감지 방식 ──
  // ↑ ↓ 로 줄을 옮기고 ← → (또는 숫자)로 그 줄의 항목을 고른다.
  drawPlayModeRow(ctx, playMode, mode, focusRow === 0, t);
  drawDetectRow(ctx, mode, focusRow === 1);
  stencil(
    ctx,
    touchUi ? '탭해서 고르고   PLAY 로 시작' : '↑ ↓ 줄 이동    ← → 선택    ENTER 시작',
    CANVAS_W / 2,
    432,
    9,
    withAlpha(C_STENCIL_DIM, 0.9),
    'center',
  );

  // [ PLAY ] — 맥동하는 CTA. 메뉴는 없다(SPEC §8).
  // 발광 버튼이 아니라 **경고 사선을 두른 산업용 누름판**이다.
  const pulse = 0.65 + Math.sin(t * 0.06) * 0.35;
  const btnW = PLAY_BTN_W;
  const btnH = PLAY_BTN_H;
  const bx = (CANVAS_W - btnW) / 2;
  const by = PLAY_BTN_Y;
  plate(ctx, bx, by, btnW, btnH);
  hazard(ctx, bx + 1, by + 1, btnW - 2, 4, 0.5 + pulse * 0.5);
  hazard(ctx, bx + 1, by + btnH - 5, btnW - 2, 4, 0.5 + pulse * 0.5);
  frame(ctx, bx, by, btnW, btnH, C_EDGE, 0.3 + pulse * 0.4, 2);
  rivets(ctx, bx, by, btnW, btnH);
  stencil(
    ctx,
    touchUi ? '[ PLAY ]' : '[ PLAY ] — ENTER',
    CANVAS_W / 2,
    by + 24,
    15,
    C_STENCIL,
    'center',
  );

  // 인트로 재시청. main.ts 가 `S` keydown 을 받아 인트로로 되돌린다.
  // 플레이 방식 `STORY` 와 헷갈리지 않게 이름을 분리했다.
  if (!touchUi) {
    stencil(ctx, 'S ▸ 인트로 다시보기', CANVAS_W / 2, 496, 11, C_STENCIL_DIM, 'center');
  }

  // 마이크 폴백 같은 사건은 조용히 삼키지 않고 여기 한 줄로 남긴다.
  if (notice !== null) {
    stencil(ctx, notice, CANVAS_W / 2, 510, 10, C_DANGER, 'center');
  }

  if (touchUi) {
    // 키 목록은 손가락에게 거짓 정보다. 그 자리에 실제로 누를 수 있는 두 판을 놓는다.
    tapButton(ctx, TOUCH_INTRO_BTN, '인트로 다시보기', C_STENCIL_DIM);
    tapButton(ctx, TOUCH_MUTE_BTN, '뮤트 켜기 / 끄기', C_STENCIL_DIM);
    stencil(
      ctx,
      '왼쪽 = 이동 스틱 · 오른쪽 = COMMIT · 기기를 가로로 두세요',
      CANVAS_W / 2,
      576,
      10,
      withAlpha(C_STENCIL_DIM, 0.85),
      'center',
      'normal',
    );
    return;
  }

  // 조작키 요약 — 시설 벽에 붙은 안내판.
  const keys: [string, string][] = [
    ['WASD / ARROWS', '이동'],
    ['SHIFT', '달리기 (소음 발생)'],
    ['E', '상호작용'],
    ['R', '루프 조기 확정 → 잔상'],
    ['Q → 1/2/3', '잔상 덮어쓰기 (1회)'],
    ['BACKSPACE (2초)', '전체 초기화 (DEBT +1)'],
    ['ESC / M', '일시정지 / 뮤트'],
    ['− / =', '마이크 감도 (LISTEN)'],
  ];
  const colX = [CANVAS_W / 2 - 250, CANVAS_W / 2 + 20];
  keys.forEach((entry, i) => {
    const cx = colX[i < 4 ? 0 : 1] ?? 0;
    const ry = CANVAS_H - 76 + (i % 4) * 17;
    stencil(ctx, entry[0], cx, ry, 10, withAlpha(C_STRIPE, 0.95));
    text(ctx, entry[1], cx + 140, ry, 10, C_TEXT_DIM, 'left');
  });
}

/** 탭 대상임이 보이는 누름판. 히트 사각형과 **같은 좌표**로만 그린다. */
function tapButton(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  col: string,
): void {
  plate(ctx, r.x, r.y, r.w, r.h);
  frame(ctx, r.x, r.y, r.w, r.h, C_EDGE, 0.5);
  rivets(ctx, r.x, r.y, r.w, r.h);
  stencil(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 4, 11, col, 'center');
}

// ── 터치 조작 UI ───────────────────────────────────────────────────────────
//
// 같은 아트 방향을 따른다: 발광 오버레이가 아니라 **판에 박힌 산업용 조작기**다.
// 다만 게임 정보를 가리면 안 되므로 판 자체는 반투명하게 깔고 테두리로만 형태를 세운다.

/** 조작 UI 전체 불투명도. 방·잔상·간수를 읽는 데 방해가 되지 않는 선. */
const TOUCH_A = 0.62;

/**
 * 지금 `E` 가 실제로 뭔가를 누를 수 있는가. **SimState 를 읽기만** 한다 —
 * 판정 규칙은 world.ts `tryInteract` 와 같은 사거리를 쓴다(중심 대 타일 중심).
 */
function nearInteractable(s: Session): boolean {
  const me = s.sim.bodies.find((b) => b.isLive);
  if (me === undefined) return false;
  const bx = me.x + BODY_SUB / 2;
  const by = me.y + BODY_SUB / 2;
  const max2 = INTERACT_RANGE * INTERACT_RANGE;
  const near = (tx: number, ty: number): boolean => {
    const dx = bx - (tx + TILE_SUB / 2);
    const dy = by - (ty + TILE_SUB / 2);
    return dx * dx + dy * dy <= max2;
  };
  for (const b of s.sim.buttons) if (near(b.x, b.y)) return true;
  for (const l of s.sim.levers) if (near(l.x, l.y)) return true;
  for (const q of s.sim.seqButtons) if (near(q.x, q.y)) return true;
  return false;
}

/** 원형 패드 한 개. 눌린 동안 바탕이 밝아지고 테두리가 굵어진다. */
function padCircle(
  ctx: CanvasRenderingContext2D,
  pad: TouchPad,
  col: string,
  down: boolean,
  live: boolean,
): void {
  const a = TOUCH_A * (live ? 1 : 0.55);
  ctx.save();
  ctx.beginPath();
  ctx.arc(pad.cx, pad.cy, pad.r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(C_PLATE, (down ? 0.95 : 0.8) * a);
  ctx.fill();
  if (down) {
    ctx.fillStyle = withAlpha(col, 0.3 * a);
    ctx.fill();
  }
  ctx.strokeStyle = withAlpha(col, (down ? 1 : 0.75) * a);
  ctx.lineWidth = down ? 3 : 2;
  ctx.stroke();
  ctx.restore();
}

/** 원 안쪽만 남기고 경고 사선을 깐다 — `hazard` 는 사각형이라 클립이 필요하다. */
function hazardArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  alpha: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  hazard(ctx, cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2, alpha);
  ctx.restore();
}

/** 가상 조이스틱. 안쪽 원 = 걷기, 바깥 링 = 달리기. 그 구분이 곧 소음 여부다. */
function drawStick(ctx: CanvasRenderingContext2D, v: TouchView): void {
  const cx = v.baseX;
  const cy = v.baseY;
  const a = TOUCH_A * (v.stickActive ? 1 : 0.75);

  // 달리기 밴드: 손을 대지 않았을 때도 사선으로 "여기가 위험 구간"임을 말한다.
  hazardArc(ctx, cx, cy, STICK_R, STICK_RUN_R, (v.running ? 0.85 : 0.3) * a);

  // 걷기 원 = 판에 파인 홈.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, STICK_RUN_R, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(C_PLATE_LO, 0.9 * a);
  ctx.fill();
  ctx.strokeStyle = withAlpha(C_EDGE, 0.7 * a);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 바깥 링 테두리.
  ctx.strokeStyle = withAlpha(v.running ? C_DANGER : C_EDGE, (v.running ? 1 : 0.6) * a);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, STICK_R, 0, Math.PI * 2);
  ctx.stroke();

  // 8방향 눈금 — 양자화가 8방향이라는 사실을 형태로 보여준다.
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    ctx.strokeStyle = withAlpha(C_EDGE, 0.45 * a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + c * (STICK_DEAD_R + 4), cy + sn * (STICK_DEAD_R + 4));
    ctx.lineTo(cx + c * (STICK_RUN_R - 4), cy + sn * (STICK_RUN_R - 4));
    ctx.stroke();
  }

  // 데드존 표식 — 이 안에서는 아무 방향도 나가지 않는다.
  ctx.strokeStyle = withAlpha(C_EDGE, 0.35 * a);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, STICK_DEAD_R, 0, Math.PI * 2);
  ctx.stroke();

  // 노브.
  const knobCol = v.running ? C_DANGER : v.mask !== 0 ? C_I_RING : C_METAL_LIP;
  ctx.beginPath();
  ctx.arc(v.knobX, v.knobY, 19, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(C_PLATE, 0.96 * a);
  ctx.fill();
  ctx.strokeStyle = withAlpha(knobCol, 0.95 * a);
  ctx.lineWidth = 2;
  ctx.stroke();

  stencil(
    ctx,
    v.running ? 'RUN' : 'WALK',
    cx,
    cy + STICK_R + 15,
    10,
    withAlpha(v.running ? C_DANGER : C_STENCIL_DIM, a + 0.2),
    'center',
  );
}

/**
 * 화면 조작 버튼 + 조이스틱. PLAY 중에만, 그리고 슬롯 선택 오버레이가 떠 있지
 * 않을 때만 그린다(그때는 화면 전체가 선택 패널이다).
 */
export function drawTouchControls(
  ctx: CanvasRenderingContext2D,
  s: Session,
  v: TouchView,
): void {
  if (v.context !== 'PLAY') return;

  const down = new Set<PadId>(v.down);
  drawStick(ctx, v);

  const hotE = nearInteractable(s);
  const canQ = s.overwriteLeft > 0;

  for (const pad of TOUCH_PADS) {
    const pressed = down.has(pad.id);
    switch (pad.id) {
      case 'COMMIT': {
        // 이 게임의 핵심 동작 — 가장 크고, 사선을 두르고, 두 줄 라벨을 갖는다.
        padCircle(ctx, pad, C_LOOT, pressed, true);
        hazardArc(ctx, pad.cx, pad.cy, pad.r - 3, pad.r - 9, (pressed ? 1 : 0.55) * TOUCH_A);
        stencil(ctx, '잔상', pad.cx, pad.cy - 8, 13, C_STENCIL, 'center');
        stencil(ctx, '남기기', pad.cx, pad.cy + 8, 13, C_STENCIL, 'center');
        stencil(ctx, 'COMMIT', pad.cx, pad.cy + 24, 9, withAlpha(C_LOOT, 0.95), 'center');
        break;
      }
      case 'INTERACT': {
        // 사거리 안에 대상이 있을 때만 초록으로 살아난다 — 없을 때 눌러 봐야 소용없다.
        padCircle(ctx, pad, hotE ? C_ON : C_EDGE, pressed, hotE);
        stencil(
          ctx,
          'E',
          pad.cx,
          pad.cy + 2,
          18,
          withAlpha(hotE ? C_ON : C_STENCIL_DIM, hotE ? 1 : 0.8),
          'center',
        );
        stencil(ctx, pad.sub, pad.cx, pad.cy + 20, 8, C_STENCIL_DIM, 'center', 'normal');
        break;
      }
      case 'OVERWRITE': {
        padCircle(ctx, pad, canQ ? C_LOOT : C_OFF, pressed, canQ);
        stencil(
          ctx,
          'Q',
          pad.cx,
          pad.cy + 2,
          16,
          withAlpha(canQ ? C_LOOT : C_STENCIL_DIM, canQ ? 1 : 0.75),
          'center',
        );
        stencil(ctx, canQ ? pad.sub : 'SPENT', pad.cx, pad.cy + 18, 8, C_STENCIL_DIM, 'center', 'normal');
        break;
      }
      case 'RESET': {
        padCircle(ctx, pad, C_DANGER, pressed, true);
        // 2초 홀드 진행도를 버튼 자체에도 감는다 — 화면 중앙 다이얼과 같은 값이다.
        const frac = Math.max(0, Math.min(1, s.resetHold / RESET_HOLD_TICKS));
        if (frac > 0) {
          ctx.strokeStyle = C_DANGER;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(pad.cx, pad.cy, pad.r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
          ctx.stroke();
        }
        stencil(ctx, pad.label, pad.cx, pad.cy + 5, 15, withAlpha(C_DANGER, 0.95), 'center');
        break;
      }
      case 'PAUSE': {
        padCircle(ctx, pad, C_EDGE, pressed, true);
        ctx.fillStyle = withAlpha(C_STENCIL, 0.85);
        ctx.fillRect(pad.cx - 5, pad.cy - 6, 3, 12);
        ctx.fillRect(pad.cx + 2, pad.cy - 6, 3, 12);
        break;
      }
      default:
        break;
    }
  }
}

/** 포커스된 줄임을 알리는 왼쪽 삼각형. 어느 줄을 ← → 가 조작하는지가 한눈에 보여야 한다. */
function drawRowCaret(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const pulse = 0.6 + Math.sin(t * 0.08) * 0.4;
  ctx.save();
  ctx.fillStyle = withAlpha(C_STENCIL, 0.55 + pulse * 0.45);
  ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 선택 칩 = 벽에 붙은 표찰. 고른 것만 테두리가 굵고 색이 살아 있다. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  col: string,
  on: boolean,
  focused: boolean,
): void {
  // 고르지 않은 줄은 통째로 흐려진다 — 지금 조작 중인 줄이 어디인지가 먼저 읽혀야 한다.
  const dim = focused ? 1 : 0.5;
  plate(ctx, x, y, w, CHIP_H, dim);
  if (on) {
    ctx.fillStyle = withAlpha(col, 0.14 * dim);
    ctx.fillRect(x + 1, y + 1, w - 2, CHIP_H - 2);
  }
  frame(ctx, x, y, w, CHIP_H, on ? col : C_OFF, (on ? 0.9 : 0.5) * dim, on ? 2 : 1);
  rivets(ctx, x, y, w, CHIP_H);
  // 고르지 않았다는 사실은 **테두리와 바탕**이 말한다. 글자를 C_OFF 로 떨어뜨리면
  // 판 위에서 1.8:1 이라 "고르기 전에 뭔지 알아야 한다"는 이 줄의 목적이 깨진다.
  stencil(
    ctx,
    label,
    x + w / 2,
    y + 19,
    13,
    on ? withAlpha(col, dim) : withAlpha(C_STENCIL_DIM, focused ? 1 : 0.7),
    'center',
  );
}

/**
 * 위 줄 — 플레이 방식. 칩마다 짧은 캡션이 붙고, 고른 것의 한 줄 설명과
 * 그 모드의 최고 기록이 아래에 붙는다.
 */
function drawPlayModeRow(
  ctx: CanvasRenderingContext2D,
  playMode: PlayMode,
  mode: Mode,
  focused: boolean,
  t: number,
): void {
  const chipW = PM_CHIP_W;
  const gap = PM_GAP;
  const list: PlayMode[] = ['STORY', 'GAUNTLET', 'TIME_ATTACK'];
  const startX = rowStartX(chipW, gap, list.length);

  if (focused) drawRowCaret(ctx, startX - 22, ROW1_Y + CHIP_H / 2, t);

  list.forEach((pm, i) => {
    const x = startX + i * (chipW + gap);
    const on = playMode === pm;
    const col = pm === 'STORY' ? C_STENCIL : pm === 'GAUNTLET' ? C_DANGER : C_LOOT;
    drawChip(ctx, x, ROW1_Y, chipW, PLAY_MODE_LABEL[pm], col, on, focused);
    stencil(
      ctx,
      `${i + 1} ▸ ${PLAY_MODE_CAPTION[pm]}`,
      x + chipW / 2,
      ROW1_Y + CHIP_H + 12,
      9,
      withAlpha(on ? col : C_STENCIL_DIM, focused ? 0.9 : 0.45),
      'center',
      on ? 'bold' : 'normal',
    );
  });

  const line = PLAY_MODE_LINE[playMode];
  const best = playMode === 'STORY' ? null : titleBest(playMode, mode, t);
  text(
    ctx,
    best === null ? line : `${line}     BEST ${bestLabel(playMode, best)}`,
    CANVAS_W / 2,
    ROW1_Y + CHIP_H + 30,
    10,
    playMode === 'STORY' ? C_TEXT_DIM : C_TEXT,
    'center',
    playMode === 'STORY' ? 'normal' : 'bold',
  );
}

/** 아래 줄 — 감지 방식. 플레이 방식과 자유롭게 조합된다. */
function drawDetectRow(
  ctx: CanvasRenderingContext2D,
  mode: Mode,
  focused: boolean,
): void {
  const chipW = DT_CHIP_W;
  const gap = DT_GAP;
  const list: Mode[] = ['EASY', 'LISTEN'];
  const startX = rowStartX(chipW, gap, list.length);

  if (focused) drawRowCaret(ctx, startX - 22, ROW2_Y + CHIP_H / 2, 0);

  list.forEach((m, i) => {
    const x = startX + i * (chipW + gap);
    const col = m === 'LISTEN' ? C_DANGER : C_STENCIL;
    drawChip(ctx, x, ROW2_Y, chipW, `[ ${m} ]`, col, mode === m, focused);
    stencil(
      ctx,
      `${i + 1} ▸ ${m === 'LISTEN' ? '마이크 사용' : '키보드만'}`,
      x + chipW / 2,
      ROW2_Y + CHIP_H + 12,
      9,
      withAlpha(mode === m ? col : C_STENCIL_DIM, focused ? 0.9 : 0.45),
      'center',
      mode === m ? 'bold' : 'normal',
    );
  });

  text(
    ctx,
    mode === 'LISTEN'
      ? '마이크를 씁니다. 숨소리도 들립니다 — 시끄러우면 간수가 옵니다'
      : '마이크를 쓰지 않습니다. 키보드만으로 플레이합니다',
    CANVAS_W / 2,
    ROW2_Y + CHIP_H + 30,
    10,
    mode === 'LISTEN' ? C_DANGER : C_TEXT_DIM,
    'center',
    mode === 'LISTEN' ? 'bold' : 'normal',
  );
}

// ── 최고 기록 캐시 ─────────────────────────────────────────────────────────
// 타이틀은 60fps 로 다시 그려진다. localStorage 를 프레임마다 읽을 이유는 없으므로
// (모드, 감지) 조합당 1초에 한 번만 읽는다 — 런이 끝나고 돌아와도 곧 갱신된다.

let bestKeyCache = '';
let bestCache: BestRecord | null = null;
let bestReadAt = -1e9;

function titleBest(playMode: PlayMode, mode: Mode, t: number): BestRecord | null {
  const key = `${playMode}|${mode}`;
  // 타이틀로 돌아오면 시계가 0 으로 되감긴다. 차이의 **절대값**을 봐야 방금 끝낸
  // 런의 기록이 즉시 반영된다 (t - bestReadAt 만 보면 영원히 옛 값을 돌려준다).
  if (key !== bestKeyCache || Math.abs(t - bestReadAt) > TICK_HZ) {
    bestKeyCache = key;
    bestReadAt = t;
    bestCache = loadBest(playMode, mode);
  }
  return bestCache;
}

/** 기록 한 줄. 모드마다 자랑하는 숫자가 다르다. */
function bestLabel(playMode: PlayMode, best: BestRecord): string {
  return playMode === 'TIME_ATTACK'
    ? formatTime(best.ticks)
    : `DEBT ${best.debt} · 잔상 ${best.afterimages}`;
}

// ── 루프 전환 ──────────────────────────────────────────────────────────────

export function drawTransition(
  ctx: CanvasRenderingContext2D,
  s: Session,
): void {
  // 전환은 1.5초. 들어올 때 빠르게 어두워지고 나갈 때 빠르게 걷힌다.
  const elapsed = LOOP_TRANSITION_TICKS - s.transitionTimer;
  const inA = Math.min(1, elapsed / 12);
  const outA = Math.min(1, s.transitionTimer / 12);
  const a = Math.min(inA, outA);
  scrim(ctx, 0.86 * a);

  const lines: string[] = s.transitionMsg;
  const startY = CANVAS_H / 2 - (lines.length - 1) * 20;
  lines.forEach((line: string, i: number) => {
    // 첫 줄은 사건(CAPTURED. / TIME'S UP. …), 마지막 줄은 새 정체성.
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    const size = isFirst ? 30 : isLast ? 18 : 14;
    const col = isFirst ? C_DANGER : isLast ? C_STENCIL : C_TEXT;
    const y = startY + i * 40;
    // 사건 선언은 벽에 찍힌 도장처럼 크게 — 브리지 두 줄이 스텐실임을 말한다.
    if (isFirst) stencilBig(ctx, line, CANVAS_W / 2, y, size, withAlpha(col, a), withAlpha(C_BG, a));
    else stencil(ctx, line, CANVAS_W / 2, y, size, withAlpha(col, a), 'center');
  });
}

// ── 클리어 ─────────────────────────────────────────────────────────────────

export function drawClear(ctx: CanvasRenderingContext2D, s: Session): void {
  const all = s.phase === 'ALLCLEAR';
  // 이어서 하는 모드의 마지막 스테이지 = 런의 끝. 성적표가 다르다.
  if (all && s.playMode !== 'STORY' && s.runResult !== null) {
    drawRunResult(ctx, s.runResult);
    return;
  }
  scrim(ctx, 0.9);

  const panelW = 460;
  const panelH = all ? 330 : 300;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;
  plate(ctx, px, py, panelW, panelH);
  frame(ctx, px, py, panelW, panelH, C_ON, 0.55, 2);
  rivets(ctx, px, py, panelW, panelH);

  stencilBig(
    ctx,
    all ? 'ALL ESCAPED' : 'ESCAPED',
    CANVAS_W / 2,
    py + 48,
    all ? 26 : 30,
    C_ON,
    C_PLATE,
  );
  const runMode = s.playMode !== 'STORY';
  stencil(
    ctx,
    runMode
      ? `STAGE ${s.stageIndex + 1} / ${STAGES.length} — ${s.level.name.toUpperCase()}`
      : `STAGE ${s.stageIndex + 1} — ${s.level.name.toUpperCase()}`,
    CANVAS_W / 2,
    py + 70,
    10,
    C_STENCIL_DIM,
    'center',
    'normal',
  );

  const used = s.ghosts.length;
  const totals = runTotals(s);
  const rows: [string, string, string][] = [
    ['LOOPS', String(used + 1), C_STENCIL],
    ['AFTERIMAGES', `${used} / PAR ${s.level.par}`, used <= s.level.par ? C_ON : C_STENCIL],
    ['TIME', formatTime(s.elapsedTicks), C_STENCIL],
    ['ALERTS', String(s.alerts), s.alerts > 0 ? C_LOOT : C_STENCIL],
    ['DEBT', String(s.debt), s.debt > 0 ? C_DANGER : C_STENCIL],
  ];
  // 이어서 하는 모드에서는 이 스테이지의 성적보다 런 누적치가 더 중요하다.
  if (runMode) {
    rows.splice(3, 0, [
      s.playMode === 'TIME_ATTACK' ? 'RUN TIME' : 'RUN GHOSTS',
      s.playMode === 'TIME_ATTACK'
        ? formatTime(totals.ticks)
        : String(totals.afterimages),
      C_LOOT,
    ]);
  }
  rows.forEach((r, i) => {
    const ry = py + 106 + i * 26;
    // 항목 사이 얇은 홈 — 성적표가 인쇄 양식처럼 읽힌다.
    ctx.fillStyle = withAlpha(C_BG, 0.35);
    ctx.fillRect(px + 40, ry + 6, panelW - 80, 1);
    stencil(ctx, r[0], px + 40, ry, 12, C_STENCIL_DIM, 'left', 'normal');
    stencil(ctx, r[1], px + panelW - 40, ry, 13, r[2], 'right');
  });

  const medalY = py + 250;
  if (s.medal) {
    plate(ctx, px + 30, medalY - 20, panelW - 60, 30);
    frame(ctx, px + 30, medalY - 20, panelW - 60, 30, C_LOOT, 0.7);
    stencil(ctx, 'MINIMUM AFTERIMAGE ★', CANVAS_W / 2, medalY, 15, C_LOOT, 'center');
  } else {
    text(
      ctx,
      `PAR ${s.level.par} 이하의 나로 다시 빠져나가 보라`,
      CANVAS_W / 2,
      medalY,
      11,
      C_TEXT_DIM,
      'center',
    );
  }

  stencil(
    ctx,
    all ? 'ENTER ▸ TITLE' : runMode ? 'ENTER ▸ 다음 스테이지로 계속' : 'ENTER ▸ NEXT',
    CANVAS_W / 2,
    py + panelH - 24,
    14,
    C_STENCIL,
    'center',
  );
}

// ── 런 결과 (GAUNTLET / TIME ATTACK) ───────────────────────────────────────

/**
 * 런 성적표. 모드마다 자랑하는 숫자가 다르다 —
 * GAUNTLET 은 **끝까지 따라온 부채**, TIME ATTACK 은 **총 시간**.
 * 아래에는 스테이지별 스플릿을 두 열로 깐다.
 */
function drawRunResult(ctx: CanvasRenderingContext2D, r: RunResult): void {
  scrim(ctx, 0.92);

  const timed = r.playMode === 'TIME_ATTACK';
  const panelW = 700;
  const panelH = 452;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;

  plate(ctx, px, py, panelW, panelH);
  frame(ctx, px, py, panelW, panelH, timed ? C_LOOT : C_DANGER, 0.6, 2);
  rivets(ctx, px, py, panelW, panelH);

  stencilBig(ctx, 'RUN COMPLETE', CANVAS_W / 2, py + 40, 24, C_ON, C_PLATE);
  stencil(
    ctx,
    `${PLAY_MODE_LABEL[r.playMode]}  ·  ${r.mode}  ·  ${r.totals.stages} / ${STAGES.length} STAGES`,
    CANVAS_W / 2,
    py + 60,
    10,
    C_STENCIL_DIM,
    'center',
    'normal',
  );

  // ── 히어로 숫자 ──
  const heroCol = timed ? C_LOOT : C_DANGER;
  stencil(ctx, timed ? 'TOTAL TIME' : 'TOTAL DEBT', CANVAS_W / 2, py + 92, 10, C_STENCIL_DIM, 'center');
  stencilBig(
    ctx,
    timed ? formatTime(r.totals.ticks) : String(r.totals.debt),
    CANVAS_W / 2,
    py + 134,
    38,
    heroCol,
    C_PLATE,
  );
  text(
    ctx,
    timed ? '모든 루프의 시간이 합산된 기록' : '한 런을 관통한, 지울 수 없는 부채',
    CANVAS_W / 2,
    py + 154,
    10,
    withAlpha(C_TEXT_DIM, 0.9),
    'center',
  );

  // ── NEW BEST / 이전 기록 ──
  if (r.newBest) {
    const bw = 260;
    const bx = CANVAS_W / 2 - bw / 2;
    plate(ctx, bx, py + 166, bw, 26);
    frame(ctx, bx, py + 166, bw, 26, C_LOOT, 0.8);
    rivets(ctx, bx, py + 166, bw, 26);
    stencil(ctx, 'NEW BEST ★', CANVAS_W / 2, py + 184, 14, C_LOOT, 'center');
    if (!r.saved) {
      // 저장이 막힌 환경(프라이빗 모드 등)이라는 사실을 숨기지 않는다.
      text(ctx, '기록을 저장하지 못했습니다 (브라우저 저장소 차단)', CANVAS_W / 2, py + 204, 9, C_TEXT_DIM, 'center');
    }
  } else if (r.previousBest !== null) {
    stencil(
      ctx,
      `BEST ${bestLabel(r.playMode, r.previousBest)}`,
      CANVAS_W / 2,
      py + 184,
      12,
      C_STENCIL_DIM,
      'center',
    );
  }

  // ── 누적 스탯 ──
  const stats: [string, string, string][] = [
    ['STAGES', `${r.totals.stages}`, C_STENCIL],
    ['AFTERIMAGES', `${r.totals.afterimages}`, C_STENCIL],
    [timed ? 'DEBT' : 'TIME', timed ? `${r.totals.debt}` : formatTime(r.totals.ticks),
      timed && r.totals.debt > 0 ? C_DANGER : C_STENCIL],
    ['ALERTS', `${r.totals.alerts}`, r.totals.alerts > 0 ? C_LOOT : C_STENCIL],
    ['MEDALS', `${r.totals.medals} ★`, r.totals.medals > 0 ? C_LOOT : C_STENCIL],
  ];
  const statW = (panelW - 80) / stats.length;
  stats.forEach((st, i) => {
    const cx = px + 40 + statW * i + statW / 2;
    stencil(ctx, st[0], cx, py + 226, 9, C_STENCIL_DIM, 'center', 'normal');
    stencil(ctx, st[1], cx, py + 246, 15, st[2], 'center');
  });

  drawSplits(ctx, r.splits, px + 40, py + 274, panelW - 80, timed);

  stencil(ctx, 'ENTER ▸ TITLE', CANVAS_W / 2, py + panelH - 20, 14, C_STENCIL, 'center');
}

/** 스테이지별 스플릿. 15개까지 두 열로 나눠 담는다. */
function drawSplits(
  ctx: CanvasRenderingContext2D,
  splits: readonly StageSplit[],
  x: number,
  y: number,
  w: number,
  timed: boolean,
): void {
  ctx.fillStyle = withAlpha(C_EDGE, 0.2);
  ctx.fillRect(x, y - 14, w, 1);
  stencil(ctx, timed ? 'SPLITS' : 'STAGES', x, y - 2, 9, C_STENCIL_DIM);

  if (splits.length === 0) return;

  const gap = 24;
  const colW = (w - gap) / 2;
  const perCol = Math.ceil(splits.length / 2);
  const rowH = 17;

  splits.forEach((sp, i) => {
    const col = i < perCol ? 0 : 1;
    const row = i - col * perCol;
    const cx = x + col * (colW + gap);
    const cy = y + 14 + row * rowH;
    const name = sp.name.length > 15 ? `${sp.name.slice(0, 14)}…` : sp.name;
    stencil(
      ctx,
      `${pad2(sp.stageIndex + 1)} ${sp.medal ? '★' : ' '} ${name}`,
      cx,
      cy,
      9,
      sp.medal ? C_LOOT : C_STENCIL_DIM,
      'left',
      'normal',
    );
    stencil(
      ctx,
      timed ? formatTime(sp.ticks) : `잔상 ${sp.afterimages}`,
      cx + colW,
      cy,
      9,
      C_STENCIL,
      'right',
    );
  });
}

// ── 일시정지 ───────────────────────────────────────────────────────────────

export function drawPause(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.82);
  stencilBig(ctx, 'PAUSED', CANVAS_W / 2, 150, 34, C_STENCIL, withAlpha(C_BG, 0.82));
  stencil(
    ctx,
    touchUi ? 'RESUME 를 탭하세요' : 'ESC ▸ RESUME',
    CANVAS_W / 2,
    176,
    11,
    C_STENCIL_DIM,
    'center',
    'normal',
  );

  if (touchUi) {
    // 손가락에게는 키 이름이 아니라 화면 어디를 누르는지가 정보다.
    const touchRows: [string, string][] = [
      ['왼쪽 스틱', '이동 — 바깥 링까지 밀면 달리기(소음)'],
      ['COMMIT', '루프 조기 확정 → 지금까지의 나를 잔상으로'],
      ['E / Q', '상호작용 / 잔상 덮어쓰기 (스테이지당 1회)'],
      ['⟲ 2초 홀드', '스테이지 전체 초기화 — DEBT +1'],
    ];
    touchRows.forEach((r, i) => {
      const y = 232 + i * 26;
      stencil(ctx, r[0], CANVAS_W / 2 - 250, y, 12, withAlpha(C_STRIPE, 0.95));
      text(ctx, r[1], CANVAS_W / 2 - 110, y, 11, C_TEXT_DIM, 'left');
    });
    tapButton(ctx, PAUSE_RESUME_BTN, 'RESUME', C_STENCIL);
    tapButton(ctx, PAUSE_MUTE_BTN, '뮤트 켜기 / 끄기', C_STENCIL_DIM);
    text(
      ctx,
      '잔상은 궤적이 아니라 입력 테이프다. 매 루프 세계는 틱 0으로 되감기고, 과거의 나는 같은 키를 다시 누른다.',
      CANVAS_W / 2,
      CANVAS_H - 46,
      10,
      C_TEXT_DIM,
      'center',
    );
    return;
  }

  const rows: [string, string][] = [
    ['WASD / ARROWS', '이동'],
    ['SHIFT', '달리기 — 12틱마다 소음, WARDEN 이 조사하러 온다'],
    ['E', '버튼 / 레버 상호작용'],
    ['R', '루프 조기 확정 → 지금까지의 나를 잔상으로 남긴다'],
    ['Q → 1/2/3', '잔상 하나를 지우고 재녹화 (스테이지당 1회)'],
    ['BACKSPACE 2초', '스테이지 전체 초기화 — DEBT +1, 절대 안 지워진다'],
    ['M', '뮤트'],
    ['− / =', 'LISTEN 모드 마이크 감도 — 현장이 시끄러우면 낮춰라'],
  ];
  rows.forEach((r, i) => {
    const y = 224 + i * 24;
    stencil(ctx, r[0], CANVAS_W / 2 - 250, y, 12, withAlpha(C_STRIPE, 0.95));
    text(ctx, r[1], CANVAS_W / 2 - 80, y, 11, C_TEXT_DIM, 'left');
  });

  text(
    ctx,
    '잔상은 궤적이 아니라 입력 테이프다. 매 루프 세계는 틱 0으로 되감기고, 과거의 나는 같은 키를 다시 누른다.',
    CANVAS_W / 2,
    CANVAS_H - 46,
    10,
    C_TEXT_DIM,
    'center',
  );
}
