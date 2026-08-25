/**
 * I.MY.ME.MINE — 스프라이트 시트 로더.
 *
 * 이 모듈이 지키는 것은 네 가지다.
 *
 * 1. **시뮬을 한 비트도 건드리지 않는다.** 그림이 늦게 오든 아예 안 오든 판정은
 *    같아야 한다. 그래서 로딩은 비동기고, 준비되지 않은 시트는 `has()` 가 false 를
 *    돌려주며, 호출부는 그때 기존 코드 드로잉으로 떨어진다 (SPEC §4).
 * 2. **런타임에 배율 계산을 하지 않는다.** 원본은 32px 타일을 2배로 그린 64px 셀이라
 *    화면에 놓으려면 절반으로 줄여야 하는데, 매 프레임 0.5배 `drawImage` 를 돌리는
 *    대신 **로드 직후 한 번** 절반 크기 캔버스로 굽는다. 이후 모든 그리기는 1:1 이다.
 * 3. **node 에서 import 해도 죽지 않는다.** 테스트가 `render/hud.ts` 를 부르고
 *    hud 는 renderer 를 부른다. PNG 를 ES 모듈로 import 하면 tsx 가 파싱하다 죽으므로
 *    `new URL(..., import.meta.url)` 로 경로만 만든다 — Vite 는 이 형태를 정적으로
 *    인식해 해시된 에셋 URL 로 바꿔 주고(`base` 도 함께 적용된다), node 는 그냥
 *    파일 URL 문자열로 둔다. `document` 접근은 전부 `load()` 안쪽에만 있다.
 * 4. **실패해도 조용하다.** 이미지 하나가 404 여도 그 시트만 비활성으로 남고
 *    나머지는 그대로 뜬다. 플레이어에게 기술 오류 문구를 보여주지 않는다.
 */

import { DIR_STEPS, TILE_SUB } from '../sim/constants';

// ── 시트 규격 ──────────────────────────────────────────────────────────────

/** 시트 하나의 원본 규격. `cw`/`ch` 는 **원본 셀** 크기(2배 기준)다. */
interface SheetSpec {
  url: string;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

/** 구워 놓은 시트. `cw`/`ch` 는 화면에 그릴 **1배** 셀 크기다. */
interface Baked {
  img: CanvasImageSource;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

/**
 * 스프라이트 아이디. 문자열 리터럴로 묶어 두면 오타가 컴파일에서 걸린다 —
 * 에셋 경로 누락을 테스트로 잡을 수 있는 것도 이 목록 덕분이다.
 */
export type SpriteId =
  | 'flashbang'
  | 'flashbangBoom'
  | 'grate'
  | 'laserEmitter'
  | 'laserBeam'
  | 'powerBus'
  | 'player'
  | 'sentry'
  | 'hound'
  | 'brute'
  | 'watcher'
  | 'core'
  | 'gate'
  | 'exit'
  | 'wallButton'
  | 'plate'
  | 'lever'
  | 'eye'
  | 'crate'
  | 'tileset';

/** 장면 이미지(만화 배경·타이틀). 시트가 아니라 통짜 한 장이다. */
export type SceneId =
  | 'shelfRoom'
  | 'outerDoor'
  | 'wallCrack'
  | 'groupedCore'
  | 'finalDoor'
  | 'titleKey'
  // ── 만화 정본 페이지 (글자가 이미지에 구워져 있다) ──
  | 'introPage1'
  | 'introPage2'
  | 'introPage3'
  | 'interlude1'
  | 'interlude2'
  | 'interlude3'
  | 'interlude4';

/**
 * 에셋 URL.
 *
 * **경로는 반드시 리터럴이어야 한다.** `new URL(\`...${변수}\`, import.meta.url)`
 * 처럼 템플릿을 쓰면 Vite 가 정적으로 못 읽어 번들에 PNG 를 넣지 않고, 그대로
 * 배포하면 전부 404 가 난다(실제로 그렇게 만들었다가 dist 에 PNG 가 한 장도
 * 안 담기고 파이썬 스크립트만 딸려 나왔다). 그래서 지루해도 한 줄씩 적는다.
 * node 에서는 그냥 파일 URL 이 되므로 테스트에서도 안전하다.
 */
const A1 = new URL('../../seongwoo-todo/assets/generated/a-group/A1-flashbang.png', import.meta.url).href;
const A2 = new URL('../../seongwoo-todo/assets/generated/a-group/A2-flashbang-detonation.png', import.meta.url).href;
const A3 = new URL('../../seongwoo-todo/assets/generated/a-group/A3-grate.png', import.meta.url).href;
const A4E = new URL('../../seongwoo-todo/assets/generated/a-group/A4-laser-emitter.png', import.meta.url).href;
const A4B = new URL('../../seongwoo-todo/assets/generated/a-group/A4-laser-beam.png', import.meta.url).href;
const A5 = new URL('../../seongwoo-todo/assets/generated/a-group/A5-power-bus.png', import.meta.url).href;

const B1 = new URL('../../seongwoo-todo/assets/generated/b-group/B1-player.png', import.meta.url).href;
const B2S = new URL('../../seongwoo-todo/assets/generated/b-group/B2-sentry.png', import.meta.url).href;
const B2H = new URL('../../seongwoo-todo/assets/generated/b-group/B2-hound.png', import.meta.url).href;
const B2B = new URL('../../seongwoo-todo/assets/generated/b-group/B2-brute.png', import.meta.url).href;
const B2W = new URL('../../seongwoo-todo/assets/generated/b-group/B2-watcher.png', import.meta.url).href;
const B3 = new URL('../../seongwoo-todo/assets/generated/b-group/B3-core.png', import.meta.url).href;
const B4 = new URL('../../seongwoo-todo/assets/generated/b-group/B4-gate.png', import.meta.url).href;
const B5 = new URL('../../seongwoo-todo/assets/generated/b-group/B5-exit.png', import.meta.url).href;
const B6 = new URL('../../seongwoo-todo/assets/generated/b-group/B6-wall-button.png', import.meta.url).href;
const B7 = new URL('../../seongwoo-todo/assets/generated/b-group/B7-pressure-plate.png', import.meta.url).href;
const B8 = new URL('../../seongwoo-todo/assets/generated/b-group/B8-lever.png', import.meta.url).href;
const B9 = new URL('../../seongwoo-todo/assets/generated/b-group/B9-eye.png', import.meta.url).href;
const B10 = new URL('../../seongwoo-todo/assets/generated/b-group/B10-crate.png', import.meta.url).href;
const B11 = new URL('../../seongwoo-todo/assets/generated/b-group/B11-tileset.png', import.meta.url).href;

const C1_01 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C1-01-shelf-room.png', import.meta.url).href;
const C1_02 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C1-02-outer-door.png', import.meta.url).href;
const C1_03 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C1-03-wall-crack.png', import.meta.url).href;
const C1_04 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C1-04-grouped-core.png', import.meta.url).href;
const C1_05 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C1-05-final-door.png', import.meta.url).href;
const C2 = new URL('../../seongwoo-todo/assets/generated/c-group/delivery/C2-title-key-visual.png', import.meta.url).href;

// 만화 정본 페이지. 원본(comic+comment/)은 장당 1MB 라, c-group 과 같은 방식으로
// 그레이스케일 납품본을 쓴다 (`scripts/derive-comic.sh`). 크기는 이미 960×600 이라
// 줄이지 않았고 재인코딩만 했다.
const CM1 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/INTRO-PAGE-1.png', import.meta.url).href;
const CM2 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/INTRO-PAGE-2.png', import.meta.url).href;
const CM3 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/INTRO-PAGE-3.png', import.meta.url).href;
const CI1 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/M1-PAGE.png', import.meta.url).href;
const CI2 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/M2-PAGE.png', import.meta.url).href;
const CI3 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/M3-PAGE.png', import.meta.url).href;
const CI4 = new URL('../../seongwoo-todo/assets/generated/comic+comment/delivery/M4-PAGE.png', import.meta.url).href;

/**
 * 시트 규격표. 숫자는 전부 `seongwoo-todo/assets/generated/README.md` 와
 * 실제 PNG 크기를 대조해 확인한 값이다 (예: B1 512×256 = 8열×4행×64px).
 */
const SHEETS: Readonly<Record<SpriteId, SheetSpec>> = {
  // ── A그룹 — 지금까지 화면에 없던 것들 ──
  flashbang: { url: A1, cols: 4, rows: 1, cw: 64, ch: 64 },
  flashbangBoom: {
    url: A2,
    cols: 8,
    rows: 1,
    cw: 128,
    ch: 128,
  },
  grate: { url: A3, cols: 5, rows: 1, cw: 64, ch: 64 },
  laserEmitter: { url: A4E, cols: 2, rows: 1, cw: 64, ch: 64 },
  laserBeam: { url: A4B, cols: 4, rows: 1, cw: 64, ch: 16 },
  powerBus: { url: A5, cols: 6, rows: 1, cw: 64, ch: 64 },

  // ── B그룹 — 코드 드로잉 교체 ──
  player: { url: B1, cols: 8, rows: 4, cw: 64, ch: 64 },
  sentry: { url: B2S, cols: 8, rows: 4, cw: 64, ch: 64 },
  hound: { url: B2H, cols: 8, rows: 4, cw: 64, ch: 64 },
  brute: { url: B2B, cols: 8, rows: 4, cw: 64, ch: 64 },
  watcher: { url: B2W, cols: 8, rows: 4, cw: 64, ch: 64 },
  core: { url: B3, cols: 8, rows: 1, cw: 64, ch: 64 },
  gate: { url: B4, cols: 4, rows: 1, cw: 64, ch: 64 },
  exit: { url: B5, cols: 4, rows: 1, cw: 64, ch: 64 },
  wallButton: { url: B6, cols: 3, rows: 1, cw: 64, ch: 64 },
  plate: { url: B7, cols: 2, rows: 1, cw: 64, ch: 64 },
  lever: { url: B8, cols: 2, rows: 1, cw: 64, ch: 64 },
  eye: { url: B9, cols: 9, rows: 1, cw: 64, ch: 64 },
  crate: { url: B10, cols: 3, rows: 1, cw: 64, ch: 64 },
  tileset: { url: B11, cols: 3, rows: 4, cw: 64, ch: 64 },
};

/**
 * 장면 이미지. 원본(1536×1024, 장당 2.5MB)을 그대로 실으면 첫 화면까지 14MB 를
 * 받아야 해서, `scripts/derive-scenes.sh` 로 만든 **납품 크기 파생본**을 쓴다.
 * 원본은 `c-group/` 에 그대로 남아 있고 파생본만 `c-group/delivery/` 에 있다.
 */
const SCENES: Readonly<Record<SceneId, string>> = {
  shelfRoom: C1_01,
  outerDoor: C1_02,
  wallCrack: C1_03,
  groupedCore: C1_04,
  finalDoor: C1_05,
  titleKey: C2,
  introPage1: CM1,
  introPage2: CM2,
  introPage3: CM3,
  interlude1: CI1,
  interlude2: CI2,
  interlude3: CI3,
  interlude4: CI4,
};

/**
 * 매니페스트에 적힌 모든 에셋 URL. **테스트 전용 관찰창**이다 —
 * 경로 오타나 파일 누락은 브라우저에서 조용한 404 로만 드러나므로
 * (그 시트만 안 뜨고 게임은 계속 돈다) 빌드 전에 여기서 잡는다.
 */
export function assetUrls(): { id: string; url: string }[] {
  const out: { id: string; url: string }[] = [];
  for (const key of Object.keys(SHEETS) as SpriteId[]) out.push({ id: key, url: SHEETS[key].url });
  for (const key of Object.keys(SCENES) as SceneId[]) out.push({ id: key, url: SCENES[key] });
  return out;
}

/** 시트 규격(원본 셀 기준). 테스트가 실제 PNG 크기와 대조한다. */
export function sheetSpec(id: SpriteId): { cols: number; rows: number; cw: number; ch: number } {
  const s = SHEETS[id];
  return { cols: s.cols, rows: s.rows, cw: s.cw, ch: s.ch };
}

/** 매니페스트에 있는 모든 시트 아이디. */
export function sheetIds(): SpriteId[] {
  return Object.keys(SHEETS) as SpriteId[];
}

// ── 상태 ───────────────────────────────────────────────────────────────────

const baked = new Map<SpriteId, Baked>();
const scenes = new Map<SceneId, CanvasImageSource>();
/** 색을 입혀 구워 둔 잔상 시트. 키는 `${id}|${color}|${alpha}`. */
const tinted = new Map<string, CanvasImageSource>();
let started = false;

/** 이 시트를 지금 그릴 수 있는가. false 면 호출부는 코드 드로잉으로 떨어진다. */
export function has(id: SpriteId): boolean {
  return baked.has(id);
}

/** 이 장면 이미지를 지금 그릴 수 있는가. */
export function hasScene(id: SceneId): boolean {
  return scenes.has(id);
}

/** 구워 둔 시트의 1배 셀 크기. 없으면 undefined. */
export function cellOf(id: SpriteId): { w: number; h: number } | undefined {
  const b = baked.get(id);
  return b === undefined ? undefined : { w: b.cw, h: b.ch };
}

/** 장면 이미지 원본. 그리는 쪽에서 비율을 정한다. */
export function scene(id: SceneId): CanvasImageSource | undefined {
  return scenes.get(id);
}

// ── 로딩 ───────────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * 원본 시트를 절반 크기로 굽는다.
 *
 * 원본은 32px 타일을 2배로 그린 것이라(README 의 "render at 2x in 64x64 cells"),
 * 절반으로 줄이면 제작 의도대로 1타일 = 32px 이 된다. `imageSmoothingEnabled`
 * 를 끄고 줄이므로 이웃 픽셀을 섞지 않는다 — 흐려지지 않고 또렷하게 남는다.
 */
function bake(img: HTMLImageElement, spec: SheetSpec): Baked | undefined {
  const w = Math.round(img.naturalWidth / 2);
  const h = Math.round(img.naturalHeight / 2);
  const c = makeCanvas(w, h);
  if (c === undefined) return undefined;
  const g = c.getContext('2d');
  if (g === null) return undefined;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, h);
  return { img: c, cols: spec.cols, rows: spec.rows, cw: spec.cw / 2, ch: spec.ch / 2 };
}

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(undefined);
      return;
    }
    const img = new Image();
    // 실패는 조용히 넘긴다 — 그 시트만 코드 드로잉으로 남고 게임은 계속 돈다.
    img.onload = (): void => resolve(img);
    img.onerror = (): void => resolve(undefined);
    img.src = url;
  });
}

/**
 * 모든 에셋을 한 번만 불러온다. 게임 루프는 이걸 기다리지 않는다 —
 * 준비되기 전 프레임은 기존 코드 드로잉이 그대로 채우므로 빈 화면이 없다.
 */
export function load(): void {
  if (started) return;
  started = true;
  if (typeof document === 'undefined') return;

  for (const key of Object.keys(SHEETS) as SpriteId[]) {
    const spec = SHEETS[key];
    void loadImage(spec.url).then((img) => {
      if (img === undefined) return;
      const b = bake(img, spec);
      if (b !== undefined) baked.set(key, b);
    });
  }
  for (const key of Object.keys(SCENES) as SceneId[]) {
    void loadImage(SCENES[key]).then((img) => {
      if (img !== undefined) scenes.set(key, img);
    });
  }
}

// ── 그리기 ─────────────────────────────────────────────────────────────────

/**
 * 시트의 한 칸을 그린다. `dx`/`dy` 는 **좌상단**이고 정수로 반올림된다 —
 * 서브픽셀에 놓으면 pixelated 캔버스에서 가장자리가 흔들린다.
 *
 * `col`/`row` 는 범위를 벗어나면 잘라 낸다. 프레임 계산이 한 칸 넘쳐도 시트
 * 바깥(빈 픽셀이나 옆 프레임)이 새어 나오지 않는다.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  id: SpriteId,
  col: number,
  row: number,
  dx: number,
  dy: number,
  scale = 1,
): boolean {
  const b = baked.get(id);
  if (b === undefined) return false;
  const c = Math.max(0, Math.min(b.cols - 1, Math.floor(col)));
  const r = Math.max(0, Math.min(b.rows - 1, Math.floor(row)));
  ctx.drawImage(
    b.img,
    c * b.cw,
    r * b.ch,
    b.cw,
    b.ch,
    Math.round(dx),
    Math.round(dy),
    b.cw * scale,
    b.ch * scale,
  );
  return true;
}

/** 셀 가운데를 `(cx, cy)` 에 맞춰 그린다. 대부분의 장치가 이 앵커를 쓴다. */
export function drawCentered(
  ctx: CanvasRenderingContext2D,
  id: SpriteId,
  col: number,
  row: number,
  cx: number,
  cy: number,
  scale = 1,
): boolean {
  const b = baked.get(id);
  if (b === undefined) return false;
  return draw(ctx, id, col, row, cx - (b.cw * scale) / 2, cy - (b.ch * scale) / 2, scale);
}

/**
 * 색을 입힌 시트를 만든다 — 잔상 3종(MY/ME/MINE)용.
 *
 * 같은 시트를 4벌 만들지 않고 `source-atop` 으로 원본 위에 색을 덮는다.
 * 알파는 그리는 쪽에서 `globalAlpha` 로 주지 않고 여기서 함께 구워 둔다 —
 * 매 프레임 합성 상태를 바꾸는 것보다 싸고, 세 잔상이 겹쳐도 일정하다.
 */
function tintSheet(id: SpriteId, color: string, alpha: number): CanvasImageSource | undefined {
  const key = `${id}|${color}|${alpha}`;
  const cached = tinted.get(key);
  if (cached !== undefined) return cached;
  const b = baked.get(id);
  if (b === undefined) return undefined;
  const w = b.cols * b.cw;
  const h = b.rows * b.ch;
  const c = makeCanvas(w, h);
  if (c === undefined) return undefined;
  const g = c.getContext('2d');
  if (g === null) return undefined;
  g.imageSmoothingEnabled = false;
  g.drawImage(b.img, 0, 0);
  // 실루엣 안쪽만 색을 먹인다. 바깥 투명 픽셀은 건드리지 않는다.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.fillRect(0, 0, w, h);
  // 전체 알파는 마지막에 한 번. destination-in 이라 실루엣 모양은 그대로다.
  g.globalCompositeOperation = 'destination-in';
  g.globalAlpha = alpha;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  tinted.set(key, c);
  return c;
}

/** 색 입힌 시트의 한 칸을 셀 가운데 기준으로 그린다. */
export function drawTinted(
  ctx: CanvasRenderingContext2D,
  id: SpriteId,
  col: number,
  row: number,
  cx: number,
  cy: number,
  color: string,
  alpha: number,
): boolean {
  const b = baked.get(id);
  if (b === undefined) return false;
  const sheet = tintSheet(id, color, alpha);
  if (sheet === undefined) return false;
  const c = Math.max(0, Math.min(b.cols - 1, Math.floor(col)));
  const r = Math.max(0, Math.min(b.rows - 1, Math.floor(row)));
  ctx.drawImage(
    sheet,
    c * b.cw,
    r * b.ch,
    b.cw,
    b.ch,
    Math.round(cx - b.cw / 2),
    Math.round(cy - b.ch / 2),
    b.cw,
    b.ch,
  );
  return true;
}

// ── 프레임 선택 ────────────────────────────────────────────────────────────

/**
 * `facing`(0..DIR_STEPS-1, 0 = +X, 시계방향) 을 4방향 보행 시트의 **행**으로
 * 바꾼다. 시트 행 순서는 아래·왼쪽·오른쪽·위 (README 의 B1 규격).
 *
 * 화면 Y 가 아래로 자라므로 시계방향은 오른쪽 → 아래 → 왼쪽 → 위 순이다.
 * 경계는 45° 대각이고 `facing` 은 정수라, 같은 값이 항상 같은 행을 준다 —
 * 방향이 바뀌는 순간 스프라이트가 두 행 사이에서 떨리지 않는다.
 */
export function rowOfFacing(facing: number): number {
  const q = DIR_STEPS / 8; // 45° = 8
  const f = ((Math.round(facing) % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
  if (f >= q && f < q * 3) return 0; // 아래 (+Y)
  if (f >= q * 3 && f < q * 5) return 1; // 왼쪽 (−X)
  if (f >= q * 5 && f < q * 7) return 3; // 위 (−Y)
  return 2; // 오른쪽 (+X)
}

/**
 * 이동 거리로 보행 프레임을 고른다. 시간이 아니라 **거리** 기준이라
 * 걷기와 달리기의 발놀림이 저절로 달라지고, 멈추면 프레임도 멈춘다.
 * (`Shift` 달리기는 832/틱, 걷기는 512/틱 — 같은 시간에 더 많이 넘어간다.)
 *
 * `moving` 이 false 면 대표 정지 프레임(0번, contact 자세)을 준다.
 */
export function walkFrame(distSub: number, moving: boolean, cols = 8): number {
  if (!moving) return 0;
  // 한 타일에 한 사이클. 8프레임이면 1/8타일마다 한 칸 넘어간다.
  const per = Math.max(1, Math.round(TILE_SUB / cols));
  return Math.floor(Math.max(0, distSub) / per) % cols;
}
