/**
 * 월드 렌더러.
 *
 * **철칙(SPEC §4 마지막 줄): 렌더는 SimState 를 읽기만 한다.**
 * 보간·트레일·화면흔들림·파티클은 전부 여기 `ViewState` 에 산다. 이걸 SimState 에
 * 한 필드라도 넣는 순간 결정론 해시가 프레임레이트에 오염된다.
 *
 * 좌표: 시뮬은 서브픽셀 정수, 렌더는 픽셀 실수. 변환은 `P()` 한 곳에서만 한다.
 */
import {
  BODY_SIZE,
  CANVAS_H,
  CANVAS_W,
  CCTV_FOV_TAN,
  CCTV_RANGE,
  CRATE_SIZE,
  DETECT_MAX,
  DIR_STEPS,
  GUARD_FOV_TAN,
  GUARD_SIZE,
  GUARD_VIEW_RANGE,
  IN_RUN,
  SLOT_NAMES,
  SUBPIXEL,
  TAN_SCALE,
  TILE,
} from '../sim/constants';
import type {
  Body,
  Guard,
  SimState,
  SlotIndex,
  TickEvents,
} from '../sim/types';
import { drawTopFigure, STRIDE_PX, TOP_WARDEN_SHOULDER, topPose } from './figure';
import {
  A_CONE_CCTV,
  A_CONE_CHASE,
  A_CONE_PATROL,
  A_CONE_SUSPICIOUS,
  A_CORPSE,
  A_FLOOR_REFLECT,
  A_GHOST_OUTLINE,
  A_LAMP_DIP,
  A_SCANLINE,
  A_SLOT,
  A_VIGNETTE,
  C_BG,
  C_CCTV,
  C_CCTV_SCAN,
  C_CORPSE,
  C_ESCAPE_LOCKED,
  C_ESCAPE_OPEN,
  C_FLOOR,
  C_GRID,
  C_GUARD,
  C_I_CORE,
  C_I_RING,
  C_LOOT,
  C_OFF,
  C_ON,
  C_SLOT,
  C_WALL,
  C_WALL_TOP,
  SCANLINE_GAP,
  font,
  withAlpha,
} from './palette';

/** HUD 상/하단 밴드가 먹는 세로 공간. 월드는 그 사이에 중앙 정렬된다. */
const VIEW_TOP = 58;
const VIEW_BOTTOM = 46;

/** 게이트 개폐 보간 길이(틱). SPEC §7 "게이트 개폐 3틱 보간". */
const GATE_LERP_TICKS = 3;
/** 체포 시 화면 흔들림 프레임 수. */
const SHAKE_FRAMES = 8;
/** 잔상 모션 트레일 길이(프레임). */
const TRAIL_LEN = 4;
/** 트레일 한 칸당 알파 감쇠. */
const TRAIL_STEP = 0.06;
/** 바닥 반사 그라디언트 높이(px). */
const REFLECT_H = 11;
/**
 * 시야콘 가장자리 노이즈 진폭(px). **항상 안쪽으로만** 흔든다 —
 * 밖으로 부풀리면 "저 벽 뒤는 안전하다"가 거짓말이 되고, 그건 분위기가 아니라 버그다.
 */
const CONE_NOISE = [0.7, 1.6, 3.2] as const;
/** 슬롯 라벨이 서로 부딪힐 때 한 번에 위로 미는 거리(px). 8px 글자 + 1px 여유. */
const LABEL_STEP = 9;
/** 최대 밀기 횟수. 이보다 멀어지면 라벨이 어느 몸 것인지 안 읽힌다. */
const LABEL_TRIES = 3;
/** 끝내 자리가 없는 라벨의 알파 배율. 맨 앞 라벨만 또렷하게 남는다. */
const LABEL_DIM = 0.3;

// ── 인물 크기 ──────────────────────────────────────────────────────────────
//
// **충돌 박스는 손대지 않는다.** 시뮬의 몸은 여전히 24×24 AABB 이고, 아래 값들은
// 순전히 그림 크기다. 탑다운 인물은 AABB **중심**에 놓인다 — 위에서 보면 사람이 차지하는
// 바닥 면적이 곧 충돌 면적이라, "보이는 곳 = 실제로 부딪히는 곳"이 자연히 맞는다.

/**
 * 인물 작도의 기준 단위 = **몸통 긴 축(어깨 폭) px**. 충돌 박스(24)보다 조금 좁아
 * 어깨 밖으로 삐져나온 팔(지름 7)까지 합쳐야 충돌 면적과 맞는다.
 * `drawTopFigure` 는 이 값에서 몸통 22×15, 머리 13, 팔 7 을 전부 파생시킨다.
 */
const FIG_W = 22;
/** 간수의 그려지는 어깨 폭(px) = 28. 그림자·라벨 반경을 몸통 크기에 맞추는 데만 쓴다. */
const FIG_W_GUARD = FIG_W * TOP_WARDEN_SHOULDER;
/** 라벨·꺾쇠가 피해야 하는 인물 반경(px). 어깨 반폭(11) + 팔(3.5) + 여유. */
const FIG_R = FIG_W * 0.68;
const FIG_R_GUARD = FIG_W_GUARD * 0.68;
/** 접지 그림자 가로 폭(px). 세로는 절반, 알파는 0.35 — 바닥에 앉히는 가장 강력한 장치다. */
const SHADOW_W = 20;
const SHADOW_W_GUARD = SHADOW_W * TOP_WARDEN_SHOULDER;
/**
 * 플레이어·잔상의 **팔·다리** 굵기 배율. 머리·몸통 비례는 작도법에 고정이라 여기 안 걸린다.
 * 기본 굵기를 쓰면 팔이 1px 선이 되어 주사선·시야콘 위에서 사라진다.
 */
const BULK_BODY = 1.1;
/**
 * 간수의 팔·다리 굵기. 덩치의 본체는 여기가 아니라 `topPose({warden:true})` 의
 * `shoulderScale`(몸통 28) 과 `headScale`(머리 14) 에서 나온다.
 */
const BULK_GUARD = 1.2;
/**
 * 그려지는 방향이 실제 `facing` 을 따라가는 비율(틱당). 1 이면 즉시 홱 돌아 로봇이 되고,
 * 너무 낮으면 몸과 시야콘(=실제 facing)이 눈에 띄게 어긋난다. 5틱이면 거의 붙는다.
 */
const TURN_LERP = 0.35;
/** `motion` 지연 사본의 추종 비율. 이 지연이 곧 출발·정지 기울기의 크기다. */
const MOTION_LAG = 0.28;
/** 지연 차이 → 기울기 배율. 출발 순간 거의 최대까지 기울고 열 틱쯤에 걸쳐 풀린다. */
const LEAN_GAIN = 2.2;

const TAU = Math.PI * 2;

// ── 렌더 전용 상태 ─────────────────────────────────────────────────────────

interface TrailPoint {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 이번 프레임에 그릴 슬롯 라벨 한 건. 배치는 몸을 다 그린 뒤 한꺼번에 정한다. */
interface LabelJob {
  text: string;
  cx: number;
  /** 충돌이 없을 때 쓰는 기본 베이스라인 y. */
  baseY: number;
  color: string;
  alpha: number;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  color: string;
}

/**
 * 한 인물의 걷기 애니메이션 상태. **전부 렌더 전용**이다 — SimState 에 한 필드라도
 * 새면 결정론 해시가 프레임레이트에 오염된다.
 */
interface Gait {
  /** 이동 거리로만 자라는 위상(라디안). 정지하면 그 자리에 멈춘다. */
  phase: number;
  /** 직전 틱 위치(px). 이번 틱과의 차이가 곧 위상 증가분이다. */
  lastX: number;
  lastY: number;
  /** 0 = 정지(선 자세), 1 = 전속. */
  motion: number;
  /** 0 = 걷기, 1 = 달리기. */
  run: number;
  /**
   * **그려지는** 방향(라디안). 실제 `facing` 을 최단경로로 부드럽게 따라간다.
   * 시야콘·방향 화살촉은 실제 `facing` 을 쓴다 — 회피 판정이 걸린 정보를 늦추면 안 되므로,
   * 늦는 것은 그림뿐이다.
   */
  drawAng: number;
  /** `motion` 의 지연 사본. 둘의 차이가 곧 출발/정지 순간의 쏠림이다. */
  motionSlow: number;
}

export interface ViewState {
  /** 렌더 프레임 카운터. 펄스/플리커/회전에 쓰는 유일한 시간축. */
  frame: number;
  /** bodyId → 최근 위치(픽셀). 최신이 배열 끝. */
  trails: Map<number, TrailPoint[]>;
  /** bodyId → 걷기 위상. */
  gaits: Map<number, Gait>;
  /** guardId → 걷기 위상. 몸과 id 공간이 섞이지 않도록 맵을 따로 둔다. */
  guardGaits: Map<number, Gait>;
  /** gateId → 0(닫힘)..1(열림) 보간값. */
  gateAnim: Map<number, number>;
  /** 남은 흔들림 프레임. */
  shake: number;
  /** 화면 전체 플래시 강도 0..1. */
  flash: number;
  flashColor: string;
  rings: Ring[];
  /** 월드 원점의 화면상 픽셀 오프셋(정수). */
  camX: number;
  camY: number;
  /** 형광등이 꺼져 있는 남은 프레임 수. */
  lampFrames: number;
  /** 다음 깜빡임까지 남은 프레임 수. */
  lampTimer: number;
  /** 깜빡임 간격용 LCG 시드. 렌더 전용이라 시뮬 결정론과 무관하다. */
  lampSeed: number;
  /** 월드 리셋 감지용. tick 이 되감기면 새 루프가 시작된 것이다. */
  lastTick: number;
  lastBodyCount: number;
}

export function createView(): ViewState {
  return {
    frame: 0,
    trails: new Map(),
    gaits: new Map(),
    guardGaits: new Map(),
    gateAnim: new Map(),
    shake: 0,
    flash: 0,
    flashColor: C_GUARD,
    rings: [],
    camX: 0,
    camY: 0,
    lampFrames: 0,
    lampTimer: 300,
    lampSeed: 0x9e3779b9,
    lastTick: -1,
    lastBodyCount: -1,
  };
}

/**
 * 이동 거리만큼 보행 위상을 전진시킨다.
 *
 * `hold` 가 참이면 **아무것도 하지 않는다** — frozen 잔상이 마지막 자세 그대로
 * 굳는 것이 정확히 이 한 줄이다. 위상도 motion 도 그 순간 값에서 얼어붙는다.
 */
function stepGait(
  map: Map<number, Gait>,
  id: number,
  x: number,
  y: number,
  ang: number,
  running: boolean,
  hold: boolean,
): void {
  const g = map.get(id);
  if (g === undefined) {
    map.set(id, {
      phase: 0,
      lastX: x,
      lastY: y,
      motion: 0,
      run: running ? 1 : 0,
      drawAng: ang,
      motionSlow: 0,
    });
    return;
  }
  if (hold) return;

  const d = Math.hypot(x - g.lastX, y - g.lastY);
  g.lastX = x;
  g.lastY = y;
  g.phase += (d / STRIDE_PX) * Math.PI;
  // 한 틱 이동은 최대 3.25px 이라 위상 증가분이 π 를 넘지 않는다 — 한 번만 빼면 된다.
  if (g.phase > Math.PI * 2) g.phase -= Math.PI * 2;

  // 걷기(2px/틱)면 곧 1 에 붙고, 멈추면 서너 틱에 걸쳐 선 자세로 돌아간다.
  const target = Math.min(1, d / 1.7);
  g.motion += (target - g.motion) * (target > g.motion ? 0.5 : 0.22);
  g.run += ((running && d > 0.05 ? 1 : 0) - g.run) * 0.22;

  // 방향은 **최단경로**로 따라간다. 그냥 빼면 −π↔π 경계에서 한 바퀴를 되돌아 돈다.
  let da = (ang - g.drawAng) % TAU;
  if (da > Math.PI) da -= TAU;
  if (da < -Math.PI) da += TAU;
  g.drawAng += da * TURN_LERP;

  // 지연 사본. `motion` 이 앞서면 출발(앞으로 쏠림), 뒤처지면 정지(뒤로 쏠림)다.
  g.motionSlow += (g.motion - g.motionSlow) * MOTION_LAG;
}

/**
 * 출발·정지 쏠림(-1..1). 시뮬은 즉시 서고 즉시 출발하지만 **그림에만** 관성을 준다.
 * 이 한 값이 "로봇 같다"는 인상의 절반을 가져간다.
 */
function leanOf(g: Gait | undefined): number {
  if (g === undefined) return 0;
  const v = (g.motion - g.motionSlow) * LEAN_GAIN;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** 렌더 전용 난수. 시뮬은 이 함수를 절대 부르지 않는다(SPEC §4 금지 목록). */
function lampRand(view: ViewState): number {
  view.lampSeed = (Math.imul(view.lampSeed, 1664525) + 1013904223) >>> 0;
  return view.lampSeed / 4294967296;
}

/** 서브픽셀 → 픽셀. */
function P(v: number): number {
  return v / SUBPIXEL;
}

/**
 * 점 장치(버튼·레버·CCTV)의 x/y 는 **타일 좌상단**이다(world.ts `tileTopLeft`).
 * 시뮬은 판정할 때 `+ TILE_SUB / 2` 로 중심을 잡으므로 렌더도 같은 중심을 써야
 * 상호작용 사거리와 그림이 어긋나지 않는다.
 */
function tileCenterPx(v: number): number {
  return P(v) + TILE / 2;
}

/** facing 인덱스 → 라디안. 0 = +X, 시계방향(DIR_STEPS 분해능). */
function angleOf(facing: number): number {
  return (facing / DIR_STEPS) * Math.PI * 2;
}

/** TAN_SCALE 로 고정된 반각 탄젠트를 라디안 반각으로. */
function halfAngleOf(tanScaled: number): number {
  return Math.atan(tanScaled / TAN_SCALE);
}

function solidAt(s: SimState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= s.width || ty >= s.height) return true;
  const v = s.solid[ty * s.width + tx];
  return v === undefined || v !== 0;
}

/**
 * 매 틱 1회. SimState 를 읽어 렌더 전용 효과를 전진시킨다.
 * SimState 는 절대 수정하지 않는다.
 */
export function updateView(
  view: ViewState,
  s: SimState,
  events: TickEvents,
): void {
  view.frame++;

  // ── 형광등 ──
  // 시설의 등은 성실하지 않다. 4~14초에 한 번, 2~5틱만 어두워진다.
  // 간격을 사인파가 아니라 난수로 잡는 이유: 규칙적인 깜빡임은 3초만 지나면
  // 배경음처럼 무시되고, 불규칙해야 "이 건물이 낡았다"로 읽힌다.
  if (view.lampFrames > 0) {
    view.lampFrames--;
  } else if (view.lampTimer > 0) {
    view.lampTimer--;
  } else {
    view.lampFrames = 2 + Math.floor(lampRand(view) * 4);
    view.lampTimer = 240 + Math.floor(lampRand(view) * 600);
  }

  // ── 잔상 스폰(= 능력 발현) ──
  // 월드가 틱 0으로 되감기면 잔상들이 내 몸에서 한 겹씩 떨어져 나온다.
  // 모든 몸이 같은 스폰 지점에 겹쳐 있는 유일한 순간이라, 링을 슬롯 색으로
  // 시차를 두고 겹쳐 쏘면 "네가 넷으로 갈라졌다"가 한 프레임에 읽힌다.
  const rewound = s.tick < view.lastTick || s.bodies.length !== view.lastBodyCount;
  if (rewound && s.bodies.length > 1) {
    for (const b of s.bodies) {
      if (b.isLive) continue;
      view.rings.push({
        x: P(b.x) + BODY_SIZE / 2,
        y: P(b.y) + BODY_SIZE / 2,
        age: -b.slot * 6,
        life: 30,
        radius: 40,
        color: slotColor(b.slot),
      });
    }
  }
  view.lastTick = s.tick;
  view.lastBodyCount = s.bodies.length;

  // ── 카메라 ──
  const worldW = s.width * TILE;
  const worldH = s.height * TILE;
  const availH = CANVAS_H - VIEW_TOP - VIEW_BOTTOM;
  let camX = Math.round((CANVAS_W - worldW) / 2);
  let camY = Math.round(VIEW_TOP + (availH - worldH) / 2);
  if (worldW > CANVAS_W || worldH > availH) {
    // 맵이 화면보다 크면 조작 중인 몸을 따라간다(클램프).
    const live = s.bodies.find((b) => b.isLive) ?? s.bodies[0];
    const fx = live === undefined ? worldW / 2 : P(live.x) + BODY_SIZE / 2;
    const fy = live === undefined ? worldH / 2 : P(live.y) + BODY_SIZE / 2;
    if (worldW > CANVAS_W) {
      camX = Math.round(Math.max(CANVAS_W - worldW, Math.min(0, CANVAS_W / 2 - fx)));
    }
    if (worldH > availH) {
      camY = Math.round(
        Math.max(CANVAS_H - VIEW_BOTTOM - worldH, Math.min(VIEW_TOP, VIEW_TOP + availH / 2 - fy)),
      );
    }
  }
  view.camX = camX;
  view.camY = camY;

  // ── 모션 트레일 ──
  // 정지(frozen)·시체 잔상은 트레일을 남기지 않는다. 이게 "움직이는 잔상 vs
  // 멈춰서 발판을 눌러주는 잔상"을 한눈에 가르는 유일한 단서다(SPEC §7 가독성).
  const seen = new Set<number>();
  for (const b of s.bodies) {
    seen.add(b.id);
    if (b.frozen || !b.alive) {
      view.trails.delete(b.id);
      continue;
    }
    let t = view.trails.get(b.id);
    if (t === undefined) {
      t = [];
      view.trails.set(b.id, t);
    }
    t.push({ x: P(b.x) + BODY_SIZE / 2, y: P(b.y) + BODY_SIZE / 2 });
    while (t.length > TRAIL_LEN) t.shift();
  }
  for (const id of [...view.trails.keys()]) {
    if (!seen.has(id)) view.trails.delete(id);
  }

  // ── 걷기 위상 ──
  // 위상은 프레임이 아니라 **이동 거리**로만 자란다. 프레임 기반이면 멈춰 선 몸의
  // 다리가 계속 움직이고, 속도가 바뀌어도 보폭이 그대로라 발이 바닥에서 미끄러진다.
  for (const b of s.bodies) {
    stepGait(
      view.gaits,
      b.id,
      P(b.x),
      P(b.y),
      angleOf(b.facing),
      (b.lastInput & IN_RUN) !== 0,
      b.frozen || !b.alive,
    );
  }
  for (const id of [...view.gaits.keys()]) {
    if (!seen.has(id)) view.gaits.delete(id);
  }

  const guardSeen = new Set<number>();
  for (const g of s.guards) {
    guardSeen.add(g.id);
    stepGait(
      view.guardGaits,
      g.id,
      P(g.x),
      P(g.y),
      angleOf(g.facing),
      g.state === 'CHASE',
      false,
    );
  }
  for (const id of [...view.guardGaits.keys()]) {
    if (!guardSeen.has(id)) view.guardGaits.delete(id);
  }

  // ── 게이트 개폐 보간 ──
  const gateSeen = new Set<number>();
  for (const g of s.gates) {
    gateSeen.add(g.id);
    const target = g.open ? 1 : 0;
    const cur = view.gateAnim.get(g.id) ?? target;
    const step = 1 / GATE_LERP_TICKS;
    const next =
      cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    view.gateAnim.set(g.id, next);
  }
  for (const id of [...view.gateAnim.keys()]) {
    if (!gateSeen.has(id)) view.gateAnim.delete(id);
  }

  // ── 이벤트 → 이펙트 ──
  if (events.captured) {
    view.shake = SHAKE_FRAMES;
    view.flash = 0.55;
    view.flashColor = C_GUARD;
  } else if (view.shake > 0) {
    view.shake--;
  }

  if (events.alerted) {
    view.flash = Math.max(view.flash, 0.3);
    view.flashColor = C_CCTV;
    for (const g of s.guards) {
      if (g.state === 'CHASE') {
        view.rings.push({
          x: P(g.x) + GUARD_SIZE / 2,
          y: P(g.y) + GUARD_SIZE / 2,
          age: 0,
          life: 24,
          radius: 46,
          color: C_GUARD,
        });
      }
    }
  }

  if (events.lootTaken) {
    const lx = P(s.loot.x) + BODY_SIZE / 2;
    const ly = P(s.loot.y) + BODY_SIZE / 2;
    for (let i = 0; i < 3; i++) {
      view.rings.push({
        x: lx,
        y: ly,
        age: -i * 5,
        life: 34,
        radius: 54,
        color: C_LOOT,
      });
    }
    view.flash = Math.max(view.flash, 0.18);
    view.flashColor = C_LOOT;
  }

  if (events.gateToggled) {
    for (const g of s.gates) {
      view.rings.push({
        x: P(g.x) + P(g.w) / 2,
        y: P(g.y) + P(g.h) / 2,
        age: 0,
        life: 18,
        radius: 30,
        color: g.open ? C_ON : C_OFF,
      });
    }
  }

  if (view.flash > 0) view.flash = Math.max(0, view.flash - 0.06);

  for (const r of view.rings) r.age++;
  view.rings = view.rings.filter((r) => r.age < r.life);
}

// ── 그리기 ─────────────────────────────────────────────────────────────────

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 흔들림은 정수 픽셀 단위로만 — 서브픽셀 이동은 pixelated 캔버스에서 뭉갠다.
  let shakeX = 0;
  let shakeY = 0;
  if (view.shake > 0) {
    const mag = view.shake;
    shakeX = Math.round(Math.sin(view.frame * 2.3) * mag * 0.7);
    shakeY = Math.round(Math.cos(view.frame * 3.1) * mag * 0.7);
  }

  ctx.save();
  ctx.translate(view.camX + shakeX, view.camY + shakeY);

  drawFloor(ctx, s);
  drawWalls(ctx, s);
  drawGates(ctx, s, view);
  drawDevices(ctx, s);
  drawCrates(ctx, s);
  drawCctvs(ctx, s, view);
  drawGuardCones(ctx, s, view);
  drawGoals(ctx, s, view);
  drawGhosts(ctx, s, view);
  drawGuards(ctx, s, view);
  drawLive(ctx, s, view);
  drawRings(ctx, view);

  ctx.restore();

  // ── 시설 레이어(전부 화면 공간) ──
  // 순서가 중요하다: 등이 꺼지고 → 가장자리가 죽고 → 그 위에 모니터 주사선.
  if (view.lampFrames > 0) {
    ctx.fillStyle = withAlpha('#000000', A_LAMP_DIP);
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  drawVignette(ctx);
  drawScanlines(ctx);

  if (view.flash > 0.001) {
    ctx.fillStyle = withAlpha(view.flashColor, view.flash * 0.35);
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

/** 비네트 그라디언트 캐시. 캔버스가 바뀌면 다시 만든다. */
let vignetteGrad: CanvasGradient | undefined;
let vignetteCtx: CanvasRenderingContext2D | undefined;

/**
 * 가장자리를 어둡게 — 시선을 가운데(= 내가 조작하는 몸이 있는 곳)로 모은다.
 * 중심 40% 반경은 손대지 않는다. 거기까지 어두워지면 잔상 3개가 겹쳤을 때
 * 누가 누군지 구분이 안 된다.
 */
function drawVignette(ctx: CanvasRenderingContext2D): void {
  if (vignetteGrad === undefined || vignetteCtx !== ctx) {
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    const g = ctx.createRadialGradient(cx, cy, CANVAS_H * 0.4, cx, cy, CANVAS_W * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, withAlpha('#000000', A_VIGNETTE * 0.3));
    g.addColorStop(1, withAlpha('#000000', A_VIGNETTE));
    vignetteGrad = g;
    vignetteCtx = ctx;
  }
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** 감시 모니터 주사선. 정지시켜 둔다 — 흐르면 눈이 그쪽을 따라간다. */
function drawScanlines(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = withAlpha('#000000', A_SCANLINE);
  for (let y = 0; y < CANVAS_H; y += SCANLINE_GAP) {
    ctx.fillRect(0, y, CANVAS_W, 1);
  }
}

/**
 * 바닥 반사. 엔티티 밑변에서 아래로 짧게 흐르는 수직 그라디언트.
 * 몸이 바닥에 "놓여" 보이게 만드는 유일한 단서다(그림자도 원근도 없으므로).
 */
function floorReflect(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottomY: number,
  w: number,
  color: string,
  alpha = A_FLOOR_REFLECT,
): void {
  const g = ctx.createLinearGradient(0, bottomY, 0, bottomY + REFLECT_H);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - w / 2, bottomY, w, REFLECT_H);
}

function drawFloor(ctx: CanvasRenderingContext2D, s: SimState): void {
  const w = s.width * TILE;
  const h = s.height * TILE;
  ctx.fillStyle = C_FLOOR;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let tx = 0; tx <= s.width; tx++) {
    ctx.moveTo(tx * TILE + 0.5, 0);
    ctx.lineTo(tx * TILE + 0.5, h);
  }
  for (let ty = 0; ty <= s.height; ty++) {
    ctx.moveTo(0, ty * TILE + 0.5);
    ctx.lineTo(w, ty * TILE + 0.5);
  }
  ctx.stroke();
}

/**
 * 벽. 엔티티보다 아래 레이어다 — 위에 덮으면 좁은 복도에서 잔상 머리 위 슬롯
 * 라벨이 가려져 §7 가독성 규칙이 깨진다. 시야콘은 레이캐스트로 이미 잘려 있다.
 */
function drawWalls(ctx: CanvasRenderingContext2D, s: SimState): void {
  for (let ty = 0; ty < s.height; ty++) {
    for (let tx = 0; tx < s.width; tx++) {
      if (!solidAt(s, tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      ctx.fillStyle = C_WALL;
      ctx.fillRect(x, y, TILE, TILE);
      // 위쪽이 뚫려 있으면 상단 하이라이트 — 벽에 두께감을 준다.
      if (!solidAt(s, tx, ty - 1)) {
        ctx.fillStyle = C_WALL_TOP;
        ctx.fillRect(x, y, TILE, 3);
      }
      if (!solidAt(s, tx - 1, ty)) {
        ctx.fillStyle = withAlpha(C_WALL_TOP, 0.45);
        ctx.fillRect(x, y, 1, TILE);
      }
    }
  }
}

function drawGates(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const g of s.gates) {
    const x = P(g.x);
    const y = P(g.y);
    const w = P(g.w);
    const h = P(g.h);
    const a = view.gateAnim.get(g.id) ?? (g.open ? 1 : 0);

    // 문틀은 항상 보인다 — 닫힌 문이 사라지면 길인지 벽인지 헷갈린다.
    ctx.strokeStyle = withAlpha(C_OFF, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const closed = 1 - a;
    if (closed <= 0.001) {
      ctx.fillStyle = withAlpha(C_ON, 0.1);
      ctx.fillRect(x, y, w, h);
      continue;
    }

    // 긴 축을 따라 양쪽에서 닫히는 셔터.
    const horizontal = w >= h;
    ctx.fillStyle = withAlpha(C_OFF, 0.55 + closed * 0.4);
    if (horizontal) {
      const half = (w * closed) / 2;
      ctx.fillRect(x, y, half, h);
      ctx.fillRect(x + w - half, y, half, h);
    } else {
      const half = (h * closed) / 2;
      ctx.fillRect(x, y, w, half);
      ctx.fillRect(x, y + h - half, w, half);
    }

    // 위험 스트라이프
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = withAlpha(C_WALL_TOP, 0.5 * closed);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = -h; i < w + h; i += 8) {
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawDevices(ctx: CanvasRenderingContext2D, s: SimState): void {
  // 발판
  for (const p of s.plates) {
    const x = P(p.x);
    const y = P(p.y);
    const w = P(p.w);
    const h = P(p.h);
    const col = p.on ? C_ON : C_OFF;
    ctx.fillStyle = withAlpha(col, p.on ? 0.28 : 0.14);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = withAlpha(col, p.on ? 1 : 0.7);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (p.on) {
      ctx.strokeStyle = withAlpha(col, 0.35);
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    // 채널 라벨 — 어느 발판이 어느 문을 여는지 즉시 읽혀야 한다.
    ctx.fillStyle = withAlpha(col, 0.85);
    ctx.font = font(8, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.channel.toUpperCase(), x + w / 2, y + h / 2);
  }

  // 버튼 (시간차 — 남은 holdTicks 를 링으로 보여준다)
  for (const b of s.buttons) {
    const cx = tileCenterPx(b.x);
    const cy = tileCenterPx(b.y);
    const col = b.on ? C_ON : C_OFF;
    ctx.fillStyle = withAlpha(col, b.on ? 0.9 : 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(col, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.stroke();
    if (b.on && b.holdTicks > 0) {
      const frac = Math.max(0, Math.min(1, b.timer / b.holdTicks));
      ctx.strokeStyle = C_ON;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    ctx.fillStyle = withAlpha(col, 0.8);
    ctx.font = font(8, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.channel.toUpperCase(), cx, cy - 20);
  }

  // 레버
  for (const l of s.levers) {
    const cx = tileCenterPx(l.x);
    const cy = tileCenterPx(l.y);
    const col = l.on ? C_ON : C_OFF;
    ctx.fillStyle = withAlpha(C_OFF, 0.85);
    ctx.fillRect(cx - 8, cy + 4, 16, 5);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx + (l.on ? 7 : -7), cy - 9);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + (l.on ? 7 : -7), cy - 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(col, 0.8);
    ctx.font = font(8, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.channel.toUpperCase(), cx, cy - 20);
  }
}

function drawCrates(ctx: CanvasRenderingContext2D, s: SimState): void {
  for (const c of s.crates) {
    const x = P(c.x);
    const y = P(c.y);
    ctx.fillStyle = '#2a3252';
    ctx.fillRect(x, y, CRATE_SIZE, CRATE_SIZE);
    ctx.fillStyle = '#3b466f';
    ctx.fillRect(x, y, CRATE_SIZE, 3);
    ctx.strokeStyle = '#4a5789';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CRATE_SIZE - 1, CRATE_SIZE - 1);
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 5);
    ctx.lineTo(x + CRATE_SIZE - 5, y + CRATE_SIZE - 5);
    ctx.moveTo(x + CRATE_SIZE - 5, y + 5);
    ctx.lineTo(x + 5, y + CRATE_SIZE - 5);
    ctx.stroke();
  }
}

/**
 * 부채꼴을 여러 레이로 나눠 각 레이를 타일 충돌 지점에서 끊는다.
 * 정확한 그림자 볼륨은 아니지만 "저 벽 뒤는 안전하다"를 정확히 전달한다.
 */
function conePolygon(
  s: SimState,
  cx: number,
  cy: number,
  facingRad: number,
  halfAngle: number,
  rangePx: number,
  rays: number,
  noise = 0,
  frame = 0,
): TrailPoint[] {
  const pts: TrailPoint[] = [];
  const STEP = 4;
  for (let i = 0; i <= rays; i++) {
    const a = facingRad - halfAngle + (halfAngle * 2 * i) / rays;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let d = 0;
    while (d < rangePx) {
      const nd = Math.min(d + STEP, rangePx);
      const tx = Math.floor((cx + dx * nd) / TILE);
      const ty = Math.floor((cy + dy * nd) / TILE);
      if (solidAt(s, tx, ty)) break;
      d = nd;
    }
    // 노이즈는 뺄셈만 한다. 그려진 콘은 실제 시야보다 절대 크지 않다.
    if (noise > 0) {
      d = Math.max(0, d - (Math.sin(i * 2.7 + frame * 0.33) * 0.5 + 0.5) * noise);
    }
    pts.push({ x: cx + dx * d, y: cy + dy * d });
  }
  return pts;
}

function fillCone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pts: TrailPoint[],
  color: string,
  alpha: number,
): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, Math.min(1, alpha * 2.2));
  ctx.lineWidth = 1;
  ctx.stroke();
}

function coneAlpha(g: Guard, frame: number): number {
  switch (g.state) {
    case 'CHASE':
      // 추격 중에는 세게 맥동시킨다 — 화면 어디를 보고 있어도 주변시로 잡힌다.
      return A_CONE_CHASE + 0.07 + Math.sin(frame * 0.32) * 0.11;
    case 'SUSPICIOUS':
    case 'INVESTIGATE':
      return A_CONE_SUSPICIOUS + Math.sin(frame * 0.16) * 0.03;
    default:
      return A_CONE_PATROL;
  }
}

/** 상태별 시야콘 가장자리 노이즈 진폭. 쫓을수록 가장자리가 거칠어진다. */
function coneNoise(g: Guard): number {
  switch (g.state) {
    case 'CHASE':
      return CONE_NOISE[2];
    case 'SUSPICIOUS':
    case 'INVESTIGATE':
      return CONE_NOISE[1];
    default:
      return CONE_NOISE[0];
  }
}

function drawCctvs(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  const half = halfAngleOf(CCTV_FOV_TAN);
  for (const c of s.cctvs) {
    const cx = tileCenterPx(c.x);
    const cy = tileCenterPx(c.y);
    if (c.enabled) {
      const locking = c.lockTimer > 0;
      const pts = conePolygon(
        s,
        cx,
        cy,
        angleOf(c.facing),
        half,
        P(CCTV_RANGE),
        22,
        locking ? 2.4 : 1,
        view.frame,
      );
      // 빔은 본체 마젠타가 아니라 차가운 흰빛이다 — 잔상(특히 MINE 핑크)이 이 안에
      // 들어와도 색상·채도가 갈려 몸과 감시 구역이 한 덩어리로 뭉치지 않는다.
      fillCone(
        ctx,
        cx,
        cy,
        pts,
        C_CCTV_SCAN,
        // LOCK 가산치가 0.14 → 0.05 로 줄어든 건 약해진 게 아니다. 빔 색이 밝아져
        // 같은 알파에서 화면 밝기가 2.4배로 뛰므로, 예전 마젠타 LOCK 과 **같은 밝기**
        // (그리고 간수 CHASE 콘보다 살짝 아래)가 되도록 알파를 되맞춘 것이다.
        locking ? A_CONE_CCTV + 0.05 + Math.sin(view.frame * 0.4) * 0.02 : A_CONE_CCTV,
      );
    }
    // 카메라 본체 — 꺼지면 회색으로 죽는다(레버 효과의 시각 증거).
    const col = c.enabled ? C_CCTV : C_OFF;
    ctx.fillStyle = withAlpha(col, 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(col, 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();
    if (!c.enabled) {
      ctx.strokeStyle = withAlpha(C_OFF, 1);
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 8);
      ctx.lineTo(cx + 8, cy + 8);
      ctx.stroke();
    }
    // EYE(감시안) — 꺼진 눈은 라벨까지 죽는다.
    ctx.fillStyle = withAlpha(col, c.enabled ? 0.6 : 0.35);
    ctx.font = font(7, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EYE', cx, cy + 19);
  }
}

function drawGuardCones(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  const half = halfAngleOf(GUARD_FOV_TAN);
  for (const g of s.guards) {
    const cx = P(g.x) + GUARD_SIZE / 2;
    const cy = P(g.y) + GUARD_SIZE / 2;
    const pts = conePolygon(
      s,
      cx,
      cy,
      angleOf(g.facing),
      half,
      P(GUARD_VIEW_RANGE),
      26,
      coneNoise(g),
      view.frame,
    );
    fillCone(ctx, cx, cy, pts, C_GUARD, coneAlpha(g, view.frame));
    // 추격 중에는 콘 안쪽에 한 겹을 더 태운다 — 붉은 덩어리가 나를 향해 밀려온다.
    if (g.state === 'CHASE') {
      const near = conePolygon(
        s,
        cx,
        cy,
        angleOf(g.facing),
        half * 0.6,
        P(GUARD_VIEW_RANGE) * 0.55,
        14,
        CONE_NOISE[2],
        view.frame,
      );
      fillCone(ctx, cx, cy, near, C_GUARD, 0.1 + Math.sin(view.frame * 0.32) * 0.05);
    }
  }
}

function drawGoals(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  const e = s.escape;
  const ex = P(e.x);
  const ey = P(e.y);
  const ew = P(e.w);
  const eh = P(e.h);
  const holder = s.bodies.find((b) => b.carryingLoot && b.isLive);
  const unlocked = holder !== undefined;
  const col = unlocked ? C_ESCAPE_OPEN : C_ESCAPE_LOCKED;

  ctx.fillStyle = withAlpha(col, unlocked ? 0.16 : 0.08);
  ctx.fillRect(ex, ey, ew, eh);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(col, unlocked ? 1 : 0.6);
  ctx.lineDashOffset = unlocked ? -view.frame * 0.4 : 0;
  ctx.strokeRect(ex + 1, ey + 1, ew - 2, eh - 2);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.fillStyle = withAlpha(col, unlocked ? 1 : 0.65);
  ctx.font = font(9, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 코어를 되찾기 전까지 바깥 문은 SEALED 다 — 잠긴 게 아니라 봉인된 것이다.
  ctx.fillText(unlocked ? 'EXIT' : 'SEALED', ex + ew / 2, ey + eh / 2);

  // CORE — 나를 묶어두던 억제 코어. 회전 마름모 + 맥동 글로우.
  // loot.x/y 는 바디 크기(BODY_SUB) AABB 좌상단이고, 운반 중에는 world.ts 가
  // 매 틱 holder 좌표로 덮어쓴다. 운반 중일 때만 머리 위로 띄워 "들고 있다"를 보여준다.
  const carrier = s.bodies.find((b) => b.carryingLoot);
  const lx = P(s.loot.x) + BODY_SIZE / 2;
  const ly =
    carrier === undefined ? P(s.loot.y) + BODY_SIZE / 2 : P(s.loot.y) - 6;
  const bob = Math.sin(view.frame * 0.08) * 2;
  const spin = view.frame * 0.035;
  const pulse = 0.5 + Math.sin(view.frame * 0.09) * 0.5;

  // 바닥에 놓여 있을 때만 반사가 있다. 들려 있으면 공중이다.
  if (carrier === undefined) {
    floorReflect(ctx, lx, ly + 9, 22, C_LOOT, 0.3);
  }

  ctx.save();
  ctx.translate(lx, ly + bob);
  const gr = 24 + pulse * 8;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
  glow.addColorStop(0, withAlpha(C_LOOT, 0.42 + pulse * 0.18));
  glow.addColorStop(0.45, withAlpha(C_LOOT, 0.16));
  glow.addColorStop(1, withAlpha(C_LOOT, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-gr, -gr, gr * 2, gr * 2);

  // 바깥 껍질: 반대로 도는 마름모 링. "봉인 장치"로 읽히게 두 겹으로 만든다.
  ctx.save();
  ctx.rotate(-spin * 0.6);
  ctx.strokeStyle = withAlpha(C_LOOT, 0.45 + pulse * 0.3);
  ctx.lineWidth = 1;
  const outer = 13 + pulse * 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -outer);
  ctx.lineTo(outer, 0);
  ctx.lineTo(0, outer);
  ctx.lineTo(-outer, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  ctx.rotate(spin);
  ctx.fillStyle = C_LOOT;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, 0);
  ctx.lineTo(0, 8);
  ctx.lineTo(-7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff6d0';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 코어 안의 흰 점 — 회전과 무관하게 중심에 박혀 있어 눈이 고정된다.
  ctx.fillStyle = withAlpha('#fff6d0', 0.6 + pulse * 0.4);
  ctx.fillRect(-1.5, -1.5, 3, 3);
  ctx.restore();

  if (carrier === undefined) {
    ctx.fillStyle = withAlpha(C_LOOT, 0.55 + pulse * 0.25);
    ctx.font = font(7, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CORE', lx, ly + 20);
  }
}

function slotColor(slot: SlotIndex): string {
  return C_SLOT[slot] ?? C_I_CORE;
}

function slotAlpha(slot: SlotIndex): number {
  return A_SLOT[slot] ?? 1;
}

// ── 인물 그리기 보조 ───────────────────────────────────────────────────────

/** 몸 AABB 의 서브픽셀 y → 탑다운 인물의 중심 화면 y(px). */
function figCy(ySub: number): number {
  return P(ySub) + BODY_SIZE / 2;
}

/** 라벨·꺾쇠가 걸리는 인물 상단 y(px). */
function figTop(ySub: number): number {
  return figCy(ySub) - FIG_R;
}

/**
 * 걸을 때 몸이 오르내리는 양. **위에서 보면 높이가 아니라 크기로 나타난다** — 몸이
 * 솟은 만큼 카메라에 가까워지기 때문이다. 다리가 모이는 순간이 가장 크다.
 */
function gaitLift(g: Gait | undefined): number {
  if (g === undefined) return 1;
  return 1 + Math.abs(Math.cos(g.phase)) * 0.035 * g.motion;
}

/**
 * 몸 아래 타원 그림자. **이게 캐릭터를 바닥에 앉히는 가장 강력한 장치다.**
 *
 * 빛이 화면 위에서 오므로 그림자는 아래로 조금 밀린다. 그리고 인물이 출발·정지에
 * 기울어도 그림자는 **그 자리에 남는다** — 그 어긋남이 곧 관성으로 읽힌다.
 */
function bodyShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  alpha: number,
): void {
  ctx.fillStyle = withAlpha(C_BG, alpha);
  ctx.beginPath();
  // 가로 w × 세로 w/2. 빛이 화면 위에서 오므로 아래로 조금 밀린다.
  ctx.ellipse(cx, cy + w * 0.15, w * 0.5, w * 0.25, 0, 0, TAU);
  ctx.fill();
}

/**
 * 발밑 슬롯 색 얼룩. 인물 셋이 한 칸에 겹쳐도 **바닥이** "여기 이 색 몸이 있다"를 말한다.
 * 입면도 시절의 바닥 반사(밑변에서 아래로 흐르던 그라디언트)가 하던 일을 탑다운에서
 * 대신하는 장치다 — 위에서 보면 반사는 몸 아래가 아니라 몸 둘레에 깔린다.
 */
function floorTint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  alpha: number,
): void {
  const gd = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
  gd.addColorStop(0, withAlpha(color, alpha));
  gd.addColorStop(0.5, withAlpha(color, alpha * 0.55));
  gd.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gd;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/**
 * 잔상 뒤에 까는 어두운 후광.
 *
 * 예전 24×24 잔상은 1px 검은 테두리로 배경에서 끊었지만, 실루엣에는 두를 테두리가 없다.
 * 대신 뒤를 눌러 둔다 — 어두운 바닥 위에서는 거의 보이지 않고, **밝은 스캔 빔이나
 * 붉은 시야콘 안에서만** 드러나 반투명 실루엣이 배경에 먹히는 걸 막는다.
 */
function ghostBacking(
  ctx: CanvasRenderingContext2D,
  cx: number,
  midY: number,
  alpha: number,
): void {
  const r = 20;
  const grad = ctx.createRadialGradient(cx, midY, 1, cx, midY, r);
  grad.addColorStop(0, withAlpha(C_BG, alpha));
  grad.addColorStop(0.55, withAlpha(C_BG, alpha * 0.7));
  grad.addColorStop(1, withAlpha(C_BG, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(cx - r, midY - r, r * 2, r * 2);
}

/**
 * 굳은 잔상 표시 — 네 귀퉁이 꺾쇠. **완전히 정지한 그림**이어야 한다: 맥동시키면
 * 움직이는 잔상과 헷갈린다. 자세가 마지막 걸음에서 얼어 있고 트레일이 없다는 사실과
 * 겹쳐 "이 몸은 멈췄다"를 세 번 말한다.
 *
 * 발밑에는 아무것도 두지 않는다 — 접지 그림자·방향 표시가 이미 그 자리를 쓰고 있어서
 * 링을 하나 더 얹으면 대시가 뒤엉켜 무슨 표시인지 안 읽힌다.
 */
function frozenMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = 2;
  const hw = 13;
  const arm = 4;
  ctx.beginPath();
  for (const sx of [-1, 1]) {
    for (const [sy, y] of [
      [1, top],
      [-1, bottom],
    ] as const) {
      ctx.moveTo(cx + sx * hw, y + sy * arm);
      ctx.lineTo(cx + sx * hw, y);
      ctx.lineTo(cx + sx * (hw - arm), y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 슬롯 라벨 배치. 몸을 전부 그린 뒤 마지막에 한 번에 처리한다.
 *
 * 잔상 셋이 한 칸에 몰리면 라벨이 그대로 포개져 `MY`/`ME`/`MINE` 중 무엇도 읽히지
 * 않는다. 그래서 이미 자리 잡은 라벨·모든 몸 사각형과 겹치면 한 칸씩 **위로만** 민다
 * (아래로 밀면 자기 몸을 덮는다 — §7 "라벨이 본체를 가리지 않는다").
 * 세 번 밀어도 자리가 없으면 흐려서 뒤로 보내고, 맨 앞 한 장만 또렷하게 남긴다.
 */
function drawSlotLabels(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  jobs: LabelJob[],
): void {
  if (jobs.length === 0) return;
  ctx.save();
  ctx.font = font(8, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  // 라벨이 절대 침범하면 안 되는 영역 = 모든 몸. 이제 인물이 AABB 위로 솟으므로
  // 막는 상자도 **그려지는 인물 전체**여야 한다 — AABB 만 피하면 라벨이 남의 머리를 덮는다.
  const blocked: Rect[] = s.bodies.map((b) => ({
    x: P(b.x) - 2,
    y: figTop(b.y) - 1,
    w: BODY_SIZE + 4,
    h: FIG_R * 2 + 1,
  }));
  // I 라벨 자리도 미리 비워 둔다. drawLive 가 뒤에 그리므로 여기서 피하지 않으면
  // 잔상 위에 I 가 겹쳐 섰을 때 흰 `I` 가 잔상 라벨을 덮어 버린다.
  const live = s.bodies.find((b) => b.isLive);
  if (live !== undefined) {
    blocked.push({
      x: P(live.x) + BODY_SIZE / 2 - 6,
      y: figTop(live.y) - 10,
      w: 12,
      h: 10,
    });
  }
  const placed: Rect[] = [];

  for (const job of jobs) {
    const w = ctx.measureText(job.text).width + 3;
    let y = job.baseY;
    let dim = true;
    for (let k = 0; k <= LABEL_TRIES; k++) {
      const ty = job.baseY - k * LABEL_STEP;
      const r: Rect = { x: job.cx - w / 2, y: ty - 8, w, h: 9 };
      if (blocked.some((o) => overlaps(r, o))) continue;
      if (placed.some((o) => overlaps(r, o))) continue;
      placed.push(r);
      y = ty;
      dim = false;
      break;
    }

    const a = dim ? job.alpha * LABEL_DIM : job.alpha;
    // 밀려 올라간 라벨은 1px 연결선으로 주인을 가리킨다.
    if (y < job.baseY) {
      ctx.strokeStyle = withAlpha(job.color, a * 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(job.cx + 0.5, y + 1);
      ctx.lineTo(job.cx + 0.5, job.baseY);
      ctx.stroke();
    }
    // 어두운 헤일로 — 스캔 빔·시야콘·다른 잔상 위 어디에 놓여도 글자가 배경에서 끊긴다.
    ctx.strokeStyle = withAlpha(C_BG, A_GHOST_OUTLINE * (dim ? 0.6 : 1));
    ctx.lineWidth = 2;
    ctx.strokeText(job.text, job.cx, y);
    ctx.fillStyle = withAlpha(job.color, a);
    ctx.fillText(job.text, job.cx, y);
  }
  ctx.restore();
}

/** 잔상(=I 가 아닌 모든 몸). 항상 I 보다 아래 레이어에 그린다. */
function drawGhosts(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  const labels: LabelJob[] = [];
  for (const b of s.bodies) {
    if (b.isLive) continue;
    if (!b.alive) {
      drawCorpse(ctx, b, view, labels);
      continue;
    }

    const col = slotColor(b.slot);
    const baseA = slotAlpha(b.slot);
    const cx = P(b.x) + BODY_SIZE / 2;
    const cy = figCy(b.y);
    const top = figTop(b.y);

    // 4프레임 모션 트레일. frozen 잔상은 trails 에 항목 자체가 없다.
    const trail = view.trails.get(b.id);
    if (trail !== undefined && trail.length > 1) {
      for (let i = 0; i < trail.length - 1; i++) {
        const p = trail[i];
        if (p === undefined) continue;
        const a = TRAIL_STEP * (i + 1);
        // 탑다운 인물은 위로 솟지 않으므로 얼룩도 세로로 길면 안 된다 — 몸이 차지한
        // 바닥 면적이 지나간 자국이다.
        ctx.fillStyle = withAlpha(col, a * baseA * 3.4);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, FIG_W * 0.34, FIG_W * 0.27, 0, 0, TAU);
        ctx.fill();
      }
    }

    ghostBacking(ctx, cx, cy, A_GHOST_OUTLINE * baseA * 0.95);
    floorTint(ctx, cx, cy, FIG_W * 0.9, col, baseA * 0.26);
    bodyShadow(ctx, cx, cy, SHADOW_W, 0.35 * Math.min(1, baseA + 0.35));
    // 시선 표시는 **바닥에** 찍는다. 몸 위로 그으면 실루엣을 가로지르는 막대가 된다.
    // 그림은 부드럽게 돌지만 이 화살촉은 **실제 facing** 이다 — 회피 판정이 여기 걸려 있다.
    facingPip(ctx, cx, cy, b.facing, withAlpha(col, baseA + 0.25), 16, 5);

    const gait = view.gaits.get(b.id);
    drawTopFigure(
      ctx,
      cx,
      cy,
      FIG_W * gaitLift(gait),
      // frozen 이면 stepGait 가 갱신을 멈춰 방향도 자세도 마지막 걸음에 얼어붙어 있다.
      gait?.drawAng ?? angleOf(b.facing),
      topPose({
        phase: gait?.phase ?? 0,
        run: gait?.run ?? 0,
        motion: gait?.motion ?? 0,
        lean: leanOf(gait),
        hairMass: 0.6,
      }),
      {
        color: col,
        // 슬롯 알파를 그대로 쓰되 실루엣 합성이라 부위 경계가 생기지 않는다.
        alpha: Math.min(1, baseA + 0.12),
        bulk: BULK_BODY,
        inkSeed: 400 + b.slot * 97,
        style: 'silhouette',
        shade: C_BG,
      },
    );

    if (b.frozen) {
      frozenMark(ctx, cx, top, cy + FIG_R, col, Math.min(1, baseA + 0.4));
    }

    if (b.spotted) {
      ctx.strokeStyle = withAlpha(C_GUARD, 0.5 + Math.sin(view.frame * 0.3) * 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, BODY_SIZE * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 머리 위 슬롯 라벨 (MY / ME / MINE). 배치는 몸을 다 그린 뒤 한꺼번에 — 겹침 회피.
    labels.push({
      text: SLOT_NAMES[b.slot] ?? '?',
      cx,
      baseY: top - 4,
      color: col,
      alpha: Math.min(1, baseA + 0.35),
    });
  }

  drawSlotLabels(ctx, s, labels);
}

function drawCorpse(
  ctx: CanvasRenderingContext2D,
  b: Body,
  view: ViewState,
  labels: LabelJob[],
): void {
  // 3초(180프레임) 주기 미세 플리커. 시체는 "여기서 실패했다"는 흉터다.
  const flick = 0.85 + Math.sin((view.frame / 180) * Math.PI * 2) * 0.15;
  const a = A_CORPSE * flick;
  const x = P(b.x);
  const y = P(b.y);
  const cx = x + BODY_SIZE / 2;
  const cy = y + BODY_SIZE / 2;
  // 몸은 쓰러졌어도 무게는 남는다 — 시체는 계속 발판을 누른다.
  // 바닥에 눌린 자국을 남겨 "여기 아직 뭔가 있다"를 유지한다.
  const restY = y + BODY_SIZE - 5;
  ctx.fillStyle = withAlpha(C_CORPSE, a * 0.85);
  ctx.beginPath();
  ctx.ellipse(cx, restY, BODY_SIZE * 0.56, BODY_SIZE * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  // 스캔 빔 안에서 회색이 배경에 먹히지 않도록 뒤를 살짝 눌러 둔다.
  ghostBacking(ctx, cx, restY, A_GHOST_OUTLINE * 0.5);

  // 서 있는 몸과 **같은 작도법**이되 `sprawl: 1` 이라 머리 원이 몸통 타원 옆으로 빠지고
  // 다리가 벌어진다. 위에서 본 사람이 서 있지 않다는 걸 그 배치 하나가 말한다 —
  // 회색 + 낮은 알파까지 더해 살아 있는 잔상과 한 프레임도 헷갈리지 않는다.
  drawTopFigure(ctx, cx, restY, FIG_W, angleOf(b.facing), {
    shoulderTwist: 0.55,
    hipTwist: -0.32,
    armL: 0.85,
    armR: -0.55,
    lean: 0,
    footL: 0.45,
    footR: -0.6,
    hairMass: 0.6,
    sprawl: 1,
  }, {
    color: C_CORPSE,
    alpha: Math.min(1, a * 2.1),
    bulk: BULK_BODY,
    inkSeed: 700 + b.slot * 31,
    shade: C_BG,
    style: 'silhouette',
  });

  // 십자 마커 — 쓰러진 몸 위에 얹어 "실패한 자리"를 못 박는다.
  ctx.strokeStyle = withAlpha(C_CORPSE, a * 2.4);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 5);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.moveTo(cx + 5, cy - 5);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.stroke();

  labels.push({
    text: SLOT_NAMES[b.slot] ?? '?',
    cx,
    baseY: y - 5,
    color: C_CORPSE,
    alpha: Math.min(1, a * 2.6),
  });
}

function drawGuards(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const g of s.guards) {
    const x = P(g.x);
    const y = P(g.y);
    const cx = x + GUARD_SIZE / 2;
    const cy = y + GUARD_SIZE / 2;
    const top = cy - FIG_R_GUARD;

    if (g.state === 'CHASE') {
      const pulse = 0.3 + Math.sin(view.frame * 0.3) * 0.16;
      const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, GUARD_SIZE * 1.5);
      halo.addColorStop(0, withAlpha(C_GUARD, pulse));
      halo.addColorStop(1, withAlpha(C_GUARD, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(
        cx - GUARD_SIZE * 1.5,
        cy - GUARD_SIZE * 1.5,
        GUARD_SIZE * 3,
        GUARD_SIZE * 3,
      );
    }

    floorTint(ctx, cx, cy, GUARD_SIZE * 0.9, C_GUARD, 0.26);
    bodyShadow(ctx, cx, cy, SHADOW_W_GUARD, 0.35);
    facingPip(ctx, cx, cy, g.facing, '#ffb0a8', 24, 7);

    // 간수는 플레이어와 **체형부터** 다르다: 몸통 긴 축 28(플레이어 22), 머리 14(13),
    // 팔다리가 굵고(bulk), 상체가 덜 흔들린다(warden). 한눈에 "저건 내가 아니다".
    const gg = view.guardGaits.get(g.id);
    drawTopFigure(
      ctx,
      cx,
      cy,
      FIG_W * gaitLift(gg),
      gg?.drawAng ?? angleOf(g.facing),
      topPose({
        phase: gg?.phase ?? 0,
        run: gg?.run ?? 0,
        motion: gg?.motion ?? 0,
        lean: leanOf(gg),
        hairMass: 0.26,
        warden: true,
      }),
      {
        color: C_GUARD,
        outline: '#ff9a90',
        shade: '#2a0d0b',
        bulk: BULK_GUARD,
        inkSeed: 900 + g.id * 17,
      },
    );

    // 감지 게이지 — 언제 SUSPICIOUS 로 넘어가는지 플레이어가 읽을 수 있어야 한다.
    if (g.detect > 0) {
      const w = 26;
      const frac = Math.max(0, Math.min(1, g.detect / DETECT_MAX));
      ctx.fillStyle = withAlpha('#000000', 0.6);
      ctx.fillRect(cx - w / 2, top - 8, w, 4);
      ctx.fillStyle = frac >= 1 ? C_GUARD : frac >= 0.4 ? '#ffb057' : '#ffe08a';
      ctx.fillRect(cx - w / 2, top - 8, w * frac, 4);
    }

    const tag =
      g.state === 'CHASE'
        ? '!'
        : g.state === 'SUSPICIOUS' || g.state === 'INVESTIGATE'
          ? '?'
          : '';
    if (tag !== '') {
      ctx.fillStyle = C_GUARD;
      ctx.font = font(13, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(tag, cx, top - 12);
    }

    // WARDEN(간수). 감지 게이지와 !/? 는 위쪽을 이미 쓰고 있으니 라벨은 발밑에.
    ctx.fillStyle = withAlpha(C_GUARD, 0.5);
    ctx.font = font(7, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('WARDEN', cx, y + GUARD_SIZE + 9);
  }
}

/** 조작 중인 몸(I). 항상 최상단, 항상 불투명. */
function drawLive(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  const b = s.bodies.find((x) => x.isLive);
  if (b === undefined) return;
  const x = P(b.x);
  const cx = x + BODY_SIZE / 2;
  const cy = figCy(b.y);
  const top = figTop(b.y);
  const pulse = 1 + Math.sin(view.frame * 0.12) * 0.06;

  // 후광은 **인물보다 어두워야** 한다. 링이 밝으면 캐릭터가 아니라 조준경으로 읽힌다.
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 28 * pulse);
  glow.addColorStop(0, withAlpha(C_I_RING, 0.16));
  glow.addColorStop(1, withAlpha(C_I_RING, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 30, cy - 30, 60, 60);

  // 나만 바닥 얼룩이 밝다. 비네트·주사선이 깔린 위에서도 이 흰 자국이 시선을 붙잡는다.
  floorTint(ctx, cx, cy, FIG_W, C_I_CORE, 0.3);
  bodyShadow(ctx, cx, cy, SHADOW_W, 0.35);

  // 발밑 시안 링 **하나**. 잔상 셋과 간수 둘이 겹쳐도 바닥에서 조작 중인 몸을 못 박되,
  // 인물 위로는 한 겹도 얹지 않는다 — 동심원을 두 개 겹치면 사람이 아니라 뱃지가 된다.
  // 반지름은 팔 끝(어깨 반폭 11 + 팔 3.5) 밖이라 실루엣을 가로지르지 않는다.
  ctx.strokeStyle = withAlpha(C_I_RING, 0.5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 18 * pulse, 13 * pulse, 0, 0, TAU);
  ctx.stroke();

  facingPip(ctx, cx, cy, b.facing, C_I_RING, 19, 6);

  // 흰 코어 + 시안 림라이트. 화면에서 가장 밝고, drawWorld 순서상 가장 위 레이어다.
  const gait = view.gaits.get(b.id);
  drawTopFigure(
    ctx,
    cx,
    cy,
    FIG_W * gaitLift(gait),
    gait?.drawAng ?? angleOf(b.facing),
    topPose({
      phase: gait?.phase ?? 0,
      run: gait?.run ?? 0,
      motion: gait?.motion ?? 0,
      lean: leanOf(gait),
      hairMass: 0.6,
    }),
    {
      color: C_I_CORE,
      outline: C_I_RING,
      shade: '#0a1018',
      bulk: BULK_BODY,
      inkSeed: 401,
    },
  );

  // 바깥 펄스 링은 없앴다. 접지 링과 합쳐 동심원 두 겹이 되는 순간 인물이 표적 마커로
  // 읽히고, 정작 머리와 어깨가 안 보인다. 밀집 상황의 식별은 링 하나 + 머리 위 `I` 로 한다.

  ctx.fillStyle = C_I_CORE;
  ctx.font = font(9, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('I', cx, top - 4);
}

/**
 * 시선 방향 표시. **바닥에 찍는 작은 화살촉**이다.
 *
 * 선분을 쓰면 인물 위를 지날 때 빗금으로 읽히고, 반투명 잔상에서는 몸을 통과해 보여서
 * 허공에 뜬 대시처럼 보인다. 화살촉은 어디에 놓여도 방향으로 읽힌다 —
 * 경비 시야 회피가 전부 이 정보에 걸려 있으므로 모호해지면 안 된다.
 */
function facingPip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  facing: number,
  color: string,
  dist: number,
  size: number,
): void {
  const a = angleOf(facing);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // 3/4 탑다운이라 바닥이 세로로 살짝 눌려 보인다. 화살촉도 같이 눌러야 바닥에 누운 것처럼 보인다.
  const fy = 0.82;
  const bx = cx + dx * dist;
  const by = cy + dy * dist * fy;
  const tx = cx + dx * (dist + size);
  const ty = cy + dy * (dist + size) * fy;
  const px = -dy * size * 0.5;
  const py = dx * size * 0.5 * fy;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + px, by + py);
  ctx.lineTo(bx - px, by - py);
  ctx.closePath();
  ctx.fill();
}

function drawRings(ctx: CanvasRenderingContext2D, view: ViewState): void {
  for (const r of view.rings) {
    if (r.age < 0) continue;
    const t = r.age / r.life;
    ctx.strokeStyle = withAlpha(r.color, (1 - t) * 0.8);
    ctx.lineWidth = Math.max(1, 3 * (1 - t));
    ctx.beginPath();
    ctx.arc(r.x, r.y, 6 + r.radius * t, 0, Math.PI * 2);
    ctx.stroke();
  }
}
