/**
 * 부트스트랩.
 *
 * 여기서만 브라우저를 만진다: 캔버스·키보드·오디오·rAF.
 * `sim/` 은 DOM 을 전혀 모르고(헤드리스 테스트 가능), `game/session.ts` 는
 * 틱 단위 순수 로직이며, 이 파일이 그 둘을 화면과 손가락에 연결한다.
 */
import { createAudio } from './engine/audio';
import { createInput, type MetaKey } from './engine/input';
import { startLoop } from './engine/loop';
import { createMic } from './engine/mic';
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
  drawHud,
  drawPause,
  drawTitle,
  drawTransition,
} from './render/hud';
import {
  createIntro,
  drawIntro,
  hasSeenIntro,
  INTRO_TICKS,
  markIntroSeen,
  tickIntro,
  type IntroState,
} from './render/intro';
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
  die('canvas#game 를 찾지 못했습니다. index.html 을 확인하세요.');
}
const cv = canvas as HTMLCanvasElement;
cv.width = CANVAS_W;
cv.height = CANVAS_H;

const ctx = cv.getContext('2d', { alpha: false });
if (ctx === null) {
  die('2D 컨텍스트를 얻지 못했습니다. 하드웨어 가속을 확인하세요.');
}
const g = ctx as CanvasRenderingContext2D;
g.imageSmoothingEnabled = false;

/**
 * 내부 해상도는 960×600 고정. 화면에는 **정수배**로만 키운다 —
 * 소수배 확대는 pixelated 렌더에서 픽셀 폭이 들쭉날쭉해진다.
 * 창이 960×600 보다 작을 때만 어쩔 수 없이 소수배로 축소한다.
 */
function fitCanvas(): void {
  const raw = Math.min(
    window.innerWidth / CANVAS_W,
    window.innerHeight / CANVAS_H,
  );
  const scale = raw >= 1 ? Math.floor(raw) : Math.max(0.2, raw);
  cv.style.width = `${Math.round(CANVAS_W * scale)}px`;
  cv.style.height = `${Math.round(CANVAS_H * scale)}px`;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// ── 런타임 ─────────────────────────────────────────────────────────────────

const input = createInput();
const audio = createAudio();
const mic = createMic();
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
  micNotice = `마이크 사용 불가 — ${mic.error() ?? '알 수 없는 오류'} EASY 모드로 계속합니다.`;
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
}

// ── 페이즈 전환 ────────────────────────────────────────────────────────────

/**
 * 타이틀 → 첫 스테이지. 여기가 **런의 시작점**이라 런 누적치와 DEBT 가 0 으로 돌아간다
 * (부채가 리셋되지 않는 범위는 런 하나다 — SPEC §3-2).
 */
function beginStage(index: number): void {
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
// 최초 1회만 자동 재생하고 그 뒤로는 타이틀에서 `S` 로만 다시 본다.

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

/**
 * 인트로 중에는 **아무 키나** 스킵이다(`Esc` 포함). 게임 입력 매핑을 거치지 않고
 * 원시 keydown 을 직접 본다 — 매핑되지 않은 키로도 빠져나올 수 있어야 하기 때문이다.
 * 여기서 `input.flush()`(leaveIntro 내부) 가 그 키의 메타 엣지를 지우므로,
 * 스킵에 쓴 Enter 가 곧바로 스테이지를 시작시키는 사고가 나지 않는다.
 */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (session.phase === 'INTRO') {
    leaveIntro();
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

function handleMeta(): void {
  if (input.consumePressed('MUTE')) {
    audio.resume();
    audio.toggleMute();
  }

  if (input.consumePressed('START')) {
    audio.resume();
    switch (session.phase) {
      case 'TITLE':
        beginStage(0);
        break;
      case 'CLEAR':
        nextStage(session);
        session.resetHold = 0;
        resetSfxEdges();
        input.flush();
        break;
      case 'ALLCLEAR':
        backToTitle();
        break;
      default:
        break;
    }
  }

  if (input.consumePressed('PAUSE')) {
    if (session.phase === 'PLAY' || session.phase === 'TRANSITION') {
      session.paused = !session.paused;
      session.resetHold = 0;
    }
  }

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
  if (input.consumePressed('COMMIT') && !session.awaitingOverwritePick) {
    commitLoop(session, 'MANUAL');
    audio.commit();
    resetSfxEdges();
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
  // 권한 대기와 환경음 측정 동안에는 세계를 얼린다. 바닥값을 잡기 전에 굴리면
  // 첫 2초가 그대로 레벨 3 으로 녹화돼 잔상이 영구히 간수를 부른다.
  return p === 'REQUEST' || p === 'CALIBRATING';
}

function onTick(): void {
  uiClock++;

  if (pumpMic()) return;
  if (micNoticeTimer > 0 && --micNoticeTimer === 0) micNotice = null;

  handleMeta();

  if (session.paused) return;

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
      break;
    }
    case 'TRANSITION': {
      tickSession(session, 0);
      updateView(view, session.sim, session.lastEvents);
      playSfx(session.lastEvents);
      break;
    }
    case 'CLEAR':
    case 'ALLCLEAR':
      updateView(view, session.sim, IDLE_EVENTS);
      break;
    default:
      break;
  }
}

function onRender(): void {
  const m = micView();

  switch (session.phase) {
    case 'INTRO':
      if (intro !== null) drawIntro(g, intro);
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
      if (session.paused) drawPause(g);
      break;
    case 'TRANSITION':
      drawWorld(g, session.sim, view);
      drawHud(g, session, m);
      drawTransition(g, session);
      if (session.paused) drawPause(g);
      break;
    case 'CLEAR':
    case 'ALLCLEAR':
      drawWorld(g, session.sim, view);
      drawClear(g, session);
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
cv.addEventListener('pointerdown', () => {
  audio.resume();
  if (session.phase === 'INTRO') {
    leaveIntro();
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
