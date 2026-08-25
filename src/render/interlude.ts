/**
 * I.MY.ME.MINE — 막 사이 **2컷 막간 만화** (STORY.md §4).
 *
 * 인트로(`intro.ts`)와 같은 시각 언어를 쓴다: 손으로 그은 칸 테두리, 하프톤 스크린톤,
 * 기울어진 캡션 박스, 잉크가 번지듯 드러나는 칸. 다만 인트로가 7칸 15초짜리 **페이지**라면
 * 막간은 2칸 5초짜리 **쪽지**다 — 페이지 넘김도, 전면 칸도 없다.
 *
 * 인트로의 부품(`screentone`·`captionBox`·`tallyMark` …)은 `intro.ts` 안에 비공개로 묶여
 * 있고 그 파일은 지금 건드릴 수 없으므로, 여기서 **같은 레시피로 다시 구현**한다.
 * 값(칸 색·톤 각도·획 시드)은 인트로와 일치시켰다 — 두 만화가 같은 손에서 나와야 한다.
 *
 * 제약(SPEC §0/§7, 인트로와 동일):
 * - 외부 이미지·폰트 에셋 0개. 전부 Canvas 2D.
 * - `sim/` 과 완전히 분리된 순수 렌더 + 자체 틱 카운터. SimState 를 만들지도 읽지도 않는다.
 * - `Math.random()` 없음. 모든 흔들림은 시드 해시에서 나온다.
 * - 인물은 얼굴 없는 실루엣(`figure.ts`).
 */

import { C_I_RING, C_SLOT, C_TEXT_DIM, font, withAlpha } from './palette';
import { drawFigure, inkStroke, POSES, type Pose } from './figure';
import { CANVAS_H, CANVAS_W } from '../sim/constants';
import * as sprites from './sprites';

// ── 타이밍 ─────────────────────────────────────────────────────────────────

/** 칸당 2.5초. 2칸 = 300틱 = 5.0초. 인트로(15.4초)보다 확실히 짧다. */
export const CUT_TICKS = 150;
export const CUT_COUNT = 2;
export const INTERLUDE_TICKS = CUT_TICKS * CUT_COUNT;

/** 칸 하나가 잉크로 다 차는 데 걸리는 틱. */
const REVEAL_TICKS = 30;

/** 막간 번호. 0=문 바깥쪽, 1=선반, 2=셈, 3=마지막 문. */
export const INTERLUDE_COUNT = 4;

export interface InterludeState {
  /** 0..3. `INTERLUDES` 인덱스. */
  id: number;
  /** 막간 자체 타이머. 시뮬 틱과 무관하다. */
  tick: number;
  /** 끝까지 재생됐는가. */
  done: boolean;
}

export function createInterlude(id: number): InterludeState {
  const clamped = Number.isFinite(id) ? Math.min(INTERLUDE_COUNT - 1, Math.max(0, Math.trunc(id))) : 0;
  return { id: clamped, tick: 0, done: false };
}

/** 1틱 진행. `done` 이 되면 호출부가 다음 스테이지로 넘긴다. */
export function tickInterlude(s: InterludeState): void {
  if (s.done) return;
  s.tick++;
  if (s.tick >= INTERLUDE_TICKS) s.done = true;
}

// ── 막간 경계 ──────────────────────────────────────────────────────────────

/**
 * 방금 클리어한 스테이지 뒤에 끼울 막간. 없으면 null.
 *
 * 경계는 `game/levels.ts` 의 4막 구성과 같다(주석 §"4막 구성"):
 * 1막 01~04(index 0~3) · 2막 05~08(4~7) · 3막 09~12(8~11) · 4막 13~15(12~14).
 * 그래서 index 3·7·11 을 넘길 때가 막 경계이고, 마지막 index 14 클리어 직후가 엔딩 직전이다.
 */
export function interludeAfterStage(stageIndex: number): number | null {
  switch (stageIndex) {
    case 3:
      return 0;
    case 7:
      return 1;
    case 11:
      return 2;
    case 14:
      return 3;
    default:
      return null;
  }
}

// ── 본 막간 기록 ───────────────────────────────────────────────────────────
// 인트로와 같은 이유로 전부 삼킨다: 사파리 프라이빗 모드·쿠키 차단 환경에서
// localStorage 는 접근만 해도 예외를 던진다. 막간 하나 때문에 런이 날아가면 안 된다.
// 읽기 실패는 "본 적 없음", 쓰기 실패는 "다음에 또 나온다" 로 떨어진다 — 둘 다 치명적이지 않다.

const SEEN_KEY = 'imm.interlude.seen';

function readSeenMask(): number {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function hasSeenInterlude(id: number): boolean {
  return (readSeenMask() & (1 << id)) !== 0;
}

export function markInterludeSeen(id: number): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(readSeenMask() | (1 << id)));
  } catch {
    // 저장이 막힌 환경이면 매번 막간이 나온다. 스킵이 있으니 치명적이지 않다.
  }
}

// ── 잉크 / 종이 (인트로와 같은 값) ─────────────────────────────────────────

const TAU = Math.PI * 2;

/** 페이지(거터 포함) 바탕. 밤 장면 만화라 종이 자체가 검다. */
const C_PAPER = '#080a11';
/** 흰 잉크 — 칸 테두리·효과선. */
const C_INK = '#e6ecff';
/** 캡션 박스 바탕(흰 종이 조각). */
const C_BOX = '#eef2ff';
/** 캡션 박스 글자. */
const C_BOX_TX = '#080a11';
/** 인물 실루엣. */
const C_FIG = '#04060d';
/** 차가운 형광등. */
const C_LAMP = '#cfe0ff';
/** 콘크리트 벽. */
const C_WALL2 = '#171d33';

/**
 * 인트로 칸 2 의 벽에 그어진 금과 **같은 획 시드**.
 * 막간 3 의 무더기가 그 벽의 연장으로 읽히려면 이 숫자가 같아야 한다.
 */
const TALLY_SEED = 4177;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

function breathe(t: number, base: number): number {
  return base + Math.sin(t * 0.09) * 0.04 + Math.sin(t * 0.43) * 0.015;
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
 * 칸이 잉크로 번지듯 드러난다. 아직 안 드러난 부분을 종이색으로 덮는다.
 * 경계는 칸의 대각선을 따라 흐르고, 좌표계를 45° 돌려 놓으면 그 사선이 세로선이 된다.
 */
function inkWipe(g: CanvasRenderingContext2D, r: Rect, p: number, seed: number): void {
  if (p >= 1) return;
  const q = ((r.w + r.h) * p) / Math.SQRT2;
  const L = (r.w + r.h) * 1.1;

  g.save();
  g.translate(r.x, r.y);
  g.rotate(Math.PI / 4);

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

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** 칸 모서리에 살짝 기울어 얹힌 캡션 박스. 손글씨 느낌의 테두리. */
function captionBox(
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  corner: Corner,
  t: number,
  seed: number,
): void {
  const a = clamp01((t - 14) / 20);
  if (a <= 0) return;

  let size = 14;
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

  g.globalAlpha = a;
  g.translate(bx + bw / 2, by + bh / 2 + (1 - a) * 6);
  g.rotate(jit(seed, 3, 0.024));
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

/** 내레이션(속말). 캡션과 반대 모서리에, 어두운 종이 조각 위 흰 글씨로. */
function narration(
  g: CanvasRenderingContext2D,
  r: Rect,
  text: string,
  corner: Corner,
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

/**
 * 집중선. 한 점으로 모이는 쐐기들.
 *
 * `far` 를 칸 대각선으로 두면 칸 전체가 방사선으로 덮인다 — 클로즈업이 아닌 칸에서는
 * 배경을 다 지워 버리므로, 여기서는 강조할 물건 주위로 **반경을 끊어** 쓴다.
 */
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
  reach?: number,
): void {
  if (alpha <= 0.01) return;
  const far = reach ?? Math.hypot(r.w, r.h) * 1.3;
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
 * 검은 실루엣은 **밝은 배경 위에서만** 실루엣이다. 어두운 방에 검은 인물을 그리면
 * 그냥 얼룩이 되므로, 인물이 설 자리에 빛 한 판을 미리 깔아 몸을 도려낸다.
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

/** 콘크리트 벽면. 클로즈업 칸에서는 이 질감이 곧 화면이다. */
function concrete(g: CanvasRenderingContext2D, r: Rect, seed: number): void {
  g.fillStyle = C_WALL2;
  g.fillRect(r.x, r.y, r.w, r.h);
  toneGradient(g, r, 5, 0.6, 0.2, '#0a0d18', 0.85);
  g.save();
  g.strokeStyle = withAlpha('#0a0d18', 0.5);
  for (let i = 0; i < 9; i++) {
    const y0 = r.y + hash01(seed, i) * r.h;
    inkStroke(
      g,
      [
        [r.x, y0],
        [r.x + r.w, y0 + jit(seed, i + 40, 26)],
      ],
      1 + hash01(seed, i + 70) * 2,
      seed + i,
    );
  }
  g.restore();
}

/**
 * 문. 인트로의 문과 같은 작도이되 **손잡이를 붙일 수 있다**.
 * 안쪽에서 본 문에는 손잡이가 없었다(인트로 칸 3) — 그 공백이 여기서 뒤집힌다.
 */
function drawDoor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  handle: boolean,
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

  // 문틈으로 새는 빛.
  const seam = g.createLinearGradient(x + w / 2 - 5, 0, x + w / 2 + 5, 0);
  seam.addColorStop(0, withAlpha(C_LAMP, 0));
  seam.addColorStop(0.5, withAlpha(C_LAMP, 0.2));
  seam.addColorStop(1, withAlpha(C_LAMP, 0));
  g.fillStyle = seam;
  g.fillRect(x + w / 2 - 5, y + 6, 10, h - 10);

  // 경첩 볼트(왼쪽만).
  g.save();
  g.fillStyle = withAlpha(C_INK, 0.4);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(x + 9, y + h * (0.18 + i * 0.31), 2.6, 0, TAU);
    g.fill();
  }
  g.restore();

  if (handle) drawHandle(g, x + w - 22, y + h * 0.52, seed + 40);
}

/**
 * 레버형 손잡이. 경첩 반대쪽에 달린다.
 *
 * 이 부품 하나가 막간 1 의 전부다. 눈에 안 띄면 컷이 성립하지 않으므로
 * 판(어두움) → 레버(밝음) → 하이라이트 순서로 대비를 세 단 준다.
 */
function drawHandle(g: CanvasRenderingContext2D, hx: number, hy: number, seed: number): void {
  g.save();
  // 받침판
  g.fillStyle = '#0d1224';
  g.fillRect(hx - 7, hy - 17, 15, 34);
  g.strokeStyle = withAlpha(C_INK, 0.7);
  inkStroke(
    g,
    [
      [hx - 7, hy - 17],
      [hx + 8, hy - 17],
      [hx + 8, hy + 17],
      [hx - 7, hy + 17],
      [hx - 7, hy - 17],
    ],
    1.6,
    seed,
  );
  // 레버 — 문 안쪽(-x) 으로 뻗는다.
  g.fillStyle = '#9fb2e0';
  g.fillRect(hx - 34, hy - 4, 30, 8);
  g.beginPath();
  g.arc(hx - 34, hy, 4, 0, TAU);
  g.fill();
  g.strokeStyle = C_INK;
  inkStroke(
    g,
    [
      [hx - 34, hy - 5],
      [hx - 3, hy - 5],
    ],
    1.4,
    seed + 5,
  );
  // 금속 하이라이트
  g.fillStyle = withAlpha(C_INK, 0.9);
  g.fillRect(hx - 30, hy - 3, 22, 2);
  g.restore();
}

/**
 * 금 **한 획**. 인트로 칸 2·7 의 `tallyMark` 와 같은 식이다 — 같은 `seed`·`k` 를 주면
 * 기울기·길이 비율·거친 선질이 그대로 재현된다. 막간 3 이 "그 벽의 연장"으로 읽히는 근거.
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

/** 벽의 금. **넷씩 묶은** 손톱 자국. */
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

/**
 * **인쇄체** 한 줄. 글자를 하나씩 고정 간격으로 찍는다.
 *
 * 손글씨(=`inkStroke` 지터)와 붙어 있어야 의미가 생기는 부품이다: 여기에는 지터가
 * 한 톨도 없고, 자간이 모든 글자에서 정확히 같으며, 밑줄은 `fillRect` 로 곧게 긋는다.
 * 그 무표정함이 "내가 센 게 아니다"를 말한다.
 */
function printedLine(
  g: CanvasRenderingContext2D,
  cx: number,
  y: number,
  text: string,
  size: number,
  spacing: number,
  alpha: number,
): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = font(size, 'bold');
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';

  const chars = [...text];
  let total = 0;
  for (const c of chars) total += g.measureText(c).width + spacing;
  total -= spacing;

  let x = cx - total / 2;
  for (const c of chars) {
    // 잉크 눌린 자국 — 인쇄물의 두께감. 지터 없이 정확히 1px 만 어긋난다.
    g.fillStyle = 'rgba(4,6,13,0.75)';
    g.fillText(c, x + 1, y + 1);
    g.fillStyle = '#dfe7ff';
    g.fillText(c, x, y);
    x += g.measureText(c).width + spacing;
  }
  g.restore();
}

/**
 * 칸의 배경으로 만화 배경 이미지를 깐다. 없으면 false — 호출부가 기존 코드
 * 배경(그라디언트·콘크리트)을 그대로 쓴다.
 *
 * 이미지는 칸을 **cover** 로 덮고 칸 밖으로 넘치는 부분은 잘라 낸다. 늘여서
 * 맞추면 3:2 원본이 찌그러지므로 비율은 유지한 채 넘치게 두는 쪽을 택했다.
 *
 * 배경일 뿐이라는 게 중요하다 — 인물·조명·자막은 그대로 코드가 그 위에 얹는다.
 * 그래야 해상도가 바뀌거나 문구가 바뀌어도 글자가 이미지에 구워지지 않는다.
 */
function sceneBackdrop(g: CanvasRenderingContext2D, r: Rect, id: sprites.SceneId): boolean {
  const img = sprites.scene(id);
  if (img === undefined) return false;
  const iw = 960;
  const ih = 640;
  const scale = Math.max(r.w / iw, r.h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.imageSmoothingEnabled = true;
  g.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  // 잉크 작화와 자막이 위에 얹히므로 사진을 한 겹 눌러 둔다 — 안 그러면
  // 배경 대비가 인물보다 세져서 시선이 뒤로 빠진다.
  g.fillStyle = 'rgba(6,8,14,0.42)';
  g.fillRect(r.x, r.y, r.w, r.h);
  g.restore();
  return true;
}

// ── 막간 1 — 문 바깥쪽 ─────────────────────────────────────────────────────

/** 컷 1 — 방금 빠져나온 문을 돌아본다. 바깥쪽에는 손잡이가 달려 있다. */
function i1cut1(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  if (!sceneBackdrop(g, r, 'outerDoor')) {
    const bg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#070a14');
    bg.addColorStop(1, '#0d1120');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
  }

  const power = breathe(t, 0.62);
  const fy = r.y + r.h - 42;

  // 벽 패널 이음매
  g.save();
  g.globalAlpha = 0.32;
  g.strokeStyle = '#2a3357';
  g.lineWidth = 1;
  for (let yy = r.y + 40; yy < fy; yy += 44) {
    g.beginPath();
    g.moveTo(r.x, yy);
    g.lineTo(r.x + r.w, yy);
    g.stroke();
  }
  g.restore();

  lamp(g, r.x + 250, r.y + 20, 46, r.h, 150, power);
  lamp(g, r.x + 700, r.y + 20, 38, r.h, 126, breathe(t + 37, 0.52));
  floorLight(g, r, fy, r.x + 620, 260, power);

  const dx = r.x + 596;
  const dTop = r.y + 60;
  const dw = 150;
  const dh = fy - dTop;
  drawDoor(g, dx, dTop, dw, dh, 313, true);

  // 손잡이로 시선을 몬다. 늦게 켜져야 "돌아보다가 발견했다"가 된다.
  // 반경이 다른 두 겹을 얹어 바깥으로 갈수록 옅어지게 한다 — 한 겹이면 끝이 원으로 잘린다.
  const spot = smooth(clamp01((t - 38) / 44));
  const hcx = dx + dw - 22;
  const hcy = dTop + dh * 0.52;
  focusLines(g, r, hcx, hcy, 30, 46, C_INK, spot * 0.07, 1301, 230);
  focusLines(g, r, hcx, hcy, 22, 40, C_INK, spot * 0.08, 1302, 132);

  // 뒤돌아본 인물. 문은 오른쪽이므로 인트로 칸 3 과 같은 배치·같은 flip 이다.
  backLight(g, r.x + 300, fy, 236, 0.22);
  drawFigure(g, r.x + 300, fy, 236, POSES.turning, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 33,
    flip: true,
  });

  toneGradient(g, r, 5, 0.06, 0.4, '#2c3760', 0.58);
  captionBox(g, r, '바깥쪽엔, 있네.', 'tl', t, 1311);
}

/** 컷 2 — 문 옆 벽에 붙은 종이. 손으로 적은 표. 숫자 몇 개와 `회수`. */
function i1cut2(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  concrete(g, r, 1501);

  // 종이가 칸을 거의 채운다 — 익스트림 클로즈업이라 이 표가 곧 화면이다.
  const px = r.x + 330;
  const py = r.y + r.h / 2;
  const pw = 470;
  const ph = 174;

  g.save();
  g.translate(px, py);
  g.rotate(-0.026);

  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(-pw / 2 + 6, -ph / 2 + 7, pw, ph);
  g.fillStyle = C_BOX;
  g.fillRect(-pw / 2, -ph / 2, pw, ph);
  g.strokeStyle = C_BOX_TX;
  inkStroke(
    g,
    [
      [-pw / 2, -ph / 2],
      [pw / 2, -ph / 2],
      [pw / 2, ph / 2],
      [-pw / 2, ph / 2],
      [-pw / 2, -ph / 2],
    ],
    1.6,
    1511,
  );

  // 손으로 그은 표 — 자로 댄 선이 아니다.
  g.strokeStyle = 'rgba(8,10,17,0.8)';
  for (let i = 0; i < 4; i++) {
    const yy = -ph / 2 + 40 + i * 34;
    inkStroke(
      g,
      [
        [-pw / 2 + 20, yy],
        [pw / 2 - 20, yy + jit(1521, i, 2.6)],
      ],
      1.4,
      1520 + i,
    );
  }
  inkStroke(
    g,
    [
      [14, -ph / 2 + 14],
      [14 + jit(1531, 0, 4), ph / 2 - 14],
    ],
    1.3,
    1531,
  );

  // 손글씨. 글자마다 기울기·높이가 달라야 "적어 넣은" 것으로 읽힌다.
  // 막간 3 의 일련번호(`printedLine`) 와 정확히 반대편에 있는 부품이다.
  const cells: [string, number, number, number][] = [
    ['배치', -92, -ph / 2 + 24, 1541],
    ['회수', 92, -ph / 2 + 24, 1542],
    ['04', -92, -ph / 2 + 58, 1543],
    ['3', 92, -ph / 2 + 58, 1544],
    ['05', -92, -ph / 2 + 92, 1545],
    ['2', 92, -ph / 2 + 92, 1546],
    ['06', -92, -ph / 2 + 126, 1547],
    ['3', 92, -ph / 2 + 126, 1548],
  ];
  g.fillStyle = 'rgba(8,10,17,0.92)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [txt, cx, cy, seed] of cells) {
    g.save();
    g.translate(cx + jit(seed, 2, 3), cy + jit(seed, 3, 2.4));
    g.rotate(jit(seed, 1, 0.1));
    g.font = font(15, 'bold');
    g.fillText(txt, 0, 0);
    g.restore();
  }
  g.restore();

  // 벽에 붙인 테이프 두 조각. 모서리에 비스듬히 걸쳐야 "붙였다"가 된다.
  for (const [tx, ty, rot] of [
    [px - pw / 2 + 10, py - ph / 2 + 6, 0.72],
    [px + pw / 2 - 10, py + ph / 2 - 6, 0.72],
  ] as [number, number, number][]) {
    g.save();
    g.fillStyle = 'rgba(214,224,255,0.18)';
    g.translate(tx, ty);
    g.rotate(rot);
    g.fillRect(-16, -7, 32, 14);
    g.restore();
  }

  screentone(g, r.x, r.y, r.w, r.h, 0.18, '#8fa4d8', 0.14, 0.6, 5);
  narration(g, r, '나오라고 열어 둔 거였어?', 'br', t, 1551);
}

// ── 막간 2 — 선반 ──────────────────────────────────────────────────────────

/** 선반 칸마다 멈춘 자세. 같은 포즈가 줄줄이 서면 사람이 아니라 무늬가 된다. */
const SHELF_POSES: readonly Pose[] = [
  POSES.standing,
  POSES.reaching,
  POSES.slumped,
  POSES.turning,
  POSES.sitting,
];

/** 컷 1 — 넓고 낮은 방. 선반이 줄지어 있고 칸마다 멈춘 실루엣이 하나씩. */
function i2cut1(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  if (!sceneBackdrop(g, r, 'shelfRoom')) {
    const bg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#0a0e1c');
    bg.addColorStop(1, '#05070f');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
  }

  // 천장이 낮다 — 등이 화면 위쪽에 바짝 붙는다.
  lamp(g, r.x + 210, r.y + 12, 96, r.h, 250, breathe(t, 0.4));
  lamp(g, r.x + 660, r.y + 12, 96, r.h, 250, breathe(t + 50, 0.4));

  // 선반 3단. 뒤 → 앞 순으로 커진다. 칸은 화면 양옆 밖에서 시작해 밖으로 나간다.
  const rows: [number, number, number, number][] = [
    // [선반판 y, 칸 높이, 칸 폭, 알파]
    [r.y + r.h * 0.5, 40, 76, 0.3],
    [r.y + r.h * 0.74, 54, 100, 0.42],
    [r.y + r.h * 1.02, 70, 132, 0.56],
  ];

  for (let ri = 0; ri < rows.length; ri++) {
    const [sy, fh, cw, al] = rows[ri]!;

    // 칸 안쪽(어두운 뒤판) — 실루엣이 얹힐 바탕.
    g.save();
    g.fillStyle = 'rgba(3,5,11,0.72)';
    g.fillRect(r.x - 40, sy - fh - 12, r.w + 80, fh + 12);
    g.restore();

    // 선반판
    g.save();
    g.strokeStyle = withAlpha(C_INK, 0.42);
    inkStroke(
      g,
      [
        [r.x - 40, sy],
        [r.x + r.w + 40, sy + jit(2100 + ri, 0, 2)],
      ],
      2.2,
      2100 + ri,
    );
    g.restore();

    // 칸막이 + 각 칸의 실루엣
    const start = r.x - 40 - (ri * 26) % cw;
    let idx = 0;
    for (let cx = start; cx < r.x + r.w + 40; cx += cw, idx++) {
      g.save();
      g.globalAlpha = 0.28;
      g.strokeStyle = C_INK;
      inkStroke(
        g,
        [
          [cx, sy],
          [cx + jit(2200 + ri, idx, 2), sy - fh - 10],
        ],
        1.5,
        2200 + ri * 40 + idx,
      );
      g.restore();

      const pick = Math.floor(hash01(2300 + ri, idx) * SHELF_POSES.length);
      const slot = 1 + Math.floor(hash01(2400 + ri, idx) * 3);
      const col = C_SLOT[Math.min(3, slot)]!;
      drawFigure(g, cx + cw * 0.52, sy - 2, fh, SHELF_POSES[Math.min(SHELF_POSES.length - 1, pick)]!, {
        color: col,
        alpha: al,
        inkSeed: 2500 + ri * 40 + idx,
        style: 'silhouette',
      });
    }
  }

  toneGradient(g, r, 5, 0.34, 0.06, '#38466f', 0.5);
  screentone(g, r.x, r.y, r.w, r.h, 0.16, '#8fa4d8', 0.12, 0.6, 5);
}

/** 컷 2 — 그중 하나가 내가 조금 전에 취한 자세 그대로 멈춰 있다. */
function i2cut2(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#070a14';
  g.fillRect(r.x, r.y, r.w, r.h);

  const cx = r.x + r.w * 0.42;
  const cellW = 250;
  const sy = r.y + r.h - 46;
  const cellTop = r.y + 26;

  // 칸 안쪽 뒤판
  g.fillStyle = '#0c1122';
  g.fillRect(cx - cellW / 2, cellTop, cellW, sy - cellTop);

  // 옆 칸이 살짝 걸린다 — 이게 하나가 아니라는 표시.
  g.save();
  g.globalAlpha = 0.5;
  g.fillStyle = '#090d1b';
  g.fillRect(r.x, cellTop, cx - cellW / 2 - 22, sy - cellTop);
  g.fillRect(cx + cellW / 2 + 22, cellTop, r.x + r.w - (cx + cellW / 2 + 22), sy - cellTop);
  g.restore();

  // 실루엣이 서 있는 자리에 슬롯색 빛을 먼저 깐다.
  backLight(g, cx, sy, 184, 0.3, C_SLOT[1]!);

  // 선반판 · 칸막이 · 윗판
  g.save();
  g.strokeStyle = withAlpha(C_INK, 0.55);
  inkStroke(
    g,
    [
      [r.x + 6, sy],
      [r.x + r.w - 6, sy + jit(2601, 0, 2)],
    ],
    2.8,
    2601,
  );
  inkStroke(
    g,
    [
      [r.x + 6, cellTop],
      [r.x + r.w - 6, cellTop + jit(2602, 0, 2)],
    ],
    2.2,
    2602,
  );
  g.globalAlpha = 0.65;
  inkStroke(
    g,
    [
      [cx - cellW / 2, sy],
      [cx - cellW / 2 + jit(2603, 0, 3), cellTop],
    ],
    2,
    2603,
  );
  inkStroke(
    g,
    [
      [cx + cellW / 2, sy],
      [cx + cellW / 2 + jit(2604, 0, 3), cellTop],
    ],
    2,
    2604,
  );
  g.restore();

  // **그 자세**. 인트로 칸 4~5 에서 뒤에 남은 몸이 취하던 바로 그 포즈다.
  drawFigure(g, cx, sy - 2, 184, POSES.reaching, {
    color: C_SLOT[1]!,
    alpha: 0.7,
    outline: C_SLOT[1]!,
    inkSeed: 51,
    style: 'silhouette',
  });

  // 발밑 앵커 링 — "이 칸에 묶여 있다".
  g.save();
  g.translate(cx, sy + 3);
  g.scale(1, 0.22);
  g.strokeStyle = C_SLOT[1]!;
  g.globalAlpha = 0.26 + Math.sin(t * 0.1) * 0.06;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(0, 0, 44, 0, TAU);
  g.stroke();
  g.restore();

  toneGradient(g, r, 4, 0.08, 0.36, '#2b3660', 0.55);
  captionBox(g, r, '저거, 아까 내가 한 자세잖아.', 'tl', t, 2611);
  narration(g, r, '여기 다 모아 놨네. 내가 버리고 온 것들.', 'br', t, 2612);
}

// ── 막간 3 — 셈 ────────────────────────────────────────────────────────────

/** 컷 1 — 벽의 금 클로즈업. 넷씩 묶인 무더기가 화면 밖까지 이어진다. */
function i3cut1(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  if (!sceneBackdrop(g, r, 'wallCrack')) concrete(g, r, 931);

  // 네 줄 전부 칸 **밖에서 시작해 밖으로 나간다**. 끝이 보이면 이 컷은 실패다.
  // 한 묶음 폭 = 4획(22px) + 묶음 간격(58px) = 146px. 9묶음이면 1314px 로
  // 칸 폭(892) 을 양쪽으로 넉넉히 넘긴다.
  const rowY = [r.y + 14, r.y + 86, r.y + 158, r.y + 230];
  for (let i = 0; i < rowY.length; i++) {
    const y = rowY[i]!;
    // 줄 0 은 인트로 칸 2 윗줄과 **같은 시드**다 — 같은 벽의 같은 금이다.
    const seed = TALLY_SEED + i;
    const x0 = r.x - 96 - i * 17;
    drawTally(g, x0 + 3, y + 3, 58, 22, 58, 9, '#05070e', 2.1, 0.55, seed);
    drawTally(g, x0, y, 58, 22, 58, 9, C_INK, 2.9, 0.92, seed);
  }

  screentone(g, r.x, r.y, r.w, r.h, 0.18, '#8fa4d8', 0.16, 0.6, 5);
  captionBox(g, r, '넷씩... 이게 대체 몇이야.', 'tl', t, 3101);
}

/** 컷 2 — 무더기 아래에 작게 적힌 일련번호. 인쇄체다. 손글씨가 아니다. */
function i3cut2(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  if (!sceneBackdrop(g, r, 'groupedCore')) concrete(g, r, 934);

  // 위 줄은 칸 밖으로 잘려 나가고(무더기는 계속된다), 아래 줄은 끝까지 보인다.
  // 일련번호는 **그 아래 줄 바로 밑**에 붙어야 "무더기 아래에 적혔다"가 된다.
  drawTally(g, r.x - 28 + 3, r.y - 52 + 3, 72, 22, 58, 6, '#05070e', 2.1, 0.5, TALLY_SEED + 2);
  drawTally(g, r.x - 28, r.y - 52, 72, 22, 58, 6, C_INK, 2.9, 0.88, TALLY_SEED + 2);
  drawTally(g, r.x - 8 + 3, r.y + 34 + 3, 62, 22, 58, 5, '#05070e', 2.1, 0.5, TALLY_SEED);
  drawTally(g, r.x - 8, r.y + 34, 62, 22, 58, 5, C_INK, 2.9, 0.92, TALLY_SEED);

  // 아래 줄 첫 묶음(4획 = 66px) 아래에 작게. 가운데 정렬이 아니라 **금에 딸린** 위치다.
  const cx = r.x + 26;
  const by = r.y + 132;

  // 인쇄 자국: 곧은 밑줄과 양끝 맞춤표. 전부 fillRect 다 — 흔들리는 획이 하나도 없다.
  const ink = smooth(clamp01((t - 26) / 30));
  printedLine(g, cx + 58, by, '0417-B-1177', 14, 3.4, ink);
  g.save();
  g.globalAlpha = ink * 0.5;
  g.fillStyle = '#dfe7ff';
  g.fillRect(cx - 12, by + 7, 140, 1);
  g.fillRect(cx - 12, by + 3, 1, 6);
  g.fillRect(cx + 127, by + 3, 1, 6);
  g.restore();

  screentone(g, r.x, r.y, r.w, r.h, 0.2, '#8fa4d8', 0.15, 0.6, 5);
  narration(g, r, '내가 센 게 아니었구나. 세어진 거였고.', 'br', t, 3201);
}

// ── 막간 4 — 마지막 문 ─────────────────────────────────────────────────────

/** 컷 1 — 바깥문 앞. 문 너머는 아직 안 보인다. */
function i4cut1(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  if (!sceneBackdrop(g, r, 'finalDoor')) {
    const bg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#060911');
    bg.addColorStop(1, '#0c1020');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
  }

  const power = breathe(t, 0.5);
  const fy = r.y + r.h - 54;

  lamp(g, r.x + r.w * 0.5, r.y + 22, 52, r.h, 190, power);
  floorLight(g, r, fy, r.x + r.w * 0.5, 250, power);

  // 세로로 긴 칸 = 문이 크다. 이 칸의 크기 자체가 연출이다.
  const dw = 196;
  const dx = r.x + 104;
  const dTop = r.y + 96;
  drawDoor(g, dx, dTop, dw, fy - dTop, 4101, false);

  // 인물은 작게. 문 앞에 서서 아직 손을 대지 않았다.
  backLight(g, r.x + 128, fy, 176, 0.24);
  drawFigure(g, r.x + 128, fy, 176, POSES.standing, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 61,
  });

  toneGradient(g, r, 6, 0.08, 0.42, '#2c3760', 0.55);
  captionBox(g, r, '여기서 나가면 끝이야.', 'bl', t, 4111);
}

/** 컷 2 — 뒤를 돌아본다. 지나온 복도에 내가 남긴 것들이 서 있다. */
function i4cut2(g: CanvasRenderingContext2D, r: Rect, t: number): void {
  g.fillStyle = '#080b16';
  g.fillRect(r.x, r.y, r.w, r.h);

  const fy = r.y + r.h - 34;
  const vx = r.x + r.w * 0.24;
  const vy = r.y + r.h * 0.42;

  // 복도 원근선. 소실점까지 다 따라가면 터널이 되므로 절반만 간다.
  g.save();
  g.globalAlpha = 0.3;
  g.strokeStyle = '#2a3357';
  g.lineWidth = 1;
  for (const [sx, sy] of [
    [r.x + r.w, r.y + 6],
    [r.x + r.w, fy],
    [r.x + r.w, r.y + r.h],
  ] as [number, number][]) {
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + (vx - sx) * 0.92, sy + (vy - sy) * 0.92);
    g.stroke();
  }
  g.restore();

  lamp(g, r.x + r.w * 0.66, r.y + 16, 34, r.h * 0.8, 96, breathe(t, 0.5));
  lamp(g, r.x + r.w * 0.38, r.y + 40, 20, r.h * 0.5, 56, breathe(t + 33, 0.36));
  floorLight(g, r, fy, r.x + r.w * 0.6, 210, 0.6);

  // 남기고 온 것들. 뒤로 갈수록 작고 옅다 — 거리가 곧 이 컷의 문장이다.
  const ghosts: [number, number, number, number, number][] = [
    // [x, 바닥 y, 키, 슬롯, 포즈 인덱스]
    [r.x + r.w * 0.6, fy - 6, 132, 1, 0],
    [r.x + r.w * 0.45, fy - 34, 100, 2, 2],
    [r.x + r.w * 0.34, fy - 56, 78, 3, 3],
  ];
  for (let i = 0; i < ghosts.length; i++) {
    const [gx, gy, gh, slot, pose] = ghosts[i]!;
    const col = C_SLOT[slot]!;
    const a = clamp01((t - 20 - i * 16) / 26);
    if (a <= 0) continue;
    backLight(g, gx, gy, gh, a * 0.2, col);
    drawFigure(g, gx, gy, gh, SHELF_POSES[pose]!, {
      color: col,
      alpha: a * (0.62 - i * 0.1),
      outline: col,
      inkSeed: 4200 + i,
      style: 'silhouette',
    });
  }

  // 나: 앞쪽에서 몸을 틀어 복도를 본다. 복도가 왼쪽이므로 뒤집지 않는다.
  backLight(g, r.x + r.w - 92, fy + 10, 214, 0.26);
  drawFigure(g, r.x + r.w - 92, fy + 10, 214, POSES.turning, {
    color: C_FIG,
    alpha: 1,
    outline: C_I_RING,
    inkSeed: 33,
  });

  toneGradient(g, r, 5, 0.06, 0.38, '#2b3660', 0.55);
  narration(g, r, '...전부 데리고 나갈 수는 없나.', 'br', t, 4211);
}

// ── 막간 조립 ──────────────────────────────────────────────────────────────

type Paint = (g: CanvasRenderingContext2D, r: Rect, t: number) => void;

interface Interlude {
  /** 칸 둘. 배치가 막간마다 다르다 — 같은 틀이 네 번 나오면 광고가 된다. */
  panels: readonly [Rect, Rect];
  paint: readonly [Paint, Paint];
}

const INTERLUDES: readonly Interlude[] = [
  // 1 — 문 바깥쪽. 위: 미디엄 와이드(복도), 아래: 익스트림 클로즈업(종이).
  {
    panels: [
      { x: 34, y: 30, w: 892, h: 318 },
      { x: 34, y: 362, w: 892, h: 208 },
    ],
    paint: [i1cut1, i1cut2],
  },
  // 2 — 선반. 위: 익스트림 와이드(방 전체), 아래: 오른쪽으로 물린 클로즈업(한 칸).
  {
    panels: [
      { x: 34, y: 34, w: 892, h: 258 },
      { x: 198, y: 306, w: 728, h: 264 },
    ],
    paint: [i2cut1, i2cut2],
  },
  // 3 — 셈. 위: 익스트림 클로즈업(벽 전면), 아래: 가운데로 파고든 작은 칸(일련번호).
  {
    panels: [
      { x: 34, y: 30, w: 892, h: 300 },
      { x: 236, y: 352, w: 492, h: 218 },
    ],
    paint: [i3cut1, i3cut2],
  },
  // 4 — 마지막 문. 왼쪽: 세로로 긴 롱샷(문), 오른쪽: 아래로 내려앉은 칸(복도).
  {
    panels: [
      { x: 34, y: 30, w: 392, h: 540 },
      { x: 442, y: 172, w: 484, h: 398 },
    ],
    paint: [i4cut1, i4cut2],
  },
];

/** 스캔라인 + 진행 표시 + 스킵 안내. 인트로 오버레이와 같은 자리·같은 결. */
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
  g.fillText(touch ? 'TAP TO SKIP' : 'PRESS ANY KEY TO SKIP', CANVAS_W - 22, CANVAS_H - 10);
  g.restore();
}

/**
 * 막간 한 프레임.
 *
 * 페이지 넘김이 없다 — 두 칸이 한 장 위에서 차례로 잉크로 번진다.
 * `s.id` 가 범위를 벗어나면 아무것도 그리지 않는다(검은 화면이 크래시보다 낫다).
 */
/** 막간 id → 만화 정본 페이지. */
const INTERLUDE_SCENE = ['interlude1', 'interlude2', 'interlude3', 'interlude4'] as const;

/**
 * 만화 정본 막간 페이지를 **칸 하나만큼** 잘라 그린다.
 * 좌표계가 캔버스와 같아(960×600) 잘라 낼 자리와 놓을 자리가 정확히 일치한다.
 *
 * 다만 **잘라 낼 자리는 코드 드로잉의 칸 사각형과 다르다.** 코드 쪽 칸은 컷마다
 * 크기와 들여쓰기가 제각각인데(예: 막간 2 의 아래 칸은 x=198 부터), 만화 정본은
 * 위·아래 두 띠로 전체 폭을 쓴다. 코드 쪽 사각형으로 자르면 만화의 칸 옆구리가
 * 잘려 검은 띠가 남는다. 그래서 만화를 쓸 때는 화면을 반으로 나눈 띠로 연다.
 */
/**
 * 막간 만화의 **실제 칸 좌표** — [막간 id][컷]. 납품본 PNG 에서 실측했다.
 * 화면을 반으로 나눈 띠로 열면 만화의 흰 테두리와 어긋나므로 칸을 그대로 쓴다.
 */
const COMIC_PANELS: readonly (readonly Rect[])[] = [
  // 1 문 바깥쪽 — 위 와이드 / 아래 오른쪽
  [
    { x: 12, y: 11, w: 934, h: 307 },
    { x: 408, y: 329, w: 538, h: 257 },
  ],
  // 2 선반 — 위 와이드 / 아래 오른쪽
  [
    { x: 20, y: 10, w: 919, h: 290 },
    { x: 319, y: 310, w: 620, h: 268 },
  ],
  // 3 셈 — 위 와이드 / 아래 가운데
  [
    { x: 22, y: 12, w: 918, h: 348 },
    { x: 196, y: 376, w: 570, h: 202 },
  ],
  // 4 마지막 문 — 왼쪽 세로 / 오른쪽 아래
  [
    { x: 8, y: 6, w: 337, h: 582 },
    { x: 353, y: 156, w: 599, h: 432 },
  ],
];

function interludeImage(g: CanvasRenderingContext2D, id: number, cut: number): Rect | null {
  const key = INTERLUDE_SCENE[id];
  if (key === undefined) return null;
  const img = sprites.scene(key);
  if (img === undefined) return null;
  const r = COMIC_PANELS[id]?.[cut === 0 ? 0 : 1];
  if (r === undefined) return null;
  g.drawImage(img, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  return r;
}

export function drawInterlude(
  g: CanvasRenderingContext2D,
  s: InterludeState,
  touch = false,
): void {
  const def = INTERLUDES[s.id];
  if (def === undefined) return;

  const tick = Math.min(s.tick, INTERLUDE_TICKS - 1);

  g.fillStyle = C_PAPER;
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);

  for (let i = 0; i < CUT_COUNT; i++) {
    const start = i * CUT_TICKS;
    if (tick < start) break;
    const local = tick - start;
    const p = clamp01(local / REVEAL_TICKS);
    const r = def.panels[i === 0 ? 0 : 1];

    // 만화 정본이 있으면 그 띠를 잘라 쓰고, 없으면 예전 코드 드로잉으로 떨어진다.
    // 잉크 와이프는 **실제로 그린 사각형**을 따라가야 경계가 어긋나지 않는다.
    g.save();
    const band = interludeImage(g, s.id, i);
    const clipR = band ?? r;
    if (band === null) {
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      def.paint[i === 0 ? 0 : 1](g, r, local);
    }
    inkWipe(g, clipR, p, 3700 + s.id * 8 + i);
    g.restore();

    // 손으로 그은 듯한 흰 테두리는 만화를 쓸 때도 그대로 두른다 —
    // 만화책 느낌은 이 선이 만든다. 다만 **만화의 칸 사각형**을 따라 두른다.
    panelBorder(g, clipR, 3100 + s.id * 8 + i, clamp01((p - 0.12) / 0.35));
  }

  drawOverlay(g, tick, touch);
}
