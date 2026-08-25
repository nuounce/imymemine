/**
 * I.MY.ME.MINE — 7칸 인트로 **만화**.
 *
 * 전면 슬라이드쇼가 아니라 **만화 페이지**다. 페이지 위에 칸이 하나씩 잉크가 번지듯
 * 그려지고, 페이지가 다 차면 다음 입력에서 가로로 넘어간다. 칸마다 샷 사이즈가 다르고
 * (와이드/미디엄/익스트림 클로즈업), 명암은 하프톤 스크린톤으로 만든다 — 만화의 질감은
 * 거기서 나온다.
 *
 * 스토리의 회수: 칸 2 의 "넷씩 묶인 금"이 칸 7 에서 네 사람 뒤로 다시 떠오른다.
 * 두 칸은 **같은 시드**로 같은 획을 그린다(TALLY_SEED) — 그래야 회수로 읽힌다.
 *
 * 제약(SPEC §0/§7):
 * - 외부 이미지·폰트 에셋 0개. 전부 Canvas 2D.
 * - `sim/` 과 완전히 분리된 순수 렌더 + 자체 틱 카운터. SimState 를 만들지도 읽지도 않는다.
 * - 인물은 얼굴 없는 실루엣. 감정은 이목구비가 아니라 자세·빛·구도로만 만든다(`figure.ts`).
 */

import {
  C_DANGER,
  C_I_CORE,
  C_I_RING,
  C_SLOT,
  C_TEXT_DIM,
  font,
  withAlpha,
} from './palette';
import { drawFigure, figureAnchor, inkStroke, POSES, type Pose } from './figure';
import { CANVAS_H, CANVAS_W } from '../sim/constants';

// ── 타이밍 ─────────────────────────────────────────────────────────────────

/** 칸당 최대 2.2초의 연출. 연출이 끝나면 입력이 올 때까지 그 칸에 머문다. */
export const CUT_TICKS = 132;
export const CUT_COUNT = 7;
export const INTRO_TICKS = CUT_TICKS * CUT_COUNT;

/** 칸 하나가 잉크로 다 차는 데 걸리는 틱. */
const REVEAL_TICKS = 34;
/** 페이지 넘김 가로 와이프. */
const PAGE_TICKS = 26;

export interface IntroState {
  /** 인트로 자체 타이머. 시뮬 틱과 무관하다. */
  tick: number;
  /** 끝까지 재생됐는가. */
  done: boolean;
}

export function createIntro(): IntroState {
  return { tick: 0, done: false };
}

/**
 * 현재 칸의 연출만 1틱 진행한다. 칸이 다 그려지면 자동으로 다음 칸에 가지 않는다 —
 * 이야기를 읽는 속도는 플레이어가 정하고, `advanceIntro` 가 다음 칸을 연다.
 */
export function tickIntro(s: IntroState): void {
  if (s.done) return;
  const cut = Math.min(CUT_COUNT - 1, Math.floor(s.tick / CUT_TICKS));
  const holdAt = Math.min(INTRO_TICKS - 1, (cut + 1) * CUT_TICKS - 1);
  if (s.tick < holdAt) s.tick++;
}

/** 아무 키/탭 한 번 = 다음 칸. 마지막 칸에서는 인트로를 끝낸다. */
export function advanceIntro(s: IntroState): void {
  if (s.done) return;
  const cut = Math.min(CUT_COUNT - 1, Math.floor(s.tick / CUT_TICKS));
  if (cut === CUT_COUNT - 1) {
    s.done = true;
    return;
  }
  s.tick = (cut + 1) * CUT_TICKS;
}

// ── 최초 1회 재생 플래그 ───────────────────────────────────────────────────
// 사파리 프라이빗 모드·쿠키 차단 환경에서 localStorage 접근은 **예외를 던진다**.
// 인트로 하나 때문에 게임이 죽으면 안 되므로 전부 삼키고, 실패 시 "본 적 없음"으로 친다.

const SEEN_KEY = 'imm.intro.seen';

export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 저장이 막힌 환경이면 매번 인트로가 나온다. 스킵이 있으니 치명적이지 않다.
  }
}

// ── 잉크 / 종이 ────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

/** 페이지(거터 포함) 바탕. 밤 장면 만화라 종이 자체가 검다. */
const C_PAPER = '#080a11';
/** 흰 잉크 — 칸 테두리·효과선. */
const C_INK = '#e6ecff';
/** 캡션 박스 바탕(흰 종이 조각). */
const C_BOX = '#eef2ff';
/** 캡션 박스 글자. */
const C_BOX_TX = '#080a11';
/** 인물 실루엣. 밝은 바닥보다 확실히 어두워야 실루엣으로 읽힌다. */
const C_FIG = '#04060d';
/** 차가운 형광등. */
const C_LAMP = '#cfe0ff';
/** 콘크리트 벽. */
const C_WALL2 = '#171d33';

/** 칸 2 와 칸 7 이 공유하는 획 시드. 같은 금이어야 회수가 성립한다. */
const TALLY_SEED = 4177;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 칸 배치.
 * 페이지1 = 0(가로로 넓게 위) / 1·2(아래 나란히)
 * 페이지2 = 3·4(위 나란히) / 5(가로로 넓게 아래)
 * 페이지3 = 6(전면)
 */
const PANELS: readonly Rect[] = [
  { x: 34, y: 30, w: 892, h: 238 },
  { x: 34, y: 282, w: 442, h: 288 },
  { x: 490, y: 282, w: 436, h: 288 },
  { x: 34, y: 30, w: 442, h: 290 },
  { x: 490, y: 30, w: 436, h: 290 },
  { x: 34, y: 334, w: 892, h: 236 },
  { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H },
];

const PAGE_FIRST = [0, 3, 6] as const;
const PAGE_LAST = [2, 5, 6] as const;
/** 칸 index → 페이지 index. */
const PAGE_OF = [0, 0, 0, 1, 1, 1, 2] as const;

// ── 결정론적 지터 ──────────────────────────────────────────────────────────

function hash01(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(i | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function jit(seed: number, i: number, amp: number): number {
  return (hash01(seed, i) - 0.5) * 2 * amp;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** ease-in-out. */
function smooth(v: number): number {
  const k = clamp01(v);
  return k * k * (3 - 2 * k);
}

// ── 스크린톤 (하프톤) ──────────────────────────────────────────────────────
// 점 타일을 패턴으로 캐시해 두고 회전해서 깐다. 매 프레임 수천 개의 arc 를 직접
// 그리면 60fps 가 무너진다.

const tonePatterns = new Map<string, CanvasPattern | null>();

function tonePattern(
  g: CanvasRenderingContext2D,
  color: string,
  pitch: number,
  radius: number,
): CanvasPattern | null {
  const key = `${color}|${pitch}|${radius.toFixed(2)}`;
  const hit = tonePatterns.get(key);
  if (hit !== undefined) return hit;

  let pat: CanvasPattern | null = null;
  if (typeof document !== 'undefined') {
    const tile = document.createElement('canvas');
    tile.width = pitch;
    tile.height = pitch;
    const tg = tile.getContext('2d');
    if (tg !== null) {
      tg.fillStyle = color;
      tg.beginPath();
      tg.arc(pitch / 2, pitch / 2, radius, 0, TAU);
      tg.fill();
      pat = g.createPattern(tile, 'repeat');
    }
  }
  tonePatterns.set(key, pat);
  return pat;
}

/** 사각 영역에 하프톤 점을 깐다. `density` 0..1 이 점 크기를 정한다. */
function screentone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  density: number,
  color: string,
  alpha: number,
  angle = -0.42,
  pitch = 6,
): void {
  if (density <= 0.015 || alpha <= 0.01) return;
  const r = Math.max(0.35, pitch * 0.5 * Math.sqrt(Math.min(1, density)) * 0.94);
  const pat = tonePattern(g, color, pitch, r);
  if (pat === null) return;

  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(angle);
  const d = Math.hypot(w, h);
  g.fillStyle = pat;
  g.fillRect(-d / 2, -d / 2, d, d);
  g.restore();
}

/** 위/아래로 농도가 줄어드는 톤. 만화의 "깊이"는 이 단계 톤이 만든다. */
function toneGradient(
  g: CanvasRenderingContext2D,
  r: Rect,
  bands: number,
  top: number,
  bottom: number,
  color: string,
  alpha: number,
): void {
  const bh = r.h / bands;
  for (let i = 0; i < bands; i++) {
    const k = bands === 1 ? 0 : i / (bands - 1);
    screentone(g, r.x, r.y + bh * i, r.w, bh + 1, top + (bottom - top) * k, color, alpha);
  }
}

// ── 만화 부품 ──────────────────────────────────────────────────────────────

/** 손으로 그은 칸 테두리. */
function panelBorder(g: CanvasRenderingContext2D, r: Rect, seed: number, alpha: number): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = C_INK;
  inkStroke(
    g,
    [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
      [r.x, r.y],
    ],
    3.4,
    seed,
  );
  g.restore();
}

/**
 * 칸이 잉크로 번지듯 드러난다.
 *
 * 아직 안 드러난 부분을 종이색으로 덮는다. 경계는 칸의 대각선을 따라 흐르고 톱니처럼
 * 흔들린다 — 좌표계를 45° 돌려 놓으면 그 사선이 그냥 세로선이 된다.
 * 톱니 지터는 위치 인덱스에만 걸려 있어 진행 중에도 가장자리가 지직거리지 않는다.
 */
function inkWipe(g: CanvasRenderingContext2D, r: Rect, p: number, seed: number): void {
  if (p >= 1) return;
  const q = ((r.w + r.h) * p) / Math.SQRT2;
  const L = (r.w + r.h) * 1.1;

  g.save();
  g.translate(r.x, r.y);
  g.rotate(Math.PI / 4);

  // 젖은 잉크 가장자리 — 경계 바로 앞이 살짝 짙다.
  g.fillStyle = withAlpha(C_INK, 0.09);
  g.fillRect(q - 9, -L, 9, L * 2);

  g.fillStyle = C_PAPER;
  g.beginPath();
  const N = 30;
  g.moveTo(q + jit(seed, 0, 8), -L);
  for (let i = 1; i <= N; i++) {
    g.lineTo(q + jit(seed, i, 8), -L + (2 * L * i) / N);
  }
  g.lineTo(L * 2, L);
  g.lineTo(L * 2, -L);
  g.closePath();
  g.fill();
  g.restore();
}

/** 칸 모서리에 살짝 기울어 얹힌 캡션 박스. 손글씨 느낌의 테두리. */
function captionBox(
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  t: number,
  seed: number,
  baseSize = 14,
): void {
  const a = clamp01((t - 14) / 20);
  if (a <= 0) return;

  let size = baseSize;
  g.save();
  g.font = font(size, 'bold');
  let tw = g.measureText(text).width;
  // 긴 캡션이 칸 밖으로 새면 만화가 아니라 자막이 된다. 칸 안에 들어올 때까지 줄인다.
  while (tw + 26 > r.w - 20 && size > 9) {
    size -= 1;
    g.font = font(size, 'bold');
    tw = g.measureText(text).width;
  }
  const bw = tw + 26;
  const bh = size + 16;
  const m = 14;
  const bx = corner === 'tl' || corner === 'bl' ? r.x + m : r.x + r.w - m - bw;
  const by = corner === 'tl' || corner === 'tr' ? r.y + m : r.y + r.h - m - bh;
  const tilt = jit(seed, 3, 0.024);

  g.globalAlpha = a;
  g.translate(bx + bw / 2, by + bh / 2 + (1 - a) * 6);
  g.rotate(tilt);
  g.fillStyle = C_BOX;
  g.fillRect(-bw / 2, -bh / 2, bw, bh);
  g.strokeStyle = C_BOX_TX;
  inkStroke(
    g,
    [
      [-bw / 2, -bh / 2],
      [bw / 2, -bh / 2],
      [bw / 2, bh / 2],
      [-bw / 2, bh / 2],
      [-bw / 2, -bh / 2],
    ],
    2,
    seed + 11,
  );
  g.fillStyle = C_BOX_TX;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 1);
  g.restore();
}

/** 내레이션. 캡션과 반대 모서리에, 어두운 종이 조각 위 흰 글씨로. */
function narration(
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  t: number,
  seed: number,
): void {
  const a = clamp01((t - 34) / 22);
  if (a <= 0) return;

  let size = 12;
  g.save();
  g.font = font(size);
  let tw = g.measureText(text).width;
  while (tw + 22 > r.w - 20 && size > 8) {
    size -= 1;
    g.font = font(size);
    tw = g.measureText(text).width;
  }
  const bw = tw + 22;
  const bh = size + 14;
  const m = 13;
  const bx = corner === 'tl' || corner === 'bl' ? r.x + m : r.x + r.w - m - bw;
  const by = corner === 'tl' || corner === 'tr' ? r.y + m : r.y + r.h - m - bh;

  g.globalAlpha = a;
  g.translate(bx + bw / 2, by + bh / 2 + (1 - a) * 5);
  g.rotate(jit(seed, 7, 0.02));
  g.fillStyle = 'rgba(6,8,15,0.9)';
  g.fillRect(-bw / 2, -bh / 2, bw, bh);
  g.strokeStyle = withAlpha(C_INK, 0.55);
  inkStroke(
    g,
    [
      [-bw / 2, bh / 2],
      [bw / 2, bh / 2],
    ],
    1.4,
    seed + 21,
  );
  g.fillStyle = C_INK;
  g.globalAlpha = a * 0.92;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 1);
  g.restore();
}

/** 집중선. 한 점으로 모이는 쐐기들 — 발현 칸의 충격은 전적으로 이게 만든다. */
function focusLines(
  g: CanvasRenderingContext2D,
  r: Rect,
  fx: number,
  fy: number,
  count: number,
  inner: number,
  color: string,
  alpha: number,
  seed: number,
): void {
  if (alpha <= 0.01) return;
  const far = Math.hypot(r.w, r.h) * 1.3;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + jit(seed, i, 0.06);
    const wdt = 0.005 + hash01(seed, i + 90) * 0.03;
    const rin = inner * (0.75 + hash01(seed, i + 180) * 0.8);
    g.beginPath();
    g.moveTo(fx + Math.cos(a) * rin, fy + Math.sin(a) * rin);
    g.lineTo(fx + Math.cos(a - wdt) * far, fy + Math.sin(a - wdt) * far);
    g.lineTo(fx + Math.cos(a + wdt) * far, fy + Math.sin(a + wdt) * far);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** 속도선. 가로로 흐르는 잔선 — "이미 저만치 갔다"를 한 프레임에 말한다. */
function speedLines(
  g: CanvasRenderingContext2D,
  r: Rect,
  count: number,
  color: string,
  alpha: number,
  seed: number,
): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const y = r.y + 12 + hash01(seed, i) * (r.h - 24);
    const len = r.w * (0.16 + hash01(seed, i + 50) * 0.42);
    const x0 = r.x + hash01(seed, i + 100) * (r.w - len);
    g.lineWidth = 0.5 + hash01(seed, i + 150) * 1.5;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + len, y);
    g.stroke();
  }
  g.restore();
}

// ── 무대 부품 ──────────────────────────────────────────────────────────────

/** 바닥선 + 그 위에 고인 빛. 인물이 공중에 뜨지 않게 하는 최소 장치. */
function floorLight(
  g: CanvasRenderingContext2D,
  r: Rect,
  fy: number,
  cx: number,
  spread: number,
  power: number,
): void {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();

  const fg = g.createLinearGradient(0, fy, 0, r.y + r.h);
  fg.addColorStop(0, '#161c30');
  fg.addColorStop(1, '#070910');
  g.fillStyle = fg;
  g.fillRect(r.x, fy, r.w, r.y + r.h - fy);

  g.translate(cx, fy + 4);
  g.scale(1, 0.26);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, spread);
  pool.addColorStop(0, withAlpha(C_LAMP, 0.42 * power));
  pool.addColorStop(0.55, withAlpha(C_LAMP, 0.15 * power));
  pool.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = pool;
  g.beginPath();
  g.arc(0, 0, spread, 0, TAU);
  g.fill();
  g.restore();

  g.save();
  g.globalAlpha = 0.55;
  g.strokeStyle = withAlpha(C_INK, 0.35);
  inkStroke(
    g,
    [
      [r.x, fy],
      [r.x + r.w, fy],
    ],
    1.6,
    811,
  );
  g.restore();
}

/**
 * 인물 뒤에 까는 밝은 판.
 *
 * 만화의 검은 실루엣은 **밝은 배경 위에서만** 실루엣이다. 어두운 방 안에서 검은 인물을
 * 그리면 그냥 얼룩이 되므로, 인물이 설 자리에 빛 한 판을 미리 깔아 몸을 도려낸다.
 */
function backLight(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  alpha: number,
  color = C_LAMP,
): void {
  g.save();
  g.translate(x, y - h * 0.46);
  g.scale(1, 1.25);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.52);
  gr.addColorStop(0, withAlpha(color, alpha));
  gr.addColorStop(0.55, withAlpha(color, alpha * 0.42));
  gr.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, h * 0.52, 0, TAU);
  g.fill();
  g.restore();
}

/** 형광등 튜브 + 아래로 떨어지는 빛 원뿔. */
function lamp(
  g: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  halfW: number,
  reach: number,
  spread: number,
  power: number,
): void {
  if (power <= 0.01) return;
  g.save();
  g.globalAlpha = Math.min(1, power);
  g.fillStyle = C_LAMP;
  g.fillRect(lx - halfW, ly - 3, halfW * 2, 6);
  const glow = g.createRadialGradient(lx, ly, 0, lx, ly, halfW * 2.2);
  glow.addColorStop(0, withAlpha(C_LAMP, 0.45));
  glow.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = glow;
  g.fillRect(lx - halfW * 2.2, ly - halfW * 2.2, halfW * 4.4, halfW * 4.4);
  g.restore();

  const cone = g.createLinearGradient(0, ly, 0, ly + reach);
  cone.addColorStop(0, withAlpha(C_LAMP, 0.2 * power));
  cone.addColorStop(0.55, withAlpha(C_LAMP, 0.07 * power));
  cone.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = cone;
  g.beginPath();
  g.moveTo(lx - halfW, ly);
  g.lineTo(lx + halfW, ly);
  g.lineTo(lx + spread, ly + reach);
  g.lineTo(lx - spread, ly + reach);
  g.closePath();
  g.fill();
}

/** 깜빡이며 켜지는 형광등. 칸 1 의 "깨어남"은 전적으로 이 스케줄이 만든다. */
function flickerOn(t: number): number {
  if (t < 6) return 0.02;
  if (t < 11) return 0.95;
  if (t < 19) return 0.06;
  if (t < 24) return 0.8;
  if (t < 32) return 0.04;
  const settle = Math.min(1, (t - 32) / 24);
  return 0.66 * settle + Math.sin(t * 0.31) * 0.04;
}

function breathe(t: number, base: number): number {
  return base + Math.sin(t * 0.09) * 0.04 + Math.sin(t * 0.43) * 0.015;
}

/**
 * 손잡이 없는 문. 가운데 이음매로 빛이 새고, **손잡이가 있어야 할 자리는 비어 있다.**
 * 그 빈자리를 읽게 하려고 경첩 쪽에만 볼트를 박아 대비를 만든다.
 */
function drawDoor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
): void {
  g.fillStyle = '#0b0e1b';
  g.fillRect(x - 9, y - 9, w + 18, h + 9);
  g.fillStyle = '#1a2138';
  g.fillRect(x, y, w, h);

  g.save();
  g.strokeStyle = withAlpha(C_INK, 0.75);
  inkStroke(
    g,
    [
      [x - 6, y + h],
      [x - 6, y - 6],
      [x + w + 6, y - 6],
      [x + w + 6, y + h],
    ],
    2.4,
    seed,
  );
  // 중앙 이음매 = 닫혀 있다.
  g.strokeStyle = withAlpha(C_INK, 0.5);
  inkStroke(
    g,
    [
      [x + w / 2, y + 6],
      [x + w / 2, y + h - 2],
    ],
    1.8,
    seed + 3,
  );
  g.restore();

  // 문틈으로 새는 빛 — 저 너머에 무언가 있다는 유일한 단서.
  const seam = g.createLinearGradient(x + w / 2 - 5, 0, x + w / 2 + 5, 0);
  seam.addColorStop(0, withAlpha(C_LAMP, 0));
  seam.addColorStop(0.5, withAlpha(C_LAMP, 0.2));
  seam.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = seam;
  g.fillRect(x + w / 2 - 5, y + 6, 10, h - 10);

  // 경첩 볼트(왼쪽만). 반대쪽 손잡이 자리의 공백이 여기 대비로 읽힌다.
  g.save();
  g.fillStyle = withAlpha(C_INK, 0.4);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(x + 9, y + h * (0.18 + i * 0.31), 2.6, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** 바닥 발판. */
function drawPlate(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  glow: number,
  on: boolean,
): void {
  const col = on ? '#7dffb0' : C_SLOT[1]!;
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.34);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, half * 1.8);
  gr.addColorStop(0, withAlpha(col, Math.min(1, glow + (on ? 0.4 : 0))));
  gr.addColorStop(1, withAlpha(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, half * 1.8, 0, TAU);
  g.fill();
  g.restore();

  g.save();
  g.strokeStyle = on ? '#7dffb0' : '#7d8ab8';
  inkStroke(
    g,
    [
      [cx - half, cy],
      [cx, cy - half * 0.33],
      [cx + half, cy],
      [cx, cy + half * 0.33],
      [cx - half, cy],
    ],
    2.4,
    577,
  );
  g.restore();
}

/**
 * 금 **한 획**. 손톱으로 벽을 그은 짧은 자국 하나.
 *
 * 칸 2 의 무더기(`drawTally`)와 칸 7 의 회수가 **이 함수 하나**를 공유한다. 같은
 * `seed`·`k` 를 주면 기울기·길이 비율·거친 선질이 그대로 재현되므로, 두 칸에 찍힌 자국이
 * 눈으로 **같은 물건**이 된다. 비슷하게 생긴 다른 코드로 그리면 그 순간 회수가 깨진다.
 */
function tallyMark(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  markH: number,
  width: number,
  seed: number,
  k: number,
): void {
  // 기울기를 크게 주면 획끼리 교차해 "넷씩 묶은" 그룹이 안 읽힌다.
  const lean = jit(seed, k, 0.06);
  const h = markH * (0.87 + hash01(seed, k + 60) * 0.26);
  const top = y + jit(seed, k + 120, markH * 0.06);
  inkStroke(
    g,
    [
      [x, top],
      [x + lean * h, top + h],
    ],
    width * (0.8 + hash01(seed, k + 180) * 0.55),
    seed * 31 + k,
  );
}

/**
 * 벽의 금. **넷씩 묶인** 손톱 자국.
 *
 * 칸 2 와 칸 7 이 같은 `seed` 로 부른다 — 획의 기울기·길이가 그대로 재현돼야
 * "벽의 금이 곧 네 개의 나였다"가 회수로 읽힌다.
 */
function drawTally(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  markH: number,
  gap: number,
  groupGap: number,
  groups: number,
  color: string,
  width: number,
  alpha: number,
  seed: number,
): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  let cx = x;
  let k = 0;
  for (let gi = 0; gi < groups; gi++) {
    for (let m = 0; m < 4; m++) {
      tallyMark(g, cx, y, markH, width, seed, k);
      cx += gap;
      k++;
    }
    cx += groupGap;
  }
  g.restore();
}

// ── 칸 1 — 낯선 천장 (와이드 / 로우앵글) ───────────────────────────────────

function panel1(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  const power = flickerOn(t);

  const bg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  bg.addColorStop(0, '#04050a');
  bg.addColorStop(1, '#0d1120');
  g.fillStyle = bg;
  g.fillRect(r.x, r.y, r.w, r.h);

  // 천장: 아래에서 올려다본 소실점으로 모이는 패널 이음매.
  const vx = r.x + r.w * 0.46;
  const vy = r.y + r.h * 2.1;
  g.save();
  g.globalAlpha = 0.5 * Math.min(1, power * 1.6 + 0.12);
  g.strokeStyle = '#2b3559';
  g.lineWidth = 1.2;
  for (let i = -6; i <= 6; i++) {
    const tx = r.x + r.w / 2 + i * 108;
    // 소실점까지 30% 만 따라간다 — 끝까지 모으면 천장이 아니라 터널이 된다.
    const k = 0.3;
    g.beginPath();
    g.moveTo(tx, r.y);
    g.lineTo(tx + (vx - tx) * k, r.y + (vy - r.y) * k);
    g.stroke();
  }
  for (let i = 1; i <= 3; i++) {
    const yy = r.y + r.h * (0.1 + i * 0.16);
    const k = 1 - (i - 1) * 0.24;
    g.beginPath();
    g.moveTo(r.x + r.w / 2 - r.w * 0.62 * k, yy);
    g.lineTo(r.x + r.w / 2 + r.w * 0.62 * k, yy);
    g.stroke();
  }
  g.restore();

  lamp(g, r.x + r.w * 0.46, r.y + 44, 62, r.h, 190, power);

  // 인물: 바닥에 널브러져 있다. 로우앵글이라 칸 아래쪽에 걸린다.
  const fy = r.y + r.h - 14;
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.translate(r.x + 300, fy - 24);
  g.scale(1, 0.42);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, 300);
  pool.addColorStop(0, withAlpha(C_LAMP, 0.34 * power));
  pool.addColorStop(0.55, withAlpha(C_LAMP, 0.13 * power));
  pool.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = pool;
  g.beginPath();
  g.arc(0, 0, 300, 0, TAU);
  g.fill();
  g.restore();

  drawFigure(g, r.x + 300, fy, 330, POSES.lying, {
    color: C_FIG,
    alpha: Math.min(1, power * 2),
    outline: power > 0.3 ? C_I_RING : undefined,
    inkSeed: 21,
    style: 'silhouette',
  });

  toneGradient(g, { x: r.x, y: r.y, w: r.w, h: r.h * 0.55 }, 4, 0.5, 0.06, '#4d5f96', 0.5);
  screentone(g, r.x, r.y + r.h - 60, r.w, 60, 0.3, '#3c4a78', 0.42);

  captionBox(g, r, '...천장이 왜 이래.', 'tl', t, 31);
  narration(g, r, '우리 집엔, 야광별 있었는데.', 'br', t, 32);
}

// ── 칸 2 — 벽의 금 (익스트림 클로즈업) ─────────────────────────────────────

function panel2(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = C_WALL2;
  g.fillRect(r.x, r.y, r.w, r.h);

  // 콘크리트: 얼룩 톤 + 결 몇 줄. 클로즈업이라 질감이 곧 화면이다.
  toneGradient(g, r, 5, 0.62, 0.2, '#0a0d18', 0.85);
  g.save();
  g.strokeStyle = withAlpha('#0a0d18', 0.5);
  for (let i = 0; i < 9; i++) {
    const y0 = r.y + hash01(931, i) * r.h;
    inkStroke(
      g,
      [
        [r.x, y0],
        [r.x + r.w, y0 + jit(931, i + 40, 26)],
      ],
      1 + hash01(931, i + 70) * 2,
      931 + i,
    );
  }
  g.restore();

  // 넷씩 묶인 금. 윗줄 세 묶음 + 아랫줄 두 묶음.
  // 그림자 획을 먼저 깔고 흰 획을 얹어야 벽이 **파인** 자국으로 읽힌다.
  drawTally(g, r.x + 55, r.y + 65, 82, 22, 58, 3, '#05070e', 2.4, 0.6, TALLY_SEED);
  drawTally(g, r.x + 55, r.y + 171, 78, 22, 58, 2, '#05070e', 2.2, 0.5, TALLY_SEED + 1);
  drawTally(g, r.x + 52, r.y + 62, 82, 22, 58, 3, C_INK, 3.2, 0.95, TALLY_SEED);
  drawTally(g, r.x + 52, r.y + 168, 78, 22, 58, 2, C_INK, 3.0, 0.82, TALLY_SEED + 1);

  // 스물한 번째 획이 지금 그어지는 중 — 이 방의 시간이 아직 흐른다는 표시.
  const cut = smooth(clamp01((t - 46) / 34));
  if (cut > 0) {
    g.save();
    g.globalAlpha = cut;
    g.strokeStyle = C_INK;
    // 아랫줄 두 묶음(각 4획 = 66px 폭) 다음 자리.
    const bx = r.x + 52 + 2 * 66 + 2 * 58;
    inkStroke(
      g,
      [
        [bx, r.y + 168],
        [bx + 5, r.y + 168 + 78 * cut],
      ],
      3,
      TALLY_SEED + 99,
    );
    g.restore();
  }

  screentone(g, r.x, r.y, r.w, r.h, 0.18, '#8fa4d8', 0.16, 0.6, 5);

  captionBox(g, r, '하나, 둘... 넷씩이네.', 'tl', t, 41);
  narration(g, r, '이걸 누가 세고 있었던 거야.', 'br', t, 42);
}

// ── 칸 3 — 손잡이 없는 문 (미디엄) ─────────────────────────────────────────

function panel3(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#0c1020';
  g.fillRect(r.x, r.y, r.w, r.h);

  const power = breathe(t, 0.6);
  const fy = r.y + r.h - 46;

  // 벽 패널 이음매
  g.save();
  g.globalAlpha = 0.35;
  g.strokeStyle = '#2a3357';
  g.lineWidth = 1;
  for (let yy = r.y + 34; yy < fy; yy += 42) {
    g.beginPath();
    g.moveTo(r.x, yy);
    g.lineTo(r.x + r.w, yy);
    g.stroke();
  }
  g.restore();

  lamp(g, r.x + 130, r.y + 26, 40, r.h, 130, power);
  floorLight(g, r, fy, r.x + 190, 190, power);

  drawDoor(g, r.x + 236, r.y + 66, 138, fy - r.y - 66, 313);

  // 감시 렌즈의 붉은 점 — 누가 보고 있다.
  const pulse = 0.5 + Math.sin(t * 0.16) * 0.4;
  g.save();
  const lx = r.x + 60;
  const ly = r.y + 52;
  g.fillStyle = '#0a0c16';
  g.beginPath();
  g.arc(lx, ly, 10, 0, TAU);
  g.fill();
  g.globalAlpha = pulse;
  g.fillStyle = C_DANGER;
  g.beginPath();
  g.arc(lx, ly, 3.6, 0, TAU);
  g.fill();
  g.restore();

  // 뒷모습. 문 앞에서 몸을 반쯤 튼 자세.
  backLight(g, r.x + 150, fy, 214, 0.2);
  drawFigure(g, r.x + 150, fy, 214, POSES.turning, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 33,
    flip: true,
  });

  toneGradient(g, { x: r.x, y: r.y, w: r.w, h: r.h }, 5, 0.05, 0.42, '#2c3760', 0.6);

  captionBox(g, r, '손잡이부터 없애 놨네.', 'bl', t, 51);
  narration(g, r, '일부러네. 전부.', 'tr', t, 52);
}

// ── 칸 4 — 발현 (익스트림 클로즈업) ────────────────────────────────────────

/** 칸 4 의 빛이 터지는 화면 좌표. 칸 밖 번짐도 같은 점을 쓴다. */
function panel4Focus(r: Rect): [number, number] {
  return [r.x + r.w * 0.6, r.y + r.h * 0.44];
}

/**
 * 펼친 손가락.
 *
 * 익스트림 클로즈업에서 손을 타원 하나로 끝내면 뭉툭한 그루터기로 보인다.
 * 손가락 다섯을 부채꼴로 펴야 "손을 뻗었다"가 손으로 읽힌다. 길이·각이 전부 다르다.
 */
function drawFingers(
  g: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  dir: number,
  len: number,
  color: string,
  seed: number,
): void {
  const spread: [number, number, number][] = [
    [-0.62, 0.62, 0.2],
    [-0.24, 0.98, 0.17],
    [0.02, 1.0, 0.17],
    [0.27, 0.9, 0.15],
    [0.6, 0.66, 0.14],
  ];
  g.save();
  g.fillStyle = color;
  g.translate(wx, wy);
  g.rotate(dir);
  for (let i = 0; i < spread.length; i++) {
    const [a, l, w] = spread[i]!;
    const aa = a + jit(seed, i, 0.07);
    const ll = len * l * (1 + jit(seed, i + 30, 0.1));
    const ww = len * w;
    const ex = Math.cos(aa) * ll;
    const ey = Math.sin(aa) * ll;
    const nx = -Math.sin(aa);
    const ny = Math.cos(aa);
    g.beginPath();
    g.moveTo(nx * ww * 0.5, ny * ww * 0.5);
    g.lineTo(ex + nx * ww * 0.28, ey + ny * ww * 0.28);
    g.arc(ex, ey, ww * 0.28, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
    g.lineTo(-nx * ww * 0.5, -ny * ww * 0.5);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function panel4(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#080b16';
  g.fillRect(r.x, r.y, r.w, r.h);

  const [fx, fy] = panel4Focus(r);
  const bloom = smooth(clamp01((t - 10) / 26));

  focusLines(g, r, fx, fy, 46, 66, C_INK, 0.2 + bloom * 0.4, 407);
  screentone(g, r.x, r.y, r.w, r.h, 0.3, '#2f3b66', 0.5, -0.7, 7);

  // 손을 화면 좌표에 맞춰 놓는다 — 키 1000px 짜리 사람의 팔뚝과 손만 칸에 걸린다.
  const H = 1020;
  const anchor = figureAnchor(POSES.reaching, 'handR');
  const fxx = fx - anchor[0] * H;
  const fyy = fy - anchor[1] * H;

  // 손이 스스로 광원이라 팔은 **역광 실루엣**이다. 밝은 판을 먼저 깔지 않으면
  // 검은 팔이 검은 배경에 묻혀 아무것도 안 보인다.
  g.save();
  const back = g.createRadialGradient(fx, fy, 10, fx, fy, 260);
  back.addColorStop(0, withAlpha(C_LAMP, 0.5));
  back.addColorStop(0.45, withAlpha(C_I_RING, 0.2));
  back.addColorStop(1, withAlpha(C_I_RING, 0));
  g.fillStyle = back;
  g.beginPath();
  g.arc(fx, fy, 260, 0, TAU);
  g.fill();
  g.restore();

  // 손끝 방향 = 팔꿈치→손목. 손가락을 이 방향으로 편다.
  const elbow = figureAnchor(POSES.reaching, 'elbowR');
  const dir = Math.atan2(anchor[1] - elbow[1], anchor[0] - elbow[0]);
  const fingerLen = H * 0.075;

  // 잔상의 첫 조각: 팔 하나가 통째로 뒤에 남는다. 겹치면 얼룩이라 확실히 밀어낸다.
  const split = smooth(clamp01((t - 48) / 46));
  if (split > 0) {
    const gx = fxx - 132 * split;
    const gy = fyy + 78 * split;
    drawFigure(g, gx, gy, H, POSES.reaching, {
      color: C_SLOT[1]!,
      alpha: split * 0.35,
      inkSeed: 45,
      style: 'silhouette',
    });
    drawFingers(
      g,
      gx + anchor[0] * H,
      gy + anchor[1] * H,
      dir,
      fingerLen,
      withAlpha(C_SLOT[1]!, split * 0.35),
      45,
    );
  }

  // 팔 둘레의 발광 테두리. 같은 실루엣을 조금씩 밀어 네 번 깔면 균일한 림이 생긴다.
  // 여기는 부위별 칠하기로 둔다 — 어차피 검은 팔이 덮어서 **바깥 5px 테두리만** 보이므로
  // 안쪽 마디 경계가 드러날 자리가 없고, 전면 합성을 네 번 더 하는 값을 치를 이유도 없다.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    drawFigure(g, fxx + Math.cos(a) * 5, fyy + Math.sin(a) * 5, H, POSES.reaching, {
      color: C_I_RING,
      alpha: 0.55,
      inkSeed: 44,
    });
    drawFingers(
      g,
      fx + Math.cos(a) * 5,
      fy + Math.sin(a) * 5,
      dir,
      fingerLen * 1.05,
      withAlpha(C_I_RING, 0.55),
      44,
    );
  }
  drawFigure(g, fxx, fyy, H, POSES.reaching, {
    color: C_FIG,
    alpha: 1,
    inkSeed: 44,
  });
  drawFingers(g, fx, fy, dir, fingerLen, C_FIG, 44);

  // 손끝 발광. 손가락을 다 덮지 않도록 **코어는 작게**, 방사 링만 크게 나간다.
  if (bloom > 0) {
    g.save();
    const rad = 30 * bloom;
    const bgl = g.createRadialGradient(fx, fy, 0, fx, fy, rad);
    bgl.addColorStop(0, withAlpha(C_I_CORE, 0.98 * bloom));
    bgl.addColorStop(0.35, withAlpha(C_I_RING, 0.45 * bloom));
    bgl.addColorStop(1, withAlpha(C_I_RING, 0));
    g.fillStyle = bgl;
    g.beginPath();
    g.arc(fx, fy, rad, 0, TAU);
    g.fill();
    g.strokeStyle = C_I_RING;
    for (let i = 0; i < 2; i++) {
      const rp = ((t + i * 30) % 60) / 60;
      g.globalAlpha = (1 - rp) * 0.45 * bloom;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(fx, fy, 20 + rp * 108, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  captionBox(g, r, '어?', 'tl', t, 61);
  narration(g, r, '방금... 뭐가 남았지.', 'bl', t, 62);
}

/** 칸 4 의 빛만 **칸 밖으로** 번진다. 클립을 푼 뒤 거터 위에 얹는다. */
function panel4Spill(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  const bloom = smooth(clamp01((t - 18) / 30));
  if (bloom <= 0.01) return;
  const [fx, fy] = panel4Focus(r);
  g.save();
  g.globalAlpha = bloom * 0.55;
  const rad = 210;
  const gl = g.createRadialGradient(fx, fy, 40, fx, fy, rad);
  gl.addColorStop(0, withAlpha(C_I_RING, 0.4));
  gl.addColorStop(0.5, withAlpha(C_I_RING, 0.1));
  gl.addColorStop(1, withAlpha(C_I_RING, 0));
  g.fillStyle = gl;
  g.beginPath();
  g.arc(fx, fy, rad, 0, TAU);
  g.fill();
  g.restore();
}

// ── 칸 5 — 되풀이 (투샷) ───────────────────────────────────────────────────

function panel5(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#0a0d1b';
  g.fillRect(r.x, r.y, r.w, r.h);

  const fy = r.y + r.h - 54;
  lamp(g, r.x + 110, r.y + 22, 34, r.h, 110, breathe(t, 0.5));
  lamp(g, r.x + 330, r.y + 22, 34, r.h, 110, breathe(t + 40, 0.5));
  floorLight(g, r, fy, r.x + 150, 150, 0.7);

  // 잔상: 제자리에서 같은 동작을 되풀이한다. 주기 46틱.
  const gx = r.x + 118;
  const cyc = (tt: number): number => 0.5 - 0.5 * Math.cos((tt % 46) * (TAU / 46));
  const ghostH = 186;
  for (let i = 5; i >= 1; i--) {
    const k = cyc(t - i * 6);
    drawFigure(g, gx + Math.sin((t - i * 6) * 0.137) * 12, fy, ghostH, blendReach(k), {
      color: C_SLOT[1]!,
      alpha: 0.13 * (1 - i / 6),
      inkSeed: 51,
      style: 'silhouette',
    });
  }
  drawFigure(g, gx + Math.sin(t * 0.137) * 12, fy, ghostH, blendReach(cyc(t)), {
    color: C_SLOT[1]!,
    alpha: 0.55,
    outline: C_SLOT[1]!,
    inkSeed: 51,
    style: 'silhouette',
  });

  // 발밑 앵커 링 — "이 자리에 묶여 있다".
  g.save();
  g.translate(gx, fy + 5);
  g.scale(1, 0.24);
  g.strokeStyle = C_SLOT[1]!;
  g.globalAlpha = 0.3 + Math.sin(t * 0.12) * 0.08;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(0, 0, 46, 0, TAU);
  g.stroke();
  g.restore();

  // 나: 이미 오른쪽으로 걸어갔다.
  speedLines(
    g,
    { x: r.x + 190, y: r.y + 90, w: 220, h: 130 },
    16,
    C_INK,
    0.16,
    515,
  );
  const meX = r.x + 250 + Math.min(1, t / 100) * 92;
  backLight(g, meX, fy, 190, 0.24);
  drawFigure(g, meX, fy, 190, POSES.walking, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 52,
  });

  toneGradient(g, { x: r.x, y: r.y, w: r.w, h: r.h }, 4, 0.06, 0.38, '#2b3660', 0.55);

  captionBox(g, r, '안 사라져.', 'tl', t, 71);
  narration(g, r, '아까 나잖아, 저거.', 'br', t, 72);
}

/** standing ↔ reaching 사이를 오가는 루프 포즈. 잔상은 이 한 동작만 되풀이한다. */
function blendReach(k: number): Pose {
  const a = POSES.standing;
  const b = POSES.reaching;
  const m = (x: number, y: number): number => x + (y - x) * k;
  return {
    headTilt: m(a.headTilt, b.headTilt),
    shoulderTilt: m(a.shoulderTilt, b.shoulderTilt),
    lean: m(a.lean, b.lean),
    armL: [m(a.armL[0], b.armL[0]), m(a.armL[1], b.armL[1])],
    armR: [m(a.armR[0], b.armR[0]), m(a.armR[1], b.armR[1])],
    legL: [m(a.legL[0], b.legL[0]), m(a.legL[1], b.legL[1])],
    legR: [m(a.legR[0], b.legR[0]), m(a.legR[1], b.legR[1])],
    hairMass: m(a.hairMass, b.hairMass),
  };
}

// ── 칸 6 — 발판과 문 (와이드) ──────────────────────────────────────────────

function panel6(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#090c18';
  g.fillRect(r.x, r.y, r.w, r.h);

  const fy = r.y + r.h - 40;
  lamp(g, r.x + 150, r.y + 16, 36, r.h, 110, breathe(t, 0.42));
  lamp(g, r.x + 450, r.y + 16, 40, r.h, 130, breathe(t + 30, 0.62));
  lamp(g, r.x + 760, r.y + 16, 36, r.h, 110, breathe(t + 60, 0.42));
  floorLight(g, r, fy, r.x + 450, 320, 0.6);

  const px = r.x + 128;
  drawPlate(g, px, fy + 8, 44, 0.3 + Math.sin(t * 0.1) * 0.08, false);

  const dx = r.x + 774;
  const dTop = r.y + 62;
  drawDoor(g, dx, dTop, 84, fy - dTop, 617);

  // 발판 → 문 의 인과선. 이게 있어야 "둘 다 닿아야 한다"가 구도로 읽힌다.
  g.save();
  g.strokeStyle = C_SLOT[1]!;
  g.globalAlpha = 0.34;
  g.lineWidth = 2;
  g.setLineDash([8, 10]);
  g.lineDashOffset = -t * 1.4;
  g.beginPath();
  g.moveTo(px, fy);
  g.quadraticCurveTo((px + dx) / 2, r.y + 6, dx + 42, dTop + 20);
  g.stroke();
  g.setLineDash([]);
  g.restore();

  // 혼자 선 나. 양쪽 어디로도 못 가는 크기로 작게 — 거리가 곧 문제다.
  const sway = Math.sin(t * 0.045);
  backLight(g, r.x + 448 + sway * 6, fy, 148, 0.26);
  drawFigure(g, r.x + 448 + sway * 6, fy, 148, POSES.standing, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 61,
  });

  // 도달 불가를 못 박는 양쪽 화살선.
  g.save();
  g.globalAlpha = 0.3;
  g.strokeStyle = withAlpha(C_INK, 0.6);
  inkStroke(
    g,
    [
      [r.x + 420, fy + 16],
      [px + 52, fy + 16],
    ],
    1.6,
    662,
  );
  inkStroke(
    g,
    [
      [r.x + 478, fy + 16],
      [dx - 14, fy + 16],
    ],
    1.6,
    663,
  );
  g.restore();

  toneGradient(g, { x: r.x, y: r.y, w: r.w, h: r.h }, 4, 0.08, 0.34, '#2b3660', 0.5);

  captionBox(g, r, '밟으면 열리고... 떼면 닫히고.', 'tl', t, 81);
  narration(g, r, '둘이어야 되는 건데.', 'br', t, 82);
}

// ── 칸 7 — 넷 (전면) ───────────────────────────────────────────────────────

const SLOT_LABELS = ['I', 'MY', 'ME', 'MINE'] as const;
/** 각 실루엣이 자리를 잡는 틱. */
const SLOT_IN = [4, 24, 44, 64] as const;
const FOUR_X = [282, 414, 546, 678] as const;

/** 팔짱. POSES 에 없는 조합이라 여기서 만든다 — 네 자세가 전부 달라야 하기 때문이다. */
const P_FOLDED: Pose = {
  headTilt: 0.11,
  shoulderTilt: -0.12,
  lean: -0.06,
  armL: [-0.95, 2.5],
  armR: [0.9, -2.55],
  legL: [-0.04, 0.06],
  legR: [0.13, -0.28],
  hairMass: 0.66,
};

/** 네 자세는 전부 다르다. 같은 포즈를 색만 바꿔 네 번 찍으면 즉시 로봇으로 보인다. */
const FOUR_POSES: readonly Pose[] = [POSES.standing, POSES.slumped, P_FOLDED, POSES.reaching];

/**
 * 슬롯 i 의 **라벨과 금**이 함께 밝아지는 정도.
 *
 * 둘이 같은 식을 쓰기 때문에 점등이 어긋날 수 없다 — 금 하나와 라벨 하나가 같은 순간에
 * 켜지는 것이, "이 금 하나 = 나 하나"를 말없이 설명하는 유일한 장치다.
 */
function slotGlow(i: number, t: number): number {
  return clamp01((t - SLOT_IN[i]! - 12) / 18);
}

/**
 * 회수되는 금의 길이(px). 인물 키 208 의 1/4 남짓 — 머리 하나보다 조금 큰 정도다.
 * 굵기는 칸 2 의 길이:굵기 비(78:3.2)를 그대로 따라간다. 그래야 벽에서 물러난 같은 자국으로 보인다.
 */
const RECALL_MARK_H = 50;
/** 금의 윗끝. 네 인물 머리 위 벽면에 걸린다. */
const RECALL_MARK_Y = 196;

function panel7(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  const bg = g.createRadialGradient(480, 330, 40, 480, 330, 560);
  bg.addColorStop(0, '#131a30');
  bg.addColorStop(1, '#05060d');
  g.fillStyle = bg;
  g.fillRect(r.x, r.y, r.w, r.h);

  const fy = 470;

  floorLight(g, r, fy, 480, 340, 0.66);
  lamp(g, 480, 96, 74, 380, 250, breathe(t, 0.55));
  drawPlate(g, FOUR_X[0]!, fy + 8, 46, 0.3, true);

  // 회수: 칸 2 의 "넷씩 묶인 금"이 네 사람 **머리 위 벽면**에 하나씩 다시 뜬다.
  //
  // 획은 칸 2 와 같은 `tallyMark`·같은 `TALLY_SEED`·같은 인덱스(k = 0..3)로 긋는다 —
  // 칸 2 윗줄 첫 묶음의 그 네 획이 그대로 온다. 길이만 벽에서 물러난 만큼 줄었고
  // 굵기도 같은 비율로 줄어서, 기울기·거친 선질·길이 비가 전부 보존된다.
  //
  // 인물을 관통하는 세로 기둥이 되면 연기나 글리치로 읽힌다. 머리 위 46px 짜리 짧은
  // 자국이어야 "벽에 새겨진 그 금"으로 읽힌다.
  g.save();
  for (let i = 0; i < 4; i++) {
    const glow = slotGlow(i, t);
    if (glow <= 0.01) continue;
    const x = FOUR_X[i]!;
    const col = i === 0 ? C_I_CORE : C_SLOT[i]!;

    // 그림자 → 슬롯색 번짐 → 흰 획. 칸 2 와 같은 "먼저 파고 그 위에 흰 획" 순서라야
    // 그어진 자국으로 읽힌다. 슬롯색은 라벨과 같은 색이라 금과 이름이 한 쌍으로 묶인다.
    g.globalAlpha = glow * 0.5;
    g.strokeStyle = '#05070e';
    tallyMark(g, x + 2, RECALL_MARK_Y + 2, RECALL_MARK_H, 2, TALLY_SEED, i);

    g.globalAlpha = glow * 0.32;
    g.strokeStyle = col;
    tallyMark(g, x, RECALL_MARK_Y, RECALL_MARK_H, 4.6, TALLY_SEED, i);

    g.globalAlpha = glow * 0.78;
    g.strokeStyle = C_INK;
    tallyMark(g, x, RECALL_MARK_Y, RECALL_MARK_H, 2.6, TALLY_SEED, i);
  }
  g.restore();

  // 뒤 슬롯부터 → 앞(=I)이 위로 겹친다.
  for (let i = 3; i >= 1; i--) {
    const a = clamp01((t - SLOT_IN[i]!) / 24);
    if (a <= 0) continue;
    const x = FOUR_X[i]!;
    const slide = (1 - a) * 46;
    const col = C_SLOT[i]!;
    // 들어오면서 트레일을 끌고 오되 자리를 잡으면 걷힌다. 안 걷으면 넷이 아니라 열둘로 보인다.
    const tail = (1 - a) * a;
    for (let k = 1; k <= 4; k++) {
      drawFigure(g, x + slide + k * 16, fy, 208, FOUR_POSES[i]!, {
        color: col,
        alpha: tail * (1 - k / 5) * 1.5,
        inkSeed: 90 + i,
        style: 'silhouette',
      });
    }
    drawFigure(g, x + slide, fy, 208, FOUR_POSES[i]!, {
      color: col,
      alpha: a * 0.72,
      outline: col,
      inkSeed: 90 + i,
      style: 'silhouette',
    });
  }

  // I — 발판 위. 불투명하고 가장 또렷하다.
  // 불투명한 인물은 부위가 겹쳐도 색이 달라지지 않으므로 이미 칸 1·3 과 같은 채워진 실루엣이다.
  // 여기에 'silhouette' 을 주면 어깨 림라이트만 사라져 오히려 칸 1·3 에서 멀어진다.
  backLight(g, FOUR_X[0]!, fy, 208, 0.3);
  drawFigure(g, FOUR_X[0]!, fy, 208, FOUR_POSES[0]!, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 90,
  });

  // 라벨 점등
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = font(15, 'bold');
  for (let i = 0; i < 4; i++) {
    // 머리 위 금과 **같은 식**을 쓴다 — 라벨이 켜지는 순간 그 금도 같이 밝아진다.
    const a = slotGlow(i, t);
    if (a <= 0) continue;
    const x = FOUR_X[i]!;
    const col = i === 0 ? C_I_CORE : C_SLOT[i]!;
    g.globalAlpha = a;
    g.fillStyle = col;
    g.shadowColor = withAlpha(col, 0.85);
    g.shadowBlur = 12;
    g.fillText(SLOT_LABELS[i]!, x, fy + 38);
    g.shadowBlur = 0;
    g.globalAlpha = a * 0.45;
    g.strokeStyle = col;
    inkStroke(
      g,
      [
        [x - 22, fy + 47],
        [x + 22, fy + 47],
      ],
      1.4,
      700 + i,
    );
  }
  g.restore();

  // 위아래 톤은 단을 나눠 깔아야 경계에 가로줄이 생기지 않는다.
  toneGradient(g, { x: 0, y: 0, w: CANVAS_W, h: 190 }, 5, 0.4, 0.02, '#3a4874', 0.45);
  toneGradient(g, { x: 0, y: CANVAS_H - 150, w: CANVAS_W, h: 150 }, 5, 0.02, 0.4, '#3a4874', 0.45);

  // 결심과 농담 사이의 한 박 — 두 번째 풍선은 작게, 반 박(26틱) 늦게 (COMIC-SCRIPT 컷 7).
  captionBox(
    g,
    { x: 40, y: 34, w: CANVAS_W - 80, h: 90 },
    '그럼 내가 남으면 되지.',
    'tl',
    t,
    91,
  );
  captionBox(
    g,
    { x: 96, y: 78, w: CANVAS_W - 136, h: 60 },
    '나, 넷이나 있잖아.',
    'tl',
    t - 26, // 페이드 시작이 26틱 늦어진다 (captionBox 내부가 t-14 기준이므로)
    92, // seed 를 다르게 — 첫 풍선과 기울기가 겹쳐 보이지 않게
    11, // 더 작은 글자
  );

  // 마지막 24틱: 화면이 밝아지며 타이틀로 넘어간다.
  const flash = clamp01((t - (CUT_TICKS - 24)) / 24);
  if (flash > 0) {
    g.fillStyle = withAlpha(C_I_CORE, flash * flash * 0.94);
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

// ── 페이지 조립 ────────────────────────────────────────────────────────────

const PAINT: ReadonlyArray<(g: CanvasRenderingContext2D, r: Rect, t: number) => void> = [
  panel1,
  panel2,
  panel3,
  panel4,
  panel5,
  panel6,
  panel7,
];

/** 페이지 한 장. `tick` 시점까지 그려진 칸만 얹는다. */
function drawPage(g: CanvasRenderingContext2D, page: number, tick: number): void {
  g.fillStyle = C_PAPER;
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const first = PAGE_FIRST[page]!;
  const last = PAGE_LAST[page]!;
  for (let i = first; i <= last; i++) {
    const start = i * CUT_TICKS;
    if (tick < start) break;
    const local = tick - start;
    const p = clamp01(local / REVEAL_TICKS);
    const r = PANELS[i]!;

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    PAINT[i]!(g, r, local);
    inkWipe(g, r, p, 700 + i);
    g.restore();

    // 칸 4 의 빛만 테두리를 넘어 거터로 번진다.
    if (i === 3 && p > 0.55) panel4Spill(g, r, local);

    // 칸 7 은 전면(full-bleed) 이라 테두리를 두르지 않는다.
    if (i !== 6) panelBorder(g, r, 100 + i, clamp01((p - 0.12) / 0.35));
  }
}

/** 스캔라인 + 진행 표시 + 수동 진행 안내. 페이지와 무관하게 화면에 고정된다. */
function drawOverlay(g: CanvasRenderingContext2D, tick: number, touch: boolean): void {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.1)';
  for (let y = 0; y < CANVAS_H; y += 4) g.fillRect(0, y, CANVAS_W, 1);
  g.restore();

  const cut = Math.min(CUT_COUNT - 1, Math.floor(tick / CUT_TICKS));
  g.save();
  for (let i = 0; i < CUT_COUNT; i++) {
    g.globalAlpha = i === cut ? 0.85 : i < cut ? 0.35 : 0.15;
    g.fillStyle = i === cut ? C_I_RING : C_TEXT_DIM;
    g.fillRect(22 + i * 12, CANVAS_H - 14, 8, 3);
  }
  g.restore();

  g.save();
  g.globalAlpha = 0.22 + Math.sin(tick * 0.06) * 0.1;
  g.fillStyle = C_TEXT_DIM;
  g.font = font(10);
  g.textAlign = 'right';
  g.textBaseline = 'alphabetic';
  const last = cut === CUT_COUNT - 1;
  const direction = last ? 'TO START' : 'FOR NEXT';
  const prompt = touch ? `TAP ${direction}` : `PRESS ANY KEY ${direction}`;
  g.fillText(prompt, CANVAS_W - 22, CANVAS_H - 10);
  g.restore();
}

/**
 * 인트로 한 프레임.
 *
 * 페이지 안에서는 칸이 하나씩 잉크로 번지며 늘어나고, 페이지가 바뀌는 순간에만
 * **가로 와이프**가 걸린다. 나가는 페이지는 마지막 틱 상태로 얼려 그린다 — 나가는
 * 화면이 계속 움직이면 시선이 갈라진다.
 */
export function drawIntro(g: CanvasRenderingContext2D, s: IntroState, touch = false): void {
  const tick = Math.min(s.tick, INTRO_TICKS - 1);
  const cut = Math.min(CUT_COUNT - 1, Math.floor(tick / CUT_TICKS));
  const page = PAGE_OF[cut]!;
  const pageStart = PAGE_FIRST[page]! * CUT_TICKS;
  const sincePage = tick - pageStart;

  g.fillStyle = C_PAPER;
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (page > 0 && sincePage < PAGE_TICKS) {
    const k = sincePage / PAGE_TICKS;
    const ease = 1 - Math.pow(1 - k, 3);

    g.save();
    g.translate(-ease * CANVAS_W, 0);
    drawPage(g, page - 1, pageStart - 1);
    g.restore();

    g.save();
    g.translate((1 - ease) * CANVAS_W, 0);
    drawPage(g, page, tick);
    g.restore();

    // 넘어가는 종이의 접힌 모서리 — 두 페이지가 겹쳐 보이지 않게 경계를 긋는다.
    g.save();
    g.globalAlpha = (1 - ease) * 0.6;
    g.fillStyle = C_I_RING;
    g.fillRect((1 - ease) * CANVAS_W - 3, 0, 3, CANVAS_H);
    g.restore();
  } else {
    drawPage(g, page, tick);
  }

  drawOverlay(g, tick, touch);
}
