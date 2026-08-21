/**
 * 환경 단서 — 방 안에 남아 있는 **읽을 수 있는 종이와 낙서**.
 *
 * 서사를 강제하지 않는 채널이다. 건너뛰는 사람은 몰라도 되고, 찾는 사람은 더 알게 된다.
 * 문구는 전부 `STORY.md` §5 에서 **한 글자도 바꾸지 않고** 옮겼다 — 이 파일의
 * `NOTES_BY_STAGE` 가 그 문구의 코드 쪽 유일한 사본이며, `tests/notes.test.ts` 가
 * §5 목록과 집합이 같은지 대조한다.
 *
 * ## 이 파일이 지키는 한 가지 불변
 *
 * **단서는 시뮬레이션에 존재하지 않는다.** `SimState` 에 필드가 없고, 여기 있는 어떤
 * 함수도 `SimState` 를 쓰지 않는다(읽기만 한다). 그래서:
 *   - 읽어도 상태 해시가 변하지 않는다 → 테이프·결정론에 무영향.
 *   - `E`(`IN_INTERACT`)는 이미 테이프에 녹화되는 비트지만, 단서 근처에서 눌러도
 *     `world.ts` 의 버튼·레버 판정에는 아무 일도 일어나지 않는다. 이 파일은 그 비트를
 *     **엿볼 뿐**이다(`Body.lastInput`).
 *   - 잔상도 단서 위를 지나가지만 아무 일도 일어나지 않는다. **그게 맞다** —
 *     읽는 것은 지금의 나뿐이고, 과거의 나는 이미 읽었거나 영영 못 읽는다.
 *
 * 배치도 `LevelDef` 가 아니라 여기 레벨 id 로 찾는 별도 맵에 산다. `src/sim/**` 을
 * 한 줄도 건드리지 않고 배치를 데이터로 유지하는 유일한 길이다.
 *
 * 좌표: 시뮬은 서브픽셀 정수, 렌더는 픽셀 실수. 이 파일도 렌더 쪽 규약을 따른다.
 */
import {
  BODY_SUB,
  CANVAS_W,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  SUBPIXEL,
  TILE,
  TILE_SUB,
} from '../sim/constants';
import type { Body, SimState } from '../sim/types';
import { drawKeycap, keycapBox } from './keycap';
import {
  C_BG,
  C_LAMP,
  C_METAL_DARK,
  C_TEXT_DIM,
  font,
  mulHex,
  withAlpha,
} from './palette';

// ── 데이터 ─────────────────────────────────────────────────────────────────

/**
 * 인쇄물인가 손글씨인가. 이 한 비트가 **누가 썼는가**를 가른다:
 * `PRINT` 는 시설이 찍은 것이고, `SCRAWL` 은 나보다 먼저 여기 있었던 누군가가 긁은 것이다.
 * 그림도 문서 패널도 이 값 하나로 갈린다.
 */
export type NoteKind = 'PRINT' | 'SCRAWL';

export interface NoteDef {
  /** 안정적인 식별자. `localStorage` 의 "읽음" 표시 키이기도 하다. */
  id: string;
  tx: number;
  ty: number;
  kind: NoteKind;
  /** `STORY.md` §5 의 문구 **원문**. 화면 배치는 이 문자열에서 파생시킨다. */
  text: string;
}

/**
 * 레벨 id → 그 방에 놓인 단서.
 *
 * 배치 규칙(테스트가 강제한다): 바닥 타일이면서 **벽에 붙어** 있고, 1타일 통로가
 * 아니며, 장치·상자·격자·코어·탈출구·순찰 경유지와 겹치지 않고, `E` 로 만지는 장치
 * (버튼·레버·순차 버튼)에서 **2타일 이상** 떨어져 있다. 마지막 조건이 없으면
 * 같은 `E` 키가 두 가지를 뜻하게 되어 프롬프트가 거짓말을 한다.
 */
export const NOTES_BY_STAGE: Record<string, readonly NoteDef[]> = {
  // 1막 — 수용. 아직 아무것도 이상하지 않다. 사무적인 점검표 한 장.
  '01_I': [
    {
      id: 'a1-check',
      tx: 1,
      ty: 3,
      kind: 'PRINT',
      text: '점검표 — 잠금 해제 확인 / 조명 정상 / 대상 각성 확인',
    },
  ],

  // 2막 — 감시. 숫자가 처음 나온다. "손실분 자재 전용"이 무슨 뜻인지는 아직 모른다.
  '05_MY': [
    {
      id: 'a2-batch',
      tx: 1,
      ty: 4,
      kind: 'PRINT',
      text: '배치 기록 — 회수 3. 손실 1. 손실분은 자재로 처리.',
    },
  ],
  '08_MY': [
    {
      id: 'a2-scrawl',
      tx: 11,
      ty: 4,
      kind: 'SCRAWL',
      text: '여기까지 온 건 나만이 아니다',
    },
  ],

  // 3막 — 통제. 코어가 무엇인지가 여기서 갈린다.
  '09_ME': [
    {
      id: 'a3-core',
      tx: 1,
      ty: 8,
      kind: 'PRINT',
      text: '코어 상태 — 축적률 정상. 대상 협조적.',
    },
  ],
  // **이 게임의 핵심 단서.** 서쪽 방에서 복도로 나서는 문(9,5) 바로 옆 벽 —
  // 지나가는 사람 눈에 걸리되 그 한 칸을 막지는 않는 자리다.
  '10_ME': [
    {
      id: 'a3-warn',
      tx: 10,
      ty: 4,
      kind: 'PRINT',
      text: '주의 — 대상이 코어를 인지할 경우 회수량이 급증함. 인지를 막지 말 것.',
    },
  ],

  // 4막 — 경계. 회계가 끝까지 간다. 그리고 먼저 나간 사람의 한 줄.
  '13_MINE': [
    {
      id: 'a4-yield',
      tx: 9,
      ty: 1,
      kind: 'PRINT',
      text: '공정 요약 — 배치당 평균 회수 2.7. 목표 3.0.',
    },
  ],
  '15_MINE_FINAL': [
    {
      id: 'a4-scrawl',
      tx: 11,
      ty: 11,
      kind: 'SCRAWL',
      text: '문은 열려 있었다. 나는 그게 함정인 줄 알았다.',
    },
  ],
};

const NO_NOTES: readonly NoteDef[] = [];

/** 그 방의 단서. 없으면 빈 배열(같은 배열을 재사용한다). */
export function notesFor(levelId: string): readonly NoteDef[] {
  return NOTES_BY_STAGE[levelId] ?? NO_NOTES;
}

/** 전체 목록. 배치·문구 검증용으로 테스트가 순회한다. */
export const ALL_NOTES: readonly NoteDef[] = Object.values(NOTES_BY_STAGE).flat();

// ── 판정 상수 ──────────────────────────────────────────────────────────────

/**
 * 읽을 수 있는 거리. 장치의 `INTERACT_RANGE`(40px)와 **같은 값**이라 손끝의 감각이
 * 버튼·레버와 다르지 않다. 단서는 그 장치들에서 2타일 이상 떨어져 있으므로
 * 같은 사거리를 써도 무엇을 만지는지 헷갈릴 일이 없다.
 */
const READ_RANGE_SUB = 40 * SUBPIXEL;
const READ_RANGE_SUB2 = READ_RANGE_SUB * READ_RANGE_SUB;

const MOVE_BITS = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;

/**
 * 연 직후 이 틱 동안은 이동으로 닫히지 않는다. 걸어가며 `E` 를 누른 사람이
 * 다음 틱에 곧바로 패널을 잃지 않게 하는 유예다 — 없으면 "멈춰 서서" 눌러야만 열린다.
 */
const OPEN_GRACE_TICKS = 8;

// ── 색 ─────────────────────────────────────────────────────────────────────
//
// 새 색을 발명하지 않는다. 전부 `palette.ts` 의 조명·강철 토큰에서 파생시킨다 —
// 종이는 형광등 흰색을 **깎은** 것이고, 긁힌 자국은 그보다 더 깎은 것이다.
// 어느 것도 스스로 빛나지 않는다.

/** 바랜 복사용지. 콘크리트(#4b433a)보다 확실히 밝아 "놓여 있는 물건"으로 읽힌다. */
const C_PAPER = mulHex(C_LAMP, 0.8);
/** 종이 두께와 접힌 모서리의 그늘. */
const C_PAPER_EDGE = mulHex(C_LAMP, 0.5);
/** 인쇄 잉크. 종이 위에서 대비가 가장 큰 값이다. */
const C_INK = C_BG;
/** 콘크리트를 긁어낸 자국. 분필이 아니라 **드러난 골재**라 채도가 없다. */
const C_CHALK = mulHex(C_LAMP, 0.62);

// ── 런타임 상태 (전부 렌더 전용) ───────────────────────────────────────────

interface NoteRuntime {
  /** 지금 방. 바뀌면 열린 패널과 근접 상태를 통째로 버린다. */
  levelId: string;
  /** 펼쳐 놓은 단서. null = 안 읽는 중. */
  openId: string | null;
  /** 사거리 안의 단서. */
  nearId: string | null;
  /** 패널 페이드 0..1. */
  fade: number;
  /** 키캡 프롬프트 페이드 0..1. */
  promptFade: number;
  /** `IN_INTERACT` 엣지 검출용 직전 값. */
  prevInteract: boolean;
  /** 패널을 연 뒤 지난 틱. `OPEN_GRACE_TICKS` 참조. */
  openTicks: number;
  /** 프롬프트가 위아래로 떠 있게 하는 유일한 시간축. */
  frame: number;
}

const rt: NoteRuntime = {
  levelId: '',
  openId: null,
  nearId: null,
  fade: 0,
  promptFade: 0,
  prevInteract: false,
  openTicks: 0,
  frame: 0,
};

// ── 읽음 표시 (localStorage — 실패해도 게임은 죽지 않는다) ─────────────────
//
// 사파리 프라이빗 모드·쿠키 차단 환경에서 `localStorage` 는 **접근만 해도** 예외를
// 던진다. 이미 읽은 단서가 다시 또렷해 보이는 것이 게임이 죽는 것보다 낫다.

const READ_KEY = 'imm.notes';
const readIds = new Set<string>();
let readLoaded = false;

function loadRead(): void {
  if (readLoaded) return;
  readLoaded = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    if (raw === null) return;
    for (const part of raw.split(',')) {
      if (part !== '') readIds.add(part);
    }
  } catch {
    /* 저장소 없음 — 이번 판만 전부 새 단서로 보인다. */
  }
}

function saveRead(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_KEY, [...readIds].join(','));
  } catch {
    /* 위와 같음 */
  }
}

/** 이 단서를 이미 읽었는가. 읽은 것은 흐리게 그린다. */
export function isNoteRead(id: string): boolean {
  loadRead();
  return readIds.has(id);
}

// ── 터치 판정 ──────────────────────────────────────────────────────────────
//
// `main.ts` 는 `(pointer: coarse)` **또는** 첫 터치 이벤트로 터치를 판정하지만,
// 여기서 필요한 것은 "키캡을 그릴까 패드를 그릴까" 하나뿐이라 미디어 쿼리로 충분하다.
// `MediaQueryList` 를 한 번만 만들고 `.matches` 를 매 프레임 읽는다(재질의 없음).

let coarseMq: MediaQueryList | null | undefined;

function touchUi(): boolean {
  if (coarseMq === undefined) {
    coarseMq = null;
    if (typeof window !== 'undefined') {
      try {
        coarseMq = window.matchMedia('(pointer: coarse)');
      } catch {
        coarseMq = null;
      }
    }
  }
  return coarseMq !== null && coarseMq.matches;
}

// ── 갱신 ───────────────────────────────────────────────────────────────────

function liveBody(s: SimState): Body | null {
  for (const b of s.bodies) {
    if (b.isLive) return b;
  }
  return null;
}

function noteCenterSub(d: NoteDef): { x: number; y: number } {
  return { x: d.tx * TILE_SUB + TILE_SUB / 2, y: d.ty * TILE_SUB + TILE_SUB / 2 };
}

/**
 * 매 틱 1회. `SimState` 를 **읽기만** 해서 읽기 UI 를 전진시킨다.
 *
 * 여기서 `SimState` 에 한 바이트라도 쓰면 이 파일의 존재 이유가 사라진다 —
 * `tests/notes.test.ts` 의 첫 번째 테스트가 정확히 그것을 해시로 감시한다.
 */
export function updateNotes(s: SimState): void {
  rt.frame++;
  loadRead();

  if (s.level.id !== rt.levelId) {
    rt.levelId = s.level.id;
    rt.openId = null;
    rt.nearId = null;
    rt.fade = 0;
    rt.promptFade = 0;
    rt.prevInteract = false;
    rt.openTicks = 0;
  }

  const defs = notesFor(s.level.id);
  const live = liveBody(s);

  let near: NoteDef | null = null;
  if (live !== null && defs.length > 0) {
    const bx = live.x + BODY_SUB / 2;
    const by = live.y + BODY_SUB / 2;
    let best = READ_RANGE_SUB2;
    for (const d of defs) {
      const c = noteCenterSub(d);
      const dx = c.x - bx;
      const dy = c.y - by;
      const dd = dx * dx + dy * dy;
      if (dd <= best) {
        best = dd;
        near = d;
      }
    }
  }
  rt.nearId = near === null ? null : near.id;

  // `E` 는 이미 테이프에 실려 있는 비트다. **엿보기만** 한다 — 소비하지 않는다.
  const mask = live === null ? 0 : live.lastInput;
  const interact = (mask & IN_INTERACT) !== 0;
  const edge = interact && !rt.prevInteract;
  rt.prevInteract = interact;

  if (live === null || s.outcome !== 'RUNNING') {
    rt.openId = null;
    rt.openTicks = 0;
  } else if (rt.openId !== null) {
    rt.openTicks++;
    const moved = (mask & MOVE_BITS) !== 0 && rt.openTicks > OPEN_GRACE_TICKS;
    if (edge || moved) {
      rt.openId = null;
      rt.openTicks = 0;
    }
  } else if (edge && near !== null) {
    rt.openId = near.id;
    rt.openTicks = 0;
    if (!readIds.has(near.id)) {
      readIds.add(near.id);
      saveRead();
    }
  }

  rt.fade += ((rt.openId === null ? 0 : 1) - rt.fade) * 0.3;
  rt.promptFade +=
    ((rt.openId === null && near !== null ? 1 : 0) - rt.promptFade) * 0.25;
}

/** 지금 펼쳐 놓은 단서의 id. 테스트와 렌더가 함께 쓴다. */
export function openNoteId(): string | null {
  return rt.openId;
}

/** 사거리 안의 단서 id. */
export function nearNoteId(): string | null {
  return rt.nearId;
}

/** 테스트 전용 초기화. 한 프로세스 안에서 여러 방을 연달아 도는 경우에만 쓴다. */
export function resetNotes(): void {
  rt.levelId = '';
  rt.openId = null;
  rt.nearId = null;
  rt.fade = 0;
  rt.promptFade = 0;
  rt.prevInteract = false;
  rt.openTicks = 0;
  rt.frame = 0;
  readIds.clear();
  readLoaded = true;
}

// ── 월드 그림: 콘크리트 위의 종이 한 장 ────────────────────────────────────

/** 종이의 실측 크기(px). 타일(32px) 안에 여유 있게 앉는다. */
const PAPER_W = 13;
const PAPER_H = 17;

/**
 * 긁어 쓴 획 세 줄. `[시작x, y, 길이]` — 값을 고정해 둔 이유는 하나다:
 * 프레임마다 난수를 뽑으면 낙서가 **꿈틀거린다.**
 */
const SCRAWL_ROWS: readonly (readonly [number, number, number])[] = [
  [-8, -5, 15],
  [-9, -1, 17],
  [-7, 3, 12],
];
/** 획의 세로 흔들림. 합이 0 이라 획이 한쪽으로 흐르지 않는다. */
const SCRAWL_JITTER: readonly number[] = [0, -1, 1, 0, 1, -1];

function drawPaper(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  k: number,
  a: number,
): void {
  const x = Math.round(cx - PAPER_W / 2);
  const y = Math.round(cy - PAPER_H / 2);

  // 접지 그림자 — 종이가 바닥에 **얹혀 있다**는 사실. 빛은 천장에서 온다.
  ctx.fillStyle = withAlpha(C_BG, 0.5 * a);
  ctx.fillRect(x + 1, y + 2, PAPER_W, PAPER_H);

  ctx.fillStyle = withAlpha(mulHex(C_PAPER, k), a);
  ctx.fillRect(x, y, PAPER_W, PAPER_H);

  // 아래·오른쪽 한 줄이 종이의 두께다.
  ctx.fillStyle = withAlpha(mulHex(C_PAPER_EDGE, k), a);
  ctx.fillRect(x, y + PAPER_H - 1, PAPER_W, 1);
  ctx.fillRect(x + PAPER_W - 1, y, 1, PAPER_H);

  // 오른쪽 위 접힌 모서리. 이 삼각형 하나가 "인쇄물"을 "종이"로 만든다.
  ctx.fillStyle = withAlpha(mulHex(C_PAPER_EDGE, k), a * 0.85);
  ctx.beginPath();
  ctx.moveTo(x + PAPER_W - 4, y);
  ctx.lineTo(x + PAPER_W, y);
  ctx.lineTo(x + PAPER_W, y + 4);
  ctx.closePath();
  ctx.fill();

  // 인쇄된 글줄. 마지막 줄만 짧아 문단으로 읽힌다.
  ctx.fillStyle = withAlpha(C_INK, 0.5 * a);
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 3, y + 5 + i * 3, PAPER_W - 6 - (i === 3 ? 4 : 0), 1);
  }
  // 스테이플 자국 — 이 종이는 원래 묶음의 일부였다.
  ctx.fillStyle = withAlpha(C_INK, 0.55 * a);
  ctx.fillRect(x + 3, y + 2, 3, 1);
}

function drawScrawl(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  k: number,
  a: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  // 기울기 — 손으로 급하게 쓴 것은 수평이 안 맞는다. 인쇄물과 갈리는 첫 신호다.
  ctx.rotate(-0.14);
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';

  let j = 0;
  for (const [x0, y0, len] of SCRAWL_ROWS) {
    // 획 밑에 깔린 어두운 홈 — 긁어낸 자리는 파여 있다.
    ctx.strokeStyle = withAlpha(C_BG, 0.45 * a);
    strokeJagged(ctx, x0, y0 + 1, len, j);
    ctx.strokeStyle = withAlpha(mulHex(C_CHALK, k), 0.9 * a);
    strokeJagged(ctx, x0, y0, len, j);
    j += 2;
  }
  ctx.restore();
}

/** 세 마디로 꺾이는 획. 직선 하나로는 "긁었다"가 되지 않는다. */
function strokeJagged(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  len: number,
  seed: number,
): void {
  const step = len / 3;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, y0 + 0.5);
  for (let i = 1; i <= 3; i++) {
    const jitter = SCRAWL_JITTER[(seed + i) % SCRAWL_JITTER.length] ?? 0;
    ctx.lineTo(x0 + step * i + 0.5, y0 + jitter + 0.5);
  }
  ctx.stroke();
}

/**
 * 바닥의 단서들. **월드 좌표계 안에서** 부른다(카메라 변환이 걸린 상태).
 *
 * `shade` 는 그 자리의 광량 계수다 — 렌더러의 조명 모델을 그대로 넘겨받아
 * 종이가 **조명받는 물건**으로 앉게 한다. 스스로 빛나면 안 된다.
 */
export function drawNoteDecals(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  shade: (x: number, y: number) => number,
): void {
  const defs = notesFor(s.level.id);
  if (defs.length === 0) return;
  loadRead();

  for (const d of defs) {
    const cx = d.tx * TILE + TILE / 2;
    const cy = d.ty * TILE + TILE / 2;
    const k = shade(cx, cy);
    // 이미 읽은 것은 흐려진다 — 지도를 훑을 때 남은 것만 눈에 걸리도록.
    const a = readIds.has(d.id) ? 0.42 : 1;
    if (d.kind === 'PRINT') drawPaper(ctx, cx, cy, k, a);
    else drawScrawl(ctx, cx, cy, k, a);
  }
}

/**
 * 근처 단서 위에 뜨는 `E`. 월드 좌표계 안에서 부른다 — 단서에 붙어 있어야
 * "저것을 읽는다"가 되지, 화면 구석에 뜨면 무엇에 대한 안내인지 알 수 없다.
 */
export function drawNotePrompt(ctx: CanvasRenderingContext2D, s: SimState): void {
  if (rt.promptFade < 0.02 || rt.nearId === null) return;
  const d = notesFor(s.level.id).find((n) => n.id === rt.nearId);
  if (d === undefined) return;

  const touch = touchUi();
  const cx = d.tx * TILE + TILE / 2;
  const cy = d.ty * TILE + TILE / 2;
  // 위아래로 아주 조금 뜬다. 정지한 UI 는 배경으로 읽힌다.
  const bob = Math.sin(rt.frame * 0.11) * 1.5;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const box = keycapBox(ctx, 'E', { size: 11, touch });
  drawKeycap(ctx, cx - box.w / 2, cy - PAPER_H / 2 - 8 - box.h + bob, 'E', {
    size: 11,
    touch,
    alpha: rt.promptFade,
  });
  ctx.restore();
}

// ── 문서 패널 (화면 좌표계) ────────────────────────────────────────────────

const PANEL_W = 480;
const PANEL_PAD = 18;
const LINE_H = 19;
const HEAD_SIZE = 13;
const BODY_SIZE_PX = 12;
/** 패널 아랫변의 화면 y. 위는 HUD 상단 밴드, 아래는 하단 밴드를 피한다. */
const PANEL_BOTTOM = 494;
/** 터치에서는 아래쪽 절반이 조작 패드다. 그만큼 위로 올린다. */
const PANEL_BOTTOM_TOUCH = 344;

interface Layout {
  head: string | null;
  body: string[];
  /** 여러 항목이면 점검표처럼 네모를 앞에 그린다. */
  checklist: boolean;
}

/**
 * 원문 한 줄을 문서 배치로 편다. **글자를 바꾸지 않는다** — `—` 로 제목을 떼고
 * `/` 로 항목을 나눌 뿐이라, 화면에 나타나는 글자의 집합은 원문과 같다.
 */
function layout(ctx: CanvasRenderingContext2D, d: NoteDef, maxW: number): Layout {
  const cut = d.text.indexOf(' — ');
  const head = cut < 0 ? null : d.text.slice(0, cut);
  const rest = cut < 0 ? d.text : d.text.slice(cut + 3);
  const items = rest.split(' / ');
  const checklist = items.length > 1;

  ctx.font = font(BODY_SIZE_PX, 'normal');
  const body: string[] = [];
  const indent = checklist ? 14 : 0;
  for (const item of items) {
    for (const line of wrap(ctx, item, maxW - indent)) body.push(line);
  }
  return { head, body, checklist };
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const trial = line === '' ? word : `${line} ${word}`;
    if (line !== '' && ctx.measureText(trial).width > maxW) {
      out.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line !== '') out.push(line);
  return out;
}

/**
 * 펼쳐 놓은 문서. **화면 좌표계**에서 부른다(카메라 변환 밖).
 *
 * 인쇄물은 종이 위의 잉크로, 낙서는 콘크리트에 긁힌 자국으로 그린다 — 월드의
 * 그림과 같은 언어라야 "그 종이를 집어 든 것"으로 읽힌다.
 */
export function drawNoteOverlay(ctx: CanvasRenderingContext2D, s: SimState): void {
  if (rt.fade < 0.02 || rt.openId === null) return;
  const d = notesFor(s.level.id).find((n) => n.id === rt.openId);
  if (d === undefined) return;

  const a = Math.min(1, rt.fade);
  const inner = PANEL_W - PANEL_PAD * 2;
  const lay = layout(ctx, d, inner);
  const headH = lay.head === null ? 0 : HEAD_SIZE + 13;
  const h = PANEL_PAD * 2 + headH + lay.body.length * LINE_H + 12;
  const x = Math.round((CANVAS_W - PANEL_W) / 2);
  const bottom = touchUi() ? PANEL_BOTTOM_TOUCH : PANEL_BOTTOM;
  // 열릴 때 아주 조금 올라온다. 순간이동하는 패널은 종이로 읽히지 않는다.
  const y = Math.round(bottom - h + (1 - a) * 6);

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  if (d.kind === 'PRINT') drawPaperPanel(ctx, x, y, h, a);
  else drawSlabPanel(ctx, x, y, h, a);

  const ink = d.kind === 'PRINT' ? C_INK : C_CHALK;
  const tx = x + PANEL_PAD;
  let ty = y + PANEL_PAD;

  if (lay.head !== null) {
    ctx.textAlign = 'left';
    ctx.font = font(HEAD_SIZE, 'bold');
    ctx.fillStyle = withAlpha(ink, a);
    ctx.fillText(lay.head, tx, ty + HEAD_SIZE);
    // 제목 아래 가는 줄 하나. 양식지의 그 줄이다.
    ctx.fillStyle = withAlpha(ink, 0.28 * a);
    ctx.fillRect(tx, ty + HEAD_SIZE + 7, inner, 1);
    ty += headH;
  }

  ctx.font = font(BODY_SIZE_PX, 'normal');
  ctx.textAlign = 'left';
  const indent = lay.checklist ? 14 : 0;
  for (let i = 0; i < lay.body.length; i++) {
    const line = lay.body[i] ?? '';
    const by = ty + LINE_H * i + BODY_SIZE_PX;
    if (lay.checklist) {
      // 빈 네모. 점검표는 채워지지 않은 채로 남아 있다.
      ctx.strokeStyle = withAlpha(ink, 0.6 * a);
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, by - BODY_SIZE_PX + 1.5, 7, 7);
    }
    ctx.fillStyle = withAlpha(ink, (d.kind === 'PRINT' ? 0.88 : 0.82) * a);
    if (d.kind === 'SCRAWL') {
      // 손글씨는 한 획이 아니다 — 같은 글자를 살짝 어긋나게 두 번 얹는다.
      ctx.fillStyle = withAlpha(ink, 0.3 * a);
      ctx.fillText(line, tx + indent + 0.6, by + 0.6);
      ctx.fillStyle = withAlpha(ink, 0.82 * a);
    }
    ctx.fillText(line, tx + indent, by);
  }

  // 닫는 법. 종이 바깥이 아니라 양식지의 각주 자리에 둔다.
  ctx.font = font(9, 'bold');
  ctx.textAlign = 'right';
  ctx.fillStyle = withAlpha(d.kind === 'PRINT' ? ink : C_TEXT_DIM, 0.5 * a);
  ctx.fillText('E ▸ 닫기', x + PANEL_W - PANEL_PAD, y + h - PANEL_PAD + 4);

  ctx.restore();
}

/** 인쇄물 = 바랜 복사용지 한 장. 스테이플 자국까지 월드의 그림과 같다. */
function drawPaperPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  a: number,
): void {
  ctx.fillStyle = withAlpha(C_BG, 0.6 * a);
  ctx.fillRect(x + 3, y + 5, PANEL_W, h);
  ctx.fillStyle = withAlpha(C_PAPER, a);
  ctx.fillRect(x, y, PANEL_W, h);
  ctx.fillStyle = withAlpha(C_PAPER_EDGE, a);
  ctx.fillRect(x, y + h - 1, PANEL_W, 1);
  ctx.fillRect(x + PANEL_W - 1, y, 1, h);
  ctx.fillStyle = withAlpha(C_INK, 0.5 * a);
  ctx.fillRect(x + 10, y + 7, 8, 1);
}

/** 낙서 = 종이가 아니다. 콘크리트 벽면 한 조각을 그대로 들여다본다. */
function drawSlabPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  a: number,
): void {
  ctx.fillStyle = withAlpha(C_BG, 0.62 * a);
  ctx.fillRect(x + 3, y + 5, PANEL_W, h);
  ctx.fillStyle = withAlpha(C_METAL_DARK, 0.96 * a);
  ctx.fillRect(x, y, PANEL_W, h);
  // 가장자리는 반듯하지 않다 — 위쪽에만 빛 받은 립을 두고 나머지는 어둠에 묻는다.
  ctx.fillStyle = withAlpha(C_CHALK, 0.22 * a);
  ctx.fillRect(x, y, PANEL_W, 1);
  ctx.fillStyle = withAlpha(C_BG, 0.7 * a);
  ctx.fillRect(x, y + h - 1, PANEL_W, 1);
}
