/**
 * 부트스트랩.
 *
 * 여기서만 브라우저를 만진다: 캔버스·키보드·오디오·rAF.
 * `sim/` 은 DOM 을 전혀 모르고(헤드리스 테스트 가능), `game/session.ts` 는
 * 틱 단위 순수 로직이며, 이 파일이 그 둘을 화면과 손가락에 연결한다.
 */
import { createAudio } from './engine/audio';
import { createInput, type Input, type MetaKey } from './engine/input';
import { startLoop } from './engine/loop';
import { createMic } from './engine/mic';
import {
  createSoundscape,
  resetSoundscape,
  updateSoundscape,
} from './engine/soundscape';
import {
  canvasPoint,
  createTouch,
  mergeInput,
  type TouchContext,
} from './engine/touch';
import {
  beginOverwriteMode,
  commitLoop,
  createSession,
  fullReset,
  nextStage,
  PLAY_MODES,
  requestOverwrite,
  runTotals,
  setPlayMode,
  startRun,
  tickSession,
  type Mode,
  type PlayMode,
  type Session,
} from './game/session';
import {
  drawCalibration,
  drawClear,
  drawEnding,
  drawHelp,
  drawHud,
  drawPause,
  drawTitle,
  drawTouchControls,
  drawTransition,
  HELP_HITS,
  hitTest,
  isHelpOpen,
  learnPrompt,
  PAUSE_HITS,
  setHelpOpen,
  setTouchUi,
  TITLE_HITS,
  topLayer,
} from './render/hud';
import {
  createInterlude,
  drawInterlude,
  hasSeenInterlude,
  INTERLUDE_TICKS,
  interludeAfterStage,
  markInterludeSeen,
  tickInterlude,
  type InterludeState,
} from './render/interlude';
import {
  advanceIntro,
  createIntro,
  drawIntro,
  hasSeenIntro,
  INTRO_TICKS,
  markIntroSeen,
  tickIntro,
  type IntroState,
} from './render/intro';
import { openNoteId } from './render/note';
import { createView, drawWorld, updateView } from './render/renderer';
import {
  BODY_SUB,
  CANVAS_H,
  CANVAS_W,
  IN_MIC_SHIFT,
  RESET_HOLD_TICKS,
  TILE_SUB,
} from './sim/constants';
import type { TickEvents } from './sim/types';

// ── 캔버스 ─────────────────────────────────────────────────────────────────

const fatal = document.getElementById('fatal');

function die(msg: string): never {
  if (fatal !== null) {
    fatal.textContent = msg;
    fatal.style.display = 'flex';
  }
  throw new Error(msg);
}

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  die('게임 화면을 불러오지 못했어. 페이지를 새로고침해 봐.');
}
const cv = canvas as HTMLCanvasElement;
cv.width = CANVAS_W;
cv.height = CANVAS_H;

const ctx = cv.getContext('2d', { alpha: false });
if (ctx === null) {
  die('이 환경에서는 그래픽을 켤 수 없어. 브라우저를 업데이트하거나 다른 브라우저로 열어 봐.');
}
const g = ctx as CanvasRenderingContext2D;
g.imageSmoothingEnabled = false;

/**
 * devicePixelRatio 상한. 모바일 GPU 에서 백버퍼를 무제한으로 곱하면
 * (dpr 3~4 짜리 기기가 흔하다) 픽셀 수가 9~16배로 뛰어 프레임이 무너진다.
 */
const MAX_DPR = 2;

const stageEl = document.getElementById('stage');

/**
 * 배율 계산의 기준. `#stage` 는 safe-area 만큼 **inset** 으로 들어와 있어
 * (padding 이 아니다 — `clientWidth` 는 padding 을 포함한다) 노치·홈바 바깥의
 * 실제 사용 가능 영역이 곧 이 요소의 크기다. 데스크톱에서는 inset 이 0 이라
 * `window.innerWidth/Height` 와 같은 값이 된다.
 */
function viewportSize(): { w: number; h: number } {
  const w = stageEl !== null && stageEl.clientWidth > 0 ? stageEl.clientWidth : window.innerWidth;
  const h = stageEl !== null && stageEl.clientHeight > 0 ? stageEl.clientHeight : window.innerHeight;
  return { w, h };
}

/**
 * 백버퍼 크기 + 내부 좌표계 변환.
 *
 * **내부 좌표는 어떤 경우에도 960×600 이다** — 렌더 코드 전체가 그 좌표계에
 * 의존하므로, 배율은 이 변환 하나로만 존재한다.
 * `canvas.width` 대입은 컨텍스트 상태(변환·보간 설정)를 초기화하므로 그 뒤에 다시 세운다.
 */
function setBackbuffer(w: number, h: number): void {
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  g.setTransform(w / CANVAS_W, 0, 0, h / CANVAS_H, 0, 0);
  g.imageSmoothingEnabled = false;
}

/**
 * 내부 해상도 960×600 을 화면에 맞춘다.
 *
 * 화면이 960×600 이상이면 **예전 그대로**다: 백버퍼 960×600, 변환 없음, CSS 정수배 확대.
 * 소수배 확대는 pixelated 렌더에서 픽셀 폭이 들쭉날쭉해지므로 데스크톱에서는 쓰지 않는다.
 *
 * 화면이 그보다 작으면(휴대폰 · 작은 창) 정수배가 애초에 존재하지 않는다. 이때는
 * 비율을 지키며 소수배로 축소하고(letterbox 는 flex 중앙 정렬이 만든다), 백버퍼를
 * dpr 배로 키워 선명도를 되찾는다.
 */
function fitCanvas(): void {
  const { w: vw, h: vh } = viewportSize();
  const raw = Math.min(vw / CANVAS_W, vh / CANVAS_H);

  if (raw >= 1) {
    const scale = Math.floor(raw);
    cv.style.width = `${CANVAS_W * scale}px`;
    cv.style.height = `${CANVAS_H * scale}px`;
    setBackbuffer(CANVAS_W, CANVAS_H);
    return;
  }

  const scale = Math.max(0.05, raw);
  const cssW = Math.max(1, Math.floor(CANVAS_W * scale));
  const cssH = Math.max(1, Math.floor(CANVAS_H * scale));
  cv.style.width = `${cssW}px`;
  cv.style.height = `${cssH}px`;
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  setBackbuffer(Math.round(cssW * dpr), Math.round(cssH * dpr));
}
fitCanvas();

// ── 런타임 ─────────────────────────────────────────────────────────────────

/** 터치 기기로 판정됐는가. 이 값이 true 일 때만 화면 조작 UI 가 존재한다. */
let touchMode = false;

const keyboard = createInput();
const touch = createTouch({
  canvas: cv,
  onTouchDetected: (): void => {
    touchMode = true;
    setTouchUi(true);
    onResize();
  },
});
/**
 * 터치와 키보드는 **같은 `InputMask` 경로**로 합쳐진다. 여기서 합친 뒤로는
 * 어느 손가락이 만든 비트인지 시뮬이 알 방법이 없다 — 그게 결정론의 전제다.
 */
const input: Input = mergeInput(keyboard, touch);
if (touch.isTouch()) {
  touchMode = true;
  setTouchUi(true);
}

// ── 세로 모드 게이트 ───────────────────────────────────────────────────────
// 방 전체를 봐야 퍼즐이 성립하므로 세로 레이아웃은 만들지 않는다. 대신 회전을
// 안내하고 그동안 **틱을 진행하지 않는다**(안내 화면 뒤에서 간수가 걸어오면 안 된다).

const rotateEl = document.getElementById('rotate');
let portraitBlocked = false;

function updateOrientation(): void {
  const { w, h } = viewportSize();
  const blocked = touchMode && h > w;
  if (blocked === portraitBlocked) return;
  portraitBlocked = blocked;
  if (rotateEl !== null) rotateEl.style.display = blocked ? 'flex' : 'none';
  // 돌리는 동안 쌓인 엣지가 돌아온 순간 한꺼번에 터지면 안 된다.
  input.flush();
}

function onResize(): void {
  fitCanvas();
  updateOrientation();
}

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
// Safari 가 back/forward cache 에서 문서를 복원하면 load/resize 없이 돌아올 수 있다.
window.addEventListener('pageshow', onResize);
// 모바일 브라우저는 주소창이 접힐 때 resize 가 아니라 이쪽만 쏘는 경우가 있다.
window.visualViewport?.addEventListener('resize', onResize);
onResize();

const audio = createAudio();
const mic = createMic();
/**
 * 정위 오디오의 **오디오 전용** 상태(발소리 위상 등). 시뮬 밖에 있으므로 잔상 재생에
 * 영향을 주지 않는다 — 그 불변은 `tests/soundscape.test.ts` 가 해시로 증명한다.
 */
const soundscape = createSoundscape();
const view = createView();
let session: Session = createSession();

/**
 * 마이크가 거부·미지원·오류일 때 화면에 남기는 한 줄. **게임은 절대 죽지 않는다** —
 * 모드를 EASY 로 내리고 계속 간다.
 */
let micNotice: string | null = null;
let micNoticeTimer = 0;
/** 알림 노출 시간(7초). 모드를 다시 고르면 그 즉시 지워진다. */
const MIC_NOTICE_TICKS = 420;

function setMode(m: Mode): void {
  if (session.mode === m) return;
  session.mode = m;
  micNotice = null;
  micNoticeTimer = 0;
  // 모드를 빠져나가면 스트림을 즉시 반납한다 — 마이크 표시등이 켜진 채 남으면 안 된다.
  if (m !== 'LISTEN') mic.stop();
}

/**
 * 타이틀에서 지금 ← → 가 조작하는 줄. 0 = 플레이 방식(STORY/GAUNTLET/TIME ATTACK),
 * 1 = 감지 방식(EASY/LISTEN). 두 축은 독립이라 줄을 옮겨도 고른 값은 유지된다.
 */
let titleRow: 0 | 1 = 0;

/** 포커스된 줄의 항목을 좌우로 옮긴다. 양끝에서 멈춘다(순환하면 어디에 있는지 놓친다). */
function stepTitleSelection(dir: -1 | 1): void {
  if (titleRow === 0) {
    const i = PLAY_MODES.indexOf(session.playMode);
    const next = PLAY_MODES[Math.min(PLAY_MODES.length - 1, Math.max(0, i + dir))];
    if (next !== undefined) setPlayMode(session, next);
    return;
  }
  setMode(dir < 0 ? 'EASY' : 'LISTEN');
}

/** 숫자키는 포커스된 줄의 n번째 항목을 고른다. */
function pickTitleIndex(n: number): void {
  if (titleRow === 0) {
    const pm: PlayMode | undefined = PLAY_MODES[n];
    if (pm !== undefined) setPlayMode(session, pm);
    return;
  }
  if (n === 0) setMode('EASY');
  else if (n === 1) setMode('LISTEN');
}

/** 마이크 실패를 한 줄로 알리고 EASY 로 내려앉는다. */
function fallbackToEasy(): void {
  micNotice = `마이크를 쓸 수 없어 — ${mic.error() ?? '원인을 알 수 없어.'} EASY 모드로 계속한다.`;
  micNoticeTimer = MIC_NOTICE_TICKS;
  mic.stop();
  session.mode = 'EASY';
}

/**
 * 조작 중인 몸(I)의 마이크 레벨을 입력 마스크의 비트 6~7 에 싣는다.
 * 이 값은 그대로 테이프에 **녹화**되고, 다음 루프부터는 잔상이 그 녹화본을 재생한다.
 * 실시간 마이크가 잔상에 닿는 경로는 존재하지 않는다 → 재생 오차 정확히 0.
 */
function micBits(): number {
  if (session.mode !== 'LISTEN') return 0;
  return (mic.level() & 3) << IN_MIC_SHIFT;
}

/** LISTEN 이면서 마이크가 살아 있을 때만 HUD 계기판을 그린다. */
function micView(): ReturnType<typeof mic.view> | null {
  return session.mode === 'LISTEN' ? mic.view() : null;
}

/** 타이틀/정지 화면 애니메이션용 프레임 카운터. 시뮬과 무관하다. */
let uiClock = 0;

/**
 * 개발 모드 전용 입력 스크립트 큐 (SPEC §21.2 자동화 QA).
 * null 이면 평소대로 실시간 키보드를 읽는다. 파일 끝의 `__imm` 훅만 이걸 채우며,
 * 프로덕션 번들에서는 그 훅도 여기 쓰는 코드도 DEV 가드로 제거된다.
 */
let devQueue: number[] | null = null;

/** CLEAR 화면에서도 loot 회전 등을 계속 돌리되, 이펙트는 새로 터뜨리지 않는다. */
const IDLE_EVENTS: TickEvents = {
  captured: false,
  cleared: false,
  lootTaken: false,
  gateToggled: false,
  interacted: false,
  alerted: false,
  footstep: false,
  ghostSpotted: false,
  flashFired: false,
};

// ── SFX 엣지 트리거 ────────────────────────────────────────────────────────
// TickEvents 플래그가 여러 틱 동안 켜져 있어도 소리는 한 번만 난다.
const prevEvents: TickEvents = { ...IDLE_EVENTS };

function playSfx(e: TickEvents): void {
  if (e.footstep && !prevEvents.footstep) audio.footstep();
  if (e.interacted && !prevEvents.interacted) audio.interact();
  if (e.gateToggled && !prevEvents.gateToggled) audio.door();
  if (e.alerted && !prevEvents.alerted) audio.alert();
  else if (e.ghostSpotted && !prevEvents.ghostSpotted) audio.alert();
  if (e.lootTaken && !prevEvents.lootTaken) audio.loot();
  if (e.captured && !prevEvents.captured) audio.capture();
  if (e.cleared && !prevEvents.cleared) audio.clear();

  prevEvents.footstep = e.footstep;
  prevEvents.interacted = e.interacted;
  prevEvents.gateToggled = e.gateToggled;
  prevEvents.alerted = e.alerted;
  prevEvents.ghostSpotted = e.ghostSpotted;
  prevEvents.lootTaken = e.lootTaken;
  prevEvents.captured = e.captured;
  prevEvents.cleared = e.cleared;
}

function resetSfxEdges(): void {
  Object.assign(prevEvents, IDLE_EVENTS);
  // 루프/스테이지 경계에서 정위음 위상도 함께 버린다. 안 버리면 전환 직후에
  // "없던 발소리 한 발"이나 가짜 상태 전이(SUSPICIOUS 진입음)가 터진다.
  resetSoundscape(soundscape);
}

/**
 * 이번 틱에 들려야 할 정위음을 발음한다. `SimState` 는 **읽기만** 한다.
 * EASY 에서도 난다 — 다만 사거리·게인·촘촘함이 LISTEN 보다 낮다(`soundscape.TUNING`).
 */
function playSoundscape(): void {
  audio.playCues(updateSoundscape(soundscape, session.sim, session.mode));
}

// ── 페이즈 전환 ────────────────────────────────────────────────────────────

/**
 * 타이틀 → 첫 스테이지. 여기가 **런의 시작점**이라 런 누적치와 DEBT 가 0 으로 돌아간다
 * (부채가 리셋되지 않는 범위는 런 하나다 — SPEC §3-2).
 */
function beginStage(index: number): void {
  resetEnding();
  startRun(session, index);
  // startStage 가 페이즈를 옮기지 않는 구현이어도 화면이 멈추지 않게 보정한다.
  if (session.phase === 'TITLE' || session.phase === 'CLEAR') {
    session.phase = 'PLAY';
  }
  session.resetHold = 0;
  resetSfxEdges();
  input.flush();
}

function backToTitle(): void {
  resetEnding();
  const mode = session.mode;
  const playMode = session.playMode;
  session = createSession();
  // 고른 두 축은 유지하되 마이크는 반납한다. 타이틀에서 대기하는 동안 표시등이
  // 켜져 있을 이유가 없다 — ENTER(사용자 제스처)에서 다시 연다.
  session.mode = mode;
  session.playMode = playMode;
  mic.stop();
  uiClock = 0;
  resetSfxEdges();
  input.flush();
}

// ── 인트로 (7칸 만화) ──────────────────────────────────────────────────────
// 시뮬과 완전히 분리돼 있다: SimState 를 만들지도 굴리지도 않고, 자체 틱만 센다.
// 최초 1회만 자동으로 열고 그 뒤로는 타이틀에서 `S` 로만 다시 본다.

let intro: IntroState | null = null;
/** 개발 모드에서 컷별 스크린샷을 찍기 위해 인트로 타이머를 세운다(§21.2 자동화 QA). */
let introFrozen = false;

function enterIntro(): void {
  intro = createIntro();
  introFrozen = false;
  session.phase = 'INTRO';
  session.paused = false;
  input.flush();
}

/** 끝까지 봤든 스킵했든 여기로 모인다 — 본 것으로 기록하고 타이틀로. */
function leaveIntro(): void {
  if (intro === null) return;
  intro = null;
  introFrozen = false;
  markIntroSeen();
  session.phase = 'TITLE';
  uiClock = 0;
  input.flush();
}

/** 아무 키/탭 한 번으로 다음 칸을 열고, 마지막 칸 뒤에서만 타이틀로 나간다. */
function advanceIntroStory(): void {
  if (intro === null) return;
  advanceIntro(intro);
  if (intro.done) leaveIntro();
}

// ── 막간 (막 사이 2칸 만화) ────────────────────────────────────────────────
// 인트로와 같은 성질이다: SimState 를 만들지도 굴리지도 않고 자체 틱만 센다.
// 막 경계(스테이지 index 3·7·11)와 마지막 스테이지(14) 클리어 뒤에 한 번씩 끼어들고,
// 한 번 본 막간은 localStorage 기록으로 다시 나오지 않는다.
//
// **TIME_ATTACK 의 시계가 여기서 멈춘다**: 아래 onTick 의 INTERLUDE 분기는
// `tickSession` 을 부르지 않고, `tickSession` 자체도 PLAY 가 아니면 `elapsedTicks` 를
// 건드리지 않는다. 누적 시간은 `run.ticks + elapsedTicks` 뿐이므로 막간은 기록에 0틱이다.

let interlude: InterludeState | null = null;
/** 개발 모드에서 컷별 스크린샷을 찍기 위해 막간 타이머를 세운다(§21.2 자동화 QA). */
let interludeFrozen = false;

// ── 엔딩 ───────────────────────────────────────────────────────────────────
//
// 마지막 스테이지를 나오면(`ALLCLEAR`) 성적표보다 **엔딩이 먼저** 온다.
// 엔딩을 넘기면 그때 기존 클리어/런 결과 화면이 나온다 — 두 화면은 하는 말이
// 다르다: 엔딩은 무엇을 두고 왔는지를, 성적표는 얼마나 잘했는지를 말한다.
//
// 두 값 모두 **표시 전용**이다. 세션에 넣지 않는다 — 엔딩이 세션을 만지는 순간
// 결정론 검사(SPEC §4)가 지켜야 할 경계가 흐려진다.

/** 엔딩 화면이 열린 뒤 흐른 프레임. 금이 그어지는 연출과 인쇄체 도장에만 쓴다. */
let endingClock = 0;
/** 엔딩을 넘겼는가. 넘긴 뒤에는 같은 `ALLCLEAR` 에서 성적표를 그린다. */
let endingDismissed = false;

function resetEnding(): void {
  endingClock = 0;
  endingDismissed = false;
}

/** CLEAR 에서 다음 스테이지로. 막간을 볼 차례면 먼저 끼워 넣는다. */
function advanceStage(): void {
  // 이 호출이 마지막 스테이지를 넘기는 것이면 곧 ALLCLEAR 다. 연출 시계를 여기서 0 으로.
  resetEnding();
  nextStage(session);
  session.resetHold = 0;
  resetSfxEdges();
  input.flush();
}

function enterInterlude(id: number): void {
  interlude = createInterlude(id);
  interludeFrozen = false;
  session.phase = 'INTERLUDE';
  session.paused = false;
  input.flush();
}

/** 끝까지 봤든 스킵했든 여기로 모인다 — 본 것으로 기록하고 다음 스테이지로. */
function leaveInterlude(): void {
  if (interlude === null) return;
  markInterludeSeen(interlude.id);
  interlude = null;
  interludeFrozen = false;
  advanceStage();
}

/**
 * 인트로 중에는 **아무 키나** 다음 칸이다(`Esc` 포함). 게임 입력 매핑을 거치지 않고
 * 원시 keydown 을 직접 본다 — 매핑되지 않은 키로도 이야기를 넘길 수 있어야 한다.
 * 마지막 칸에서 `input.flush()`(leaveIntro 내부) 가 그 키의 메타 엣지를 지우므로,
 * 끝내는 데 쓴 Enter 가 곧바로 스테이지를 시작시키는 사고가 나지 않는다.
 */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (session.phase === 'INTRO') {
    advanceIntroStory();
    return;
  }
  // 막간도 같다 — 아무 키나 스킵. 여기서 페이즈를 옮기고 엣지를 비우므로
  // 스킵에 쓴 키가 곧바로 다음 스테이지의 조작으로 새지 않는다.
  if (session.phase === 'INTERLUDE') {
    leaveInterlude();
    return;
  }

  // 마이크 감도는 어느 화면에서나 조절된다. Minus/Equal 은 게임 입력에 쓰이지 않는다.
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') mic.adjustSensitivity(-1);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') mic.adjustSensitivity(1);

  if (session.phase !== 'TITLE') return;

  switch (e.code) {
    // 위아래로 줄(축)을 옮기고, 좌우로 그 줄의 항목을 고른다.
    // WASD 는 쓰지 않는다 — `S` 가 인트로 다시보기라 반쪽짜리가 되기 때문이다.
    case 'ArrowUp':
      titleRow = 0;
      break;
    case 'ArrowDown':
      titleRow = 1;
      break;
    case 'ArrowLeft':
      stepTitleSelection(-1);
      break;
    case 'ArrowRight':
      stepTitleSelection(1);
      break;
    case 'Digit1':
    case 'Numpad1':
      pickTitleIndex(0);
      break;
    case 'Digit2':
    case 'Numpad2':
      pickTitleIndex(1);
      break;
    case 'Digit3':
    case 'Numpad3':
      pickTitleIndex(2);
      break;
    // `S` 는 인트로 다시보기다 — 플레이 방식 `STORY` 와 이름이 겹치지 않게 분리했다.
    case 'KeyS':
      audio.resume();
      enterIntro();
      break;
    case 'Enter':
    case 'NumpadEnter':
      // getUserMedia 는 **사용자 제스처 안에서** 열어야 한다. 실제 스테이지 시작은
      // handleMeta 가 하지만 그건 rAF 콜백이라 제스처 컨텍스트가 아니다 —
      // 그래서 마이크만 여기서 먼저 연다. 이미 열려 있으면 no-op.
      if (session.mode === 'LISTEN') mic.start();
      break;
    default:
      break;
  }
});

if (!hasSeenIntro()) enterIntro();

// ── 메타키 처리 ────────────────────────────────────────────────────────────

/**
 * `Enter` 와 "다음으로" 탭이 같은 동작을 하도록 한 곳에 모았다.
 * 키보드와 손가락이 서로 다른 코드를 타면 반드시 한쪽이 뒤처진다.
 */
function startPressed(): void {
  audio.resume();
  switch (session.phase) {
    case 'TITLE':
      beginStage(0);
      break;
    case 'CLEAR': {
      // 막 경계면 다음 스테이지 **전에** 막간이 들어간다. 이미 본 막간은 건너뛴다.
      const id = interludeAfterStage(session.stageIndex);
      if (id !== null && !hasSeenInterlude(id)) enterInterlude(id);
      else advanceStage();
      break;
    }
    case 'ALLCLEAR':
      // 엔딩 → 성적표 → 타이틀. 엔딩을 읽는 동안 성적표가 겹쳐 나오지 않는다.
      if (!endingDismissed) endingDismissed = true;
      else backToTitle();
      break;
    default:
      break;
  }
}

function togglePause(): void {
  if (session.phase === 'PLAY' || session.phase === 'TRANSITION') {
    session.paused = !session.paused;
    session.resetHold = 0;
  }
}

function handleMeta(): void {
  if (input.consumePressed('MUTE')) {
    audio.resume();
    audio.toggleMute();
  }

  // ── 조작법 패널 ──
  // `H` / `?` 는 어느 페이즈에서나 통한다 — 막힌 순간에 열지 못하면 소용이 없다.
  if (input.consumePressed('HELP')) setHelpOpen(!isHelpOpen());

  if (isHelpOpen()) {
    // 열려 있는 동안 `ESC` 는 **닫기만** 한다. 여기서 togglePause 로 흘려보내면
    // 조작법을 닫았을 뿐인데 일시정지 화면이 나오거나 게임이 다시 굴러간다.
    if (input.consumePressed('PAUSE')) setHelpOpen(false);
    // 읽는 동안 눌린 게임 조작 엣지는 전부 버린다. 닫는 순간 한꺼번에 터지면
    // 안 읽은 것만 못하다(잔상이 확정되거나 덮어쓰기가 열린다).
    input.consumePressed('START');
    input.consumePressed('COMMIT');
    input.consumePressed('OVERWRITE');
    input.consumePressed('SLOT1');
    input.consumePressed('SLOT2');
    input.consumePressed('SLOT3');
    session.resetHold = 0;
    return;
  }

  if (input.consumePressed('START')) startPressed();

  if (input.consumePressed('PAUSE')) togglePause();

  if (session.phase !== 'PLAY' || session.paused) {
    // PLAY 밖에서 눌린 게임플레이 메타키는 버린다 — 나중에 뒤늦게 터지면 안 된다.
    input.consumePressed('COMMIT');
    input.consumePressed('OVERWRITE');
    input.consumePressed('SLOT1');
    input.consumePressed('SLOT2');
    input.consumePressed('SLOT3');
    session.resetHold = 0;
    return;
  }

  // ── 덮어쓰기 모드 ──
  if (input.consumePressed('OVERWRITE')) {
    learnPrompt('OVERWRITE'); // 눌러 봤다 = 배웠다. 남은 횟수가 0 이어도 마찬가지다.
    if (session.awaitingOverwritePick) {
      session.awaitingOverwritePick = false; // Q 를 다시 누르면 취소
    } else if (session.overwriteLeft > 0) {
      beginOverwriteMode(session);
      audio.interact();
    }
  }

  for (let slot = 1; slot <= 3; slot++) {
    const key = slot === 1 ? 'SLOT1' : slot === 2 ? 'SLOT2' : 'SLOT3';
    if (!input.consumePressed(key)) continue;
    if (!session.awaitingOverwritePick) continue;
    if (requestOverwrite(session, slot)) {
      audio.commit();
      resetSfxEdges();
    }
  }

  // ── 조기 확정 ──
  if (input.consumePressed('COMMIT')) {
    learnPrompt('COMMIT');
    if (!session.awaitingOverwritePick) {
      commitLoop(session, 'MANUAL');
      audio.commit();
      resetSfxEdges();
    }
  }

  // ── Backspace 2초 홀드 → 전체 초기화 (DEBT +1) ──
  // 세션은 InputMask 만 받으므로 홀드 카운터는 여기서 관리해 session.resetHold 에 쓴다.
  if (input.isHeld('RESET')) {
    session.resetHold++;
    if (session.resetHold >= RESET_HOLD_TICKS) {
      fullReset(session);
      session.resetHold = 0;
      audio.capture();
      resetSfxEdges();
    }
  } else if (session.resetHold !== 0) {
    session.resetHold = 0;
  }
}

// ── 터치: 메뉴·오버레이 탭 ─────────────────────────────────────────────────
//
// 조이스틱·액션 패드는 `touch.ts` 안에서 곧바로 마스크/메타 엣지가 되므로 여기 없다.
// 여기 오는 것은 **패드가 먹지 않은 탭**뿐이고, 전부 기존 키 경로와 같은 함수를 부른다.

/** 지금 어떤 패드 묶음이 살아 있어야 하는가. 세션 상태에서 매 틱 결정한다. */
function touchContext(): TouchContext {
  // 조작법이 떠 있는 동안 패드가 살아 있으면, 닫으려고 누른 손가락이 COMMIT 을
  // 눌러 버린다. 패드를 통째로 내려 탭이 전부 "닫기"로만 오게 한다.
  if (session.phase !== 'PLAY' || session.paused || isHelpOpen()) return 'NONE';
  return session.awaitingOverwritePick ? 'PICK' : 'PLAY';
}

function handleTitleTap(x: number, y: number): void {
  const id = hitTest(TITLE_HITS, x, y);
  if (id === null) return;
  audio.resume();
  switch (id) {
    case 'PLAY_MODE_0':
    case 'PLAY_MODE_1':
    case 'PLAY_MODE_2':
      titleRow = 0;
      pickTitleIndex(Number(id.slice(-1)));
      break;
    case 'DETECT_0':
      titleRow = 1;
      pickTitleIndex(0);
      break;
    case 'DETECT_1':
      titleRow = 1;
      pickTitleIndex(1);
      break;
    case 'INTRO':
      enterIntro();
      break;
    case 'MUTE':
      audio.toggleMute();
      break;
    case 'PLAY':
      // 마이크는 이미 pointerdown(제스처) 에서 열렸다 — 여기서는 스테이지만 시작한다.
      startPressed();
      break;
    default:
      break;
  }
}

function handlePauseTap(x: number, y: number): void {
  const id = hitTest(PAUSE_HITS, x, y);
  if (id === 'RESUME') togglePause();
  else if (id === 'HELP') setHelpOpen(true);
  else if (id === 'MUTE') {
    audio.resume();
    audio.toggleMute();
  }
}

function handleTaps(): void {
  const taps = touch.consumeTaps();
  for (const t of taps) {
    // 조작법이 열려 있으면 어디를 탭하든 닫기다 — 손가락에게는 `ESC` 가 없고,
    // 닫는 버튼을 따로 찾게 만들면 패널에 갇힌다.
    if (isHelpOpen()) {
      setHelpOpen(false);
      return; // 화면이 바뀌었다. 남은 탭이 그 아래 버튼을 누르면 안 된다.
    }
    switch (session.phase) {
      case 'INTRO':
        advanceIntroStory();
        return; // 페이즈가 바뀌었다. 남은 탭이 새 화면의 버튼을 누르면 안 된다.
      case 'INTERLUDE':
        // 손가락에게도 "아무 곳이나" 스킵이어야 한다 — 막간에는 버튼이 없다.
        leaveInterlude();
        return;
      case 'TITLE':
        handleTitleTap(t.x, t.y);
        break;
      case 'PLAY':
      case 'TRANSITION':
        if (session.paused) handlePauseTap(t.x, t.y);
        // 우상단 `?`. 패드가 먹지 않은 탭만 여기 오므로 조이스틱과 겹치지 않는다.
        else if (hitTest(HELP_HITS, t.x, t.y) === 'HELP') setHelpOpen(true);
        break;
      case 'CLEAR':
      case 'ALLCLEAR':
        // 성적표는 아무 곳이나 탭하면 넘어간다 — ENTER 와 같은 경로.
        startPressed();
        return;
      default:
        break;
    }
  }
}

// ── 틱 / 렌더 ──────────────────────────────────────────────────────────────

/**
 * LISTEN 모드의 마이크 펌프. 매 틱 1회.
 * @returns true 면 이번 틱은 시뮬을 진행하지 않는다(권한 대기 / 캘리브레이션).
 */
function pumpMic(): boolean {
  if (session.mode !== 'LISTEN') return false;
  mic.sample();
  const p = mic.phase();
  if (p === 'FAILED') {
    fallbackToEasy();
    return false;
  }
  // 환경음 측정 2초 동안 게임의 대표 소리(발소리·경보·고함)를 **스피커로 함께**
  // 내보낸다. 이어폰을 안 낀 사람의 바닥값에 게임 소리가 포함되므로, 실전에서
  // 게임이 자기 소리를 듣고 스스로를 발각시키는 되먹임이 줄어든다.
  if (p === 'CALIBRATING') audio.calibrationSample(mic.view().calibration);
  // 권한 대기와 환경음 측정 동안에는 세계를 얼린다. 바닥값을 잡기 전에 굴리면
  // 첫 2초가 그대로 레벨 3 으로 녹화돼 잔상이 영구히 간수를 부른다.
  return p === 'REQUEST' || p === 'CALIBRATING';
}

function onTick(): void {
  // 세로 모드에서는 세계를 얼린다. 안내 화면 뒤에서 간수가 걸어오면 안 된다.
  if (portraitBlocked) return;

  uiClock++;

  touch.setContext(touchContext());
  handleTaps();

  if (pumpMic()) return;
  if (micNoticeTimer > 0 && --micNoticeTimer === 0) micNotice = null;

  handleMeta();

  // 조작법을 읽는 동안 세계는 멈춘다. 일시정지와 같은 결이다 — 안내를 읽는 사이에
  // 간수가 걸어오면 그 안내는 함정이 된다. 이 `return` 이 곧 입력 차단이기도 하다:
  // `tickSession` 이 불리지 않으므로 `input.mask()` 가 시뮬에 닿는 경로가 없다.
  if (session.paused || isHelpOpen()) return;

  switch (session.phase) {
    case 'INTRO': {
      if (intro === null) {
        session.phase = 'TITLE';
        break;
      }
      if (!introFrozen) {
        tickIntro(intro);
        if (intro.done) leaveIntro();
      }
      break;
    }
    case 'INTERLUDE': {
      // tickSession 을 부르지 않는다 → elapsedTicks 가 멈춘다(TIME_ATTACK 무영향).
      if (interlude === null) {
        advanceStage();
        break;
      }
      if (!interludeFrozen) {
        tickInterlude(interlude);
        if (interlude.done) leaveInterlude();
      }
      break;
    }
    case 'PLAY': {
      // 스크립트 큐가 살아 있으면 이 틱은 큐에서 꺼낸 마스크로 굴린다.
      // 얼림 중에도 한 칸 꺼내 버린다 — 틱은 어차피 흘러가므로, 그래야 큐
      // 인덱스와 틱 번호가 계속 일치한다(재현성의 전제).
      let scripted: number | null = null;
      if (import.meta.env.DEV && devQueue !== null) {
        scripted = devQueue.shift() ?? 0;
        if (devQueue.length === 0) devQueue = null;
      }
      // 슬롯 선택 중에는 조작을 얼려 실수로 걸어 나가지 않게 한다(마이크도 함께 얼린다 —
      // 메뉴를 여는 사이의 숨소리가 테이프에 박히면 억울하다).
      const mask = session.awaitingOverwritePick
        ? 0
        : (scripted ?? input.mask()) | micBits();
      tickSession(session, mask);
      updateView(view, session.sim, session.lastEvents);
      playSfx(session.lastEvents);
      playSoundscape();
      break;
    }
    case 'TRANSITION': {
      tickSession(session, 0);
      updateView(view, session.sim, session.lastEvents);
      playSfx(session.lastEvents);
      playSoundscape();
      break;
    }
    case 'CLEAR':
      updateView(view, session.sim, IDLE_EVENTS);
      break;
    case 'ALLCLEAR':
      updateView(view, session.sim, IDLE_EVENTS);
      if (!endingDismissed) endingClock++;
      break;
    default:
      break;
  }
}

function onRender(): void {
  if (portraitBlocked) return;

  const m = micView();

  switch (session.phase) {
    case 'INTRO':
      if (intro !== null) drawIntro(g, intro, touchMode);
      break;
    case 'INTERLUDE':
      if (interlude !== null) drawInterlude(g, interlude, touchMode);
      break;
    case 'TITLE':
      drawTitle(g, uiClock, {
        mode: session.mode,
        playMode: session.playMode,
        focusRow: titleRow,
        notice: micNotice,
      });
      break;
    case 'PLAY':
      drawWorld(g, session.sim, view);
      drawHud(g, session, m);
      // 조작 UI 는 HUD 위, 일시정지 화면 아래. 터치 기기에서만 존재한다.
      if (touchMode) drawTouchControls(g, session, touch.view());
      drawTopLayer();
      break;
    case 'TRANSITION':
      drawWorld(g, session.sim, view);
      drawHud(g, session, m);
      drawTransition(g, session);
      drawTopLayer();
      break;
    case 'CLEAR':
      drawWorld(g, session.sim, view);
      drawClear(g, session);
      break;
    case 'ALLCLEAR':
      // 엔딩은 세계를 지우고 혼자 선다. 넘긴 뒤에야 성적표가 나온다.
      if (endingDismissed) {
        drawWorld(g, session.sim, view);
        drawClear(g, session);
      } else {
        drawEnding(g, session, endingClock);
      }
      break;
    default:
      break;
  }

  // 마이크 상태는 어떤 페이즈 위에도 얹힌다 — 권한 대기/캘리브레이션 중에는
  // 세계가 얼어 있으므로 이 오버레이가 유일한 피드백이다.
  if (m !== null && (m.phase === 'REQUEST' || m.phase === 'CALIBRATING')) {
    drawCalibration(g, m);
  } else if (micNotice !== null && session.phase !== 'TITLE') {
    drawMicNotice(g, micNotice);
  }

  // 조작법은 **무엇보다 위**다. 일시정지·전환·성적표·마이크 안내 위에 얹히므로
  // 어느 페이즈에서 열었든 가려지는 일이 없다.
  if (isHelpOpen()) drawHelp(g);
}

/**
 * 겹치는 패널 중 **하나만** 그린다 (`hud.topLayer`).
 *
 * 단서 패널은 `drawWorld` 안(월드 레이어)에서 이미 그려졌으므로 여기서 끄지 못한다.
 * 대신 일시정지가 불투명하게 덮어 그동안 보이지 않게 한다 — 조작법도 같은 규칙이고,
 * 조작법은 어느 페이즈에서나 열리므로 `onRender` 끝에서 다시 한 번 맨 위에 얹힌다.
 */
function drawTopLayer(): void {
  switch (topLayer({
    help: isHelpOpen(),
    paused: session.paused,
    note: openNoteId() !== null,
  })) {
    case 'HELP':
      drawHelp(g);
      break;
    case 'PAUSE':
      drawPause(g);
      break;
    default:
      // 'NOTE' / 'NONE' — 단서는 이미 월드 레이어에 그려졌다. 얹을 것이 없다.
      break;
  }
}

/** 폴백 사유 한 줄. 화면 하단 밴드 위에 조용히 얹는다. */
function drawMicNotice(ctx: CanvasRenderingContext2D, msg: string): void {
  ctx.save();
  ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(msg).width + 28;
  const x = (CANVAS_W - w) / 2;
  const y = CANVAS_H - 70;
  ctx.fillStyle = 'rgba(11,14,24,0.92)';
  ctx.fillRect(x, y, w, 24);
  ctx.strokeStyle = 'rgba(255,59,92,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 23);
  ctx.fillStyle = '#ff3b5c';
  ctx.fillText(msg, CANVAS_W / 2, y + 16);
  ctx.restore();
}

// 첫 제스처에서 AudioContext 를 깨운다(브라우저 자동재생 정책).
// 타이틀에서는 클릭만으로도 시작된다 — 메뉴 없이 즉시 플레이(SPEC §8).
cv.addEventListener('pointerdown', (e) => {
  audio.resume();

  if (e.pointerType === 'touch') {
    // 터치에서는 화면 아무 곳이나 눌러 시작하지 않는다 — 모드 칩을 고르는 탭과
    // 구분할 수 없기 때문이다. 인트로 스킵·메뉴 선택은 pointerup(탭)에서 처리한다:
    // pointerdown 에서 페이즈를 바꾸면 곧 이어질 **그 손가락의 탭**이 새 화면의
    // 버튼을 눌러 버린다.
    //
    // 다만 `getUserMedia` 는 제스처 안에서만 열 수 있으므로, PLAY 판을 누른
    // 순간만은 여기서 마이크를 먼저 연다. 스테이지 시작은 탭 처리가 한다.
    if (session.phase === 'TITLE' && session.mode === 'LISTEN') {
      const p = canvasPoint(cv, e.clientX, e.clientY);
      if (hitTest(TITLE_HITS, p.x, p.y) === 'PLAY') mic.start();
    }
    return;
  }

  if (session.phase === 'TITLE') {
    // 키보드 ENTER 경로와 같은 이유로, 마이크는 이 제스처 핸들러 안에서 연다.
    if (session.mode === 'LISTEN') mic.start();
    beginStage(0);
  }
});
window.addEventListener('keydown', () => audio.resume(), { once: true });

let stop: (() => void) | null = null;
stop = startLoop(
  () => {
    try {
      onTick();
    } catch (err) {
      crash(err);
    }
  },
  () => {
    try {
      onRender();
    } catch (err) {
      crash(err);
    }
  },
);

/** 루프 안에서 터진 예외는 삼키지 않고 화면에 드러낸다. 검은 화면보다 낫다. */
function crash(err: unknown): void {
  if (stop !== null) {
    stop();
    stop = null;
  }
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  console.error(err);
  if (fatal !== null) {
    fatal.textContent = `RUNTIME ERROR\n\n${msg}`;
    fatal.style.display = 'flex';
  }
}

// ── 개발 모드 전용 자동화 훅 (SPEC §21.2) ──────────────────────────────────
// 벽시계 타이밍으로 합성 키 이벤트를 뿌리면 60Hz 틱과 어긋나 재현이 안 된다.
// 그래서 "틱 = 배열 인덱스" 인 마스크 큐를 직접 먹인다.
//
// `import.meta.env.DEV` 는 빌드 시 리터럴 false 로 치환되므로 이 블록 전체가
// 프로덕션 번들에서 사라진다. 여기 밖으로 코드를 빼지 말 것.
if (import.meta.env.DEV) {
  /** MetaKey → KeyboardEvent.code. 실제 키 경로를 그대로 타기 위한 어댑터일 뿐이다. */
  const META_CODE: Readonly<Record<MetaKey, string>> = {
    COMMIT: 'KeyR',
    OVERWRITE: 'KeyQ',
    SLOT1: 'Digit1',
    SLOT2: 'Digit2',
    SLOT3: 'Digit3',
    RESET: 'Backspace',
    PAUSE: 'Escape',
    START: 'Enter',
    MUTE: 'KeyM',
    HELP: 'KeyH',
  };

  /**
   * 마스크는 테이프(Uint8Array)에 그대로 들어간다 — 하위 6비트로 못박는다.
   * 비트 6~7 은 마이크 전용이라 스크립트로 위조하지 않는다. 그 비트는 실제 마이크
   * 레벨이 `micBits()` 에서 OR 되며, 스크립트 큐와 마이크는 그대로 공존한다.
   */
  const clean = (m: number): number => (Number.isFinite(m) ? Math.trunc(m) & 63 : 0);

  const api = {
    /** 현재 Session. 페이즈 전환 때 객체가 교체되므로 매번 다시 읽어야 한다. */
    get session(): Session {
      return session;
    },

    get state() {
      const s = session;
      const me = s.sim.bodies.find((b) => b.isLive);
      const channels: string[] = [];
      for (const [name, on] of s.sim.channels) {
        if (on) channels.push(name);
      }
      return {
        phase: s.phase,
        mode: s.mode,
        playMode: s.playMode,
        run: runTotals(s),
        runResult: s.runResult,
        mic: { phase: mic.phase(), level: mic.level() },
        stageIndex: s.stageIndex,
        loopIndex: s.loopIndex,
        tick: s.sim.tick,
        ghosts: s.ghosts.length,
        outcome: s.sim.outcome,
        debt: s.debt,
        alerts: s.alerts,
        medal: s.medal,
        paused: s.paused,
        awaitingOverwritePick: s.awaitingOverwritePick,
        // I(조작 중인 몸)의 타일 좌표. AABB 중심 기준. 몸이 없으면 -1,-1.
        i:
          me === undefined
            ? { tx: -1, ty: -1 }
            : {
                tx: Math.floor((me.x + BODY_SUB / 2) / TILE_SUB),
                ty: Math.floor((me.y + BODY_SUB / 2) / TILE_SUB),
              },
        carryingLoot: me?.carryingLoot ?? false,
        channels,
        pending: devQueue?.length ?? 0,
      };
    },

    /** 틱 단위 입력 큐를 설정한다(기존 큐는 버린다). 빈 배열이면 실시간 입력 복귀. */
    queue(masks: number[]): void {
      devQueue = masks.length === 0 ? null : masks.map(clean);
    },

    /** 큐에 남은 틱 수. 0 이면 실시간 입력으로 돌아간 상태. */
    pending(): number {
      return devQueue?.length ?? 0;
    },

    /**
     * 메타키 1회 주입. 실제 keydown/keyup 을 쏴서 engine/input 의 엣지 큐를 거치므로
     * 처리 로직은 handleMeta 하나뿐이다(중복 구현 없음). 다음 틱에 소비된다.
     *
     * ponytail: 엣지 전용이라 홀드가 필요한 RESET(2초) 은 이걸로 발동하지 않는다.
     * 필요해지면 keyup 을 지연시키는 hold(key, ticks) 를 따로 붙일 것.
     */
    press(key: string): void {
      const code = (META_CODE as Record<string, string | undefined>)[key];
      if (code === undefined) {
        console.warn(`[__imm] unknown key "${key}" — ${Object.keys(META_CODE).join(' ')}`);
        return;
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true }));
    },

    /**
     * 인트로를 지정 틱에서 **얼린다**. 컷 하나를 정확히 같은 프레임으로 다시 찍을 수 있어야
     * 스크린샷 QA가 성립한다(rAF 는 왕복 지연 동안 계속 흘러가므로 seek 만으로는 부족하다).
     * `introPlay()` 로 다시 굴린다. 인트로 밖에서 부르면 인트로부터 연다.
     */
    introShow(tick: number): void {
      if (session.phase !== 'INTRO' || intro === null) enterIntro();
      if (intro === null) return;
      const n = Number.isFinite(tick) ? Math.trunc(tick) : 0;
      intro.tick = Math.max(0, Math.min(INTRO_TICKS - 1, n));
      intro.done = false;
      introFrozen = true;
    },

    /** introShow 로 얼린 인트로를 다시 재생한다. */
    introPlay(): void {
      introFrozen = false;
    },

    /**
     * 막간 `id`(0~3) 를 지정 틱에서 **얼려** 보여준다. 인트로와 같은 이유다 —
     * 같은 프레임을 다시 찍을 수 있어야 컷 스크린샷 QA 가 성립한다.
     * 얼림은 `interlude.done` 을 세우지 않는 것으로 충분하다(틱을 직접 세팅하므로).
     */
    interludeShow(id: number, tick: number): void {
      enterInterlude(Number.isFinite(id) ? Math.trunc(id) : 0);
      if (interlude === null) return;
      const n = Number.isFinite(tick) ? Math.trunc(tick) : 0;
      interlude.tick = Math.max(0, Math.min(INTERLUDE_TICKS - 1, n));
      interlude.done = false;
      interludeFrozen = true;
    },

    /** interludeShow 로 얼린 막간을 다시 굴린다. */
    interludePlay(): void {
      interludeFrozen = false;
    },

    /** n 틱 대기(마스크 0)를 큐 뒤에 붙인다. */
    idle(n: number): void {
      const count = Number.isFinite(n) ? Math.trunc(n) : 0;
      if (count <= 0) return;
      const q = devQueue ?? (devQueue = []);
      for (let i = 0; i < count; i++) q.push(0);
    },
  };

  Object.defineProperty(window, '__imm', { value: api, configurable: true });
  console.info('[__imm] dev automation hook ready — window.__imm');
}
