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
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  MAX_TICKS,
  RESET_HOLD_TICKS,
  SLOT_NAMES,
  TICK_HZ,
} from '../sim/constants';
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
import {
  A_SLOT,
  C_BG,
  C_CORPSE,
  C_DANGER,
  C_I_CORE,
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

export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  mic: MicView | null = null,
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

  // ── 오버레이 ──
  if (s.awaitingOverwritePick) drawOverwritePicker(ctx, s);
  if (s.resetHold > 0) drawResetHold(ctx, s);
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
 */
export function drawCalibration(ctx: CanvasRenderingContext2D, mic: MicView): void {
  // 아래 화면(타이틀 로고 / 월드)이 비치면 글자가 겹쳐 읽히지 않는다. 완전히 덮는다.
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const waiting = mic.phase === 'REQUEST';

  const panelW = 560;
  const panelH = 200;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;
  plate(ctx, px, py, panelW, panelH);
  // 시설 안내판의 머리띠. 권한 대기 중이면 경고 사선(사용자 행동이 필요하다).
  if (waiting) hazard(ctx, px + 2, py + 2, panelW - 4, 6);
  frame(ctx, px, py, panelW, panelH, waiting ? C_LOOT : C_EDGE, 0.55, 2);
  rivets(ctx, px, py, panelW, panelH);

  stencil(ctx, 'LISTEN MODE', CANVAS_W / 2, py + 30, 10, C_STENCIL_DIM, 'center');
  stencilBig(
    ctx,
    waiting ? '마이크 권한을 허용해 주세요' : '조용히 해주세요 — 환경음 측정 중',
    CANVAS_W / 2,
    py + 66,
    22,
    waiting ? C_LOOT : C_STENCIL,
    C_PLATE,
  );

  // 산업용 계기: 파인 홈 + 눈금 + 채움.
  const w = panelW - 100;
  const h = 12;
  const x = (CANVAS_W - w) / 2;
  const y = py + 90;
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
    y + 34,
    11,
    C_TEXT,
    'center',
  );
  text(
    ctx,
    waiting
      ? '거부하거나 응답하지 않아도 EASY 모드로 계속 진행됩니다.'
      : '임계값은 이 바닥값 대비 상대치입니다 — 시끄러운 현장에서도 플레이할 수 있게.',
    CANVAS_W / 2,
    y + 52,
    10,
    C_TEXT_DIM,
    'center',
  );
  text(
    ctx,
    '오디오는 저장하지도 전송하지도 않습니다. 테이프에 남는 것은 틱당 2비트의 음량 레벨뿐입니다.',
    CANVAS_W / 2,
    y + 74,
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

/**
 * 타이틀의 세로 리듬. 각 줄은 칩(28) → 칩별 캡션(+12) → 설명 한 줄(+30) 을 쓴다.
 * 그 아래 조작 안내(432) · PLAY(444) · 인트로(496) · 키 목록(524~) 순으로 내려간다.
 */
const ROW1_Y = 288;
const ROW2_Y = 356;
const CHIP_H = 28;

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
    '↑ ↓ 줄 이동    ← → 선택    ENTER 시작',
    CANVAS_W / 2,
    432,
    9,
    withAlpha(C_STENCIL_DIM, 0.9),
    'center',
  );

  // [ PLAY ] — 맥동하는 CTA. 메뉴는 없다(SPEC §8).
  // 발광 버튼이 아니라 **경고 사선을 두른 산업용 누름판**이다.
  const pulse = 0.65 + Math.sin(t * 0.06) * 0.35;
  const btnW = 220;
  const btnH = 36;
  const bx = (CANVAS_W - btnW) / 2;
  const by = 444;
  plate(ctx, bx, by, btnW, btnH);
  hazard(ctx, bx + 1, by + 1, btnW - 2, 4, 0.5 + pulse * 0.5);
  hazard(ctx, bx + 1, by + btnH - 5, btnW - 2, 4, 0.5 + pulse * 0.5);
  frame(ctx, bx, by, btnW, btnH, C_EDGE, 0.3 + pulse * 0.4, 2);
  rivets(ctx, bx, by, btnW, btnH);
  stencil(ctx, '[ PLAY ] — ENTER', CANVAS_W / 2, by + 24, 15, C_STENCIL, 'center');

  // 인트로 재시청. main.ts 가 `S` keydown 을 받아 인트로로 되돌린다.
  // 플레이 방식 `STORY` 와 헷갈리지 않게 이름을 분리했다.
  stencil(ctx, 'S ▸ 인트로 다시보기', CANVAS_W / 2, 496, 11, C_STENCIL_DIM, 'center');

  // 마이크 폴백 같은 사건은 조용히 삼키지 않고 여기 한 줄로 남긴다.
  if (notice !== null) {
    stencil(ctx, notice, CANVAS_W / 2, 510, 10, C_DANGER, 'center');
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
  const chipW = 176;
  const gap = 12;
  const list: PlayMode[] = ['STORY', 'GAUNTLET', 'TIME_ATTACK'];
  const total = chipW * list.length + gap * (list.length - 1);
  const startX = (CANVAS_W - total) / 2;

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
  const chipW = 200;
  const gap = 16;
  const list: Mode[] = ['EASY', 'LISTEN'];
  const total = chipW * list.length + gap;
  const startX = (CANVAS_W - total) / 2;

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
  stencil(ctx, 'ESC ▸ RESUME', CANVAS_W / 2, 176, 11, C_STENCIL_DIM, 'center', 'normal');

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
