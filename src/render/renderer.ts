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
  BODY_SUB,
  CANVAS_H,
  CANVAS_W,
  CCTV_FOV_TAN,
  CCTV_RANGE,
  CRATE_SIZE,
  DETECT_MAX,
  DIR_STEPS,
  GUARD_KINDS,
  IN_RUN,
  SLOT_NAMES,
  SUBPIXEL,
  TAN_SCALE,
  TILE,
} from "../sim/constants";
import type {
  Body,
  Guard,
  SimState,
  SlotIndex,
  TickEvents,
} from "../sim/types";
import * as sprites from "./sprites";
import {
  drawTopFigure,
  STRIDE_PX,
  TOP_BUILD,
  topPose,
  topQuadReach,
} from "./figure";
import {
  drawNoteDecals,
  drawNoteOverlay,
  drawNotePrompt,
  updateNotes,
} from "./note";
import {
  A_CONE_CCTV,
  A_CONE_CHASE,
  A_CONE_PATROL,
  A_CONE_SUSPICIOUS,
  A_CORPSE,
  A_FRINGE,
  A_GHOST_OUTLINE,
  A_GRAIN,
  A_GRAIN_FLOOR,
  A_LAMP_DIP,
  A_LIGHT_FALLOFF,
  A_SLOT,
  A_VIGNETTE,
  C_BG,
  C_CCTV,
  C_CCTV_SCAN,
  C_CORPSE,
  C_DARK_AIR,
  C_ESCAPE_LOCKED,
  C_ESCAPE_OPEN,
  C_FLOOR,
  C_FLOOR_DARK,
  C_FLOOR_PALE,
  C_GRIME,
  C_GUARD,
  C_FLOOR_MARK,
  C_HAZARD,
  C_I_CORE,
  C_I_RING,
  C_LAMP,
  C_LAMP_CASE,
  C_LOOT,
  C_LOOT_DARK,
  C_LOOT_LIT,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIP,
  C_OFF,
  C_ON,
  C_RUST,
  C_SEAM,
  C_SEAM_LIP,
  C_SLOT,
  C_VOID,
  C_WALL,
  C_WALL_LIP,
  C_WALL_TOP,
  LIGHT_AMBIENT,
  font,
  mulHex,
  withAlpha,
} from "./palette";

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

// ── 지하 시설의 물리 치수 ──────────────────────────────────────────────────
//
// 이 블록이 "사이버 공간"과 "지하 감옥"을 가르는 전부다. 벽은 두께를 가진 덩어리로
// 그려지고(윗면/측면/립/바닥 그림자), 천장 형광등이 **빛 웅덩이**를 만들고 그 밖은
// 강하게 떨어진다. 격자선은 없다 — 바닥 구획은 불규칙한 콘크리트 이음새가 대신한다.

/** 벽 측면(카메라 쪽 두께)의 높이(px). **벽 타일 안쪽**에만 그린다 — 밖으로 나가면 통행 가능한 칸을 잡아먹어 충돌 판정과 그림이 어긋난다. */
const WALL_SIDE_H = 7;
/** 벽이 바닥에 드리우는 그림자 길이(px, 아래쪽). 빛이 천장에서 오므로 아래로만 진다. */
const WALL_SHADOW_H = 13;
/** 벽 옆면이 바닥에 드리우는 그림자 폭(px). 위/아래보다 짧다 — 측면 앰비언트 오클루전. */
const WALL_SHADOW_W = 7;
/** 벽 그림자 시작 알파. */
const A_WALL_SHADOW = 0.5;

/** 천장 형광등 격자 간격(타일). x 는 빛 웅덩이보다 좁아 겹치고, y 는 넓어 **어두운 띠**를 남긴다. */
const LAMP_STEP_X = 5;
const LAMP_STEP_Y = 4;
/** 격자 위상. 방 가운데에 등이 오도록 민다. */
const LAMP_PHASE_X = 2;
const LAMP_PHASE_Y = 2;
/** 빛 웅덩이 반경(px). 형광등은 막대라 가로로 길다. */
const LAMP_RX = 116;
const LAMP_RY = 76;
/**
 * 형광등 기구 크기(px). 등은 격자 위 타일 중앙에 놓이므로 **인물이 그 위를 지나간다** —
 * 굵은 막대면 인물 뒤에 밝은 판이 깔려 실루엣이 죽는다. 얇은 띠로 두면 "먼 천장의 기구"로
 * 읽히고, 공간을 밝히는 일은 빛 웅덩이(LAMP_RX/RY)가 대신한다.
 */
const LAMP_TUBE_W = 40;
const LAMP_TUBE_H = 3;

/** 콘크리트 골재 노이즈 타일 한 변(px). 64 면 반복이 눈에 안 잡힌다. */
const GRAIN_TILE = 64;
/** 그레인 드리프트 단계 수 / 몇 프레임마다 한 칸 미는지. **난수 아님** — 결정론적 순환이다. */
const GRAIN_STEPS = 8;
const GRAIN_HOLD = 7;

/** 접지 그림자: 물체 바로 아래 진한 코어의 반경 배율(가로 = w × 이 값). */
const SHADOW_CORE_RX = 0.36;
const SHADOW_CORE_RY = 0.19;
const A_SHADOW_CORE = 0.55;
/** 접지 그림자: 멀어지며 흐려지는 바깥 halo 반경 배율. */
const SHADOW_SOFT_R = 0.85;
const A_SHADOW_SOFT = 0.3;
/** 그림자가 아래로 밀리는 양(w 배율). 빛이 천장에서 오므로 발밑에서 약간 아래. */
const SHADOW_DROP = 0.12;

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
/** 라벨·꺾쇠가 피해야 하는 인물 반경(px). 어깨 반폭(11) + 팔(3.5) + 여유. */
const FIG_R = FIG_W * 0.68;
/** 접지 그림자 가로 폭(px). 세로는 절반, 알파는 0.35 — 바닥에 앉히는 가장 강력한 장치다. */
const SHADOW_W = 20;

/**
 * 경비 몸 크기(px) → 인물 작도 기준 단위.
 *
 * **경비의 그림 크기는 시뮬의 충돌 박스에서 파생된다** — 그래야 BRUTE 의 40px 박스가
 * 화면에서도 40px 짜리 덩치로 보이고, "저건 좁은 길에 못 들어온다"가 눈으로 검증된다.
 * 비율은 SENTRY(26px)가 예전 값 22 와 **정확히** 같아지도록 잡았다(22/26).
 */
const FIG_U_PER_BODY = FIG_W / GUARD_KINDS.SENTRY.size;

/** 이 개체의 작도 기준 단위(px). 표가 아니라 **개체의 `sizeSub`** 에서 읽는다. */
function guardFigU(g: Guard): number {
  return P(g.sizeSub) * FIG_U_PER_BODY;
}

/**
 * 이 개체의 **그려지는 어깨 폭**(px). 그림자·라벨·게이지 폭이 전부 여기서 파생된다 —
 * 한 곳에서 나와야 덩치가 커질 때 UI 만 옛 크기로 남는 일이 없다.
 * SENTRY 27.9 / HOUND 18.7 / BRUTE 51.4 / WATCHER 24.9 px.
 */
function guardShoulderPx(g: Guard): number {
  return guardFigU(g) * TOP_BUILD[g.kind].shoulder;
}

/** 이 개체의 접지 그림자 폭(px). SENTRY 에서 예전 값 25.4 가 그대로 나온다. */
function guardShadowW(g: Guard): number {
  return guardShoulderPx(g) * (SHADOW_W / FIG_W);
}

/**
 * 라벨·게이지·꺾쇠가 피해야 하는 **그려진 실루엣의 최대 반경**(px).
 *
 * 충돌 박스 반폭으로 잡으면 안 된다 — BRUTE 는 그려진 어깨(51px)가 박스(40px)보다
 * 넓어서 라벨이 몸에 깔리고, WATCHER 는 삼각대가 몸통 밖으로 한참 뻗는다.
 * 인물이 회전해도 값이 흔들리지 않도록 **모든 방향의 최대치**를 쓴다.
 */
function guardDrawR(g: Guard): number {
  const u = guardFigU(g);
  const b = TOP_BUILD[g.kind];
  // 네발 유형은 앞뒤(코~꼬리)가 실루엣의 최대 치수라, 사람 기준의 어깨·머리 계산이
  // 통째로 틀린다. 치수는 `figure.ts` 가 한 번만 정한다 — 그리는 쪽과 피하는 쪽이
  // 다른 수를 쓰면 라벨이 몸에 깔린다.
  if (b.quad === true) return Math.max(guardSizePx(g) / 2, topQuadReach(u, b));
  /** 팔 원과 잉크 지터가 실루엣 밖으로 삐져나오는 여유. 기존 `FIG_R` 의 0.68 = 0.5 × 1.36. */
  const M = 1.36;
  const longR = u * 0.5 * b.shoulder;
  const shortR = u * (15 / 22) * 0.5 * b.shoulder * b.girth;
  const headReach = u * (3 / 22) * b.headFwd + u * (13 / 22) * 0.5 * b.head;
  return Math.max(
    guardSizePx(g) / 2,
    longR * M,
    shortR * M,
    headReach * M,
    // 삼각대 도달 거리(`figure.ts` 의 `torsoLongR * 2.2`).
    longR * 2.2 * b.mount,
  );
}

/** 경비 몸 크기(px). 중심 좌표 계산용. */
function guardSizePx(g: Guard): number {
  return P(g.sizeSub);
}

/**
 * WATCHER 경보 이펙트가 지속되는 틱 수.
 *
 * 경보는 다른 경비가 전부 이쪽으로 오게 만드는 사건이라 **놓치면 그 판이 끝난다.**
 * 그래서 화면 신호가 링 한 겹으로는 부족하고, 콘을 훑고 지나가는 섬광까지 붙인다.
 * 재발령 잠금(`ALARM_COOLDOWN_TICKS` = 120)보다 짧아야 이펙트가 겹쳐 밀리지 않는다.
 */
const ALARM_FX_TICKS = 30;
/**
 * 플레이어·잔상의 **팔·다리** 굵기 배율. 머리·몸통 비례는 작도법에 고정이라 여기 안 걸린다.
 * 기본 굵기를 쓰면 팔이 1px 선이 되어 주사선·시야콘 위에서 사라진다.
 */
const BULK_BODY = 1.1;
/**
 * 경비의 팔·다리 굵기. 덩치의 본체는 여기가 아니라 `topPose({warden:true})` 의
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
  /**
   * guardId → 직전 틱의 `alarmCooldown`.
   *
   * 경보가 **울린 순간**을 잡는 유일하게 정직한 방법이다: 잠금 카운터는 매 틱 줄어들다가
   * 발령 순간에만 위로 튄다. `state` 를 보면 WATCHER 는 CHASE 에 들어가지 않으므로 못 잡고,
   * `s.alerts` 는 누가 울렸는지 알려주지 않는다. 읽기만 하므로 결정론과 무관하다.
   */
  guardAlarmPrev: Map<number, number>;
  /** guardId → 경보 이펙트 잔여 틱(0 = 없음). */
  guardAlarmFx: Map<number, number>;
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

  // ── 에셋 애니메이션 (전부 렌더 전용. 시뮬은 이 값을 읽지도 쓰지도 않는다) ──
  /** grate id → 소음 파문 남은 프레임. 0 이면 대기 프레임으로 돌아간다. */
  grateFx: Map<number, number>;
  /** 터진 눈뽕 이펙트. 한 번 재생하고 사라진다(반복 없음). */
  booms: { x: number; y: number; f: number }[];
  /** bodyId → 직전 프레임의 `hasFlash`. false 로 떨어진 순간이 터진 순간이다. */
  flashHeldPrev: Map<number, boolean>;
  /** bus 이름 → 직전 activeIndex. 바뀌면 전환 애니메이션을 한 번 재생한다. */
  busPrev: Map<string, number>;
  /** bus 이름 → 전환 애니메이션 남은 프레임. */
  busFx: Map<string, number>;
  /** crate id → 직전 프레임 위치. 움직인 상자만 밀림 프레임을 쓴다. */
  cratePrev: Map<number, { x: number; y: number }>;
}

export function createView(): ViewState {
  return {
    frame: 0,
    trails: new Map(),
    gaits: new Map(),
    guardGaits: new Map(),
    guardAlarmPrev: new Map(),
    guardAlarmFx: new Map(),
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
    grateFx: new Map(),
    booms: [],
    flashHeldPrev: new Map(),
    busPrev: new Map(),
    busFx: new Map(),
    cratePrev: new Map(),
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
/** 소음 파문(A3) 프레임 수 — 2~5번 프레임을 4프레임씩 보여 준다. */
const GRATE_FX_FRAMES = 16;
/** 눈뽕 폭발(A2) 8프레임을 3프레임씩. 반복하지 않는다. */
const BOOM_FX_FRAMES = 24;
/** 전력 전환(A5) 3~6번 프레임을 4프레임씩. */
const BUS_FX_FRAMES = 16;

/**
 * 에셋 애니메이션 상태를 한 프레임 굴린다.
 *
 * 전부 `SimState` 를 **읽기만** 한다. 여기서 시뮬 필드를 하나라도 쓰면 잔상
 * 재생이 어긋나고 결정론이 무너진다 (SPEC §4). 그래서 "터졌다"·"소리가 났다"
 * 같은 사건도 시뮬에 플래그를 새로 다는 대신, 이미 있는 상태의 **변화**로 읽는다.
 */
function stepAssetFx(view: ViewState, s: SimState): void {
  // 소음 파문 — 이번 틱에 실제로 난 소리만. 가만히 서 있으면 s.noises 가 비므로
  // 파문도 서지 않는다("서 있으면 무음"이라는 grate 규칙이 그대로 그림이 된다).
  for (const [id, left] of view.grateFx) {
    if (left <= 1) view.grateFx.delete(id);
    else view.grateFx.set(id, left - 1);
  }
  for (const n of s.noises) {
    if (n.radius <= 0) continue;
    for (const g of s.grates) {
      if (n.x >= g.x && n.x < g.x + g.w && n.y >= g.y && n.y < g.y + g.h) {
        view.grateFx.set(g.id, GRATE_FX_FRAMES);
      }
    }
  }

  // 눈뽕 폭발 — 들고 있던 몸이 이번 프레임에 빈손이 되면 그 자리에서 터진 것이다.
  for (const b of s.bodies) {
    const had = view.flashHeldPrev.get(b.id) ?? false;
    if (had && !b.hasFlash && b.alive) {
      view.booms.push({
        x: P(b.x + BODY_SUB / 2),
        y: P(b.y + BODY_SUB / 2),
        f: BOOM_FX_FRAMES,
      });
    }
    view.flashHeldPrev.set(b.id, b.hasFlash);
  }
  for (let i = view.booms.length - 1; i >= 0; i--) {
    const b = view.booms[i]!;
    b.f--;
    if (b.f <= 0) view.booms.splice(i, 1);
  }

  // 전력 전환 — activeIndex 가 옮겨간 순간에만 한 번.
  for (const [bus, left] of view.busFx) {
    if (left <= 1) view.busFx.delete(bus);
    else view.busFx.set(bus, left - 1);
  }
  for (const bus of s.powerBuses) {
    const prev = view.busPrev.get(bus.bus);
    if (prev !== undefined && prev !== bus.activeIndex) {
      view.busFx.set(bus.bus, BUS_FX_FRAMES);
    }
    view.busPrev.set(bus.bus, bus.activeIndex);
  }
}

export function updateView(
  view: ViewState,
  s: SimState,
  events: TickEvents,
): void {
  view.frame++;
  stepAssetFx(view, s);

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
  const rewound =
    s.tick < view.lastTick || s.bodies.length !== view.lastBodyCount;
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
      camX = Math.round(
        Math.max(CANVAS_W - worldW, Math.min(0, CANVAS_W / 2 - fx)),
      );
    }
    if (worldH > availH) {
      camY = Math.round(
        Math.max(
          CANVAS_H - VIEW_BOTTOM - worldH,
          Math.min(VIEW_TOP, VIEW_TOP + availH / 2 - fy),
        ),
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
      g.state === "CHASE",
      false,
    );

    // ── WATCHER 경보 ──
    // 잠금 카운터가 **위로 튄** 틱이 곧 발령 순간이다. 첫 프레임에는 직전값이 없으므로
    // 현재값으로 초기화해 둔다 — 레벨 진입 즉시 가짜 경보가 터지는 걸 막는다.
    const prevAlarm = view.guardAlarmPrev.get(g.id);
    if (prevAlarm !== undefined && g.alarmCooldown > prevAlarm) {
      view.guardAlarmFx.set(g.id, ALARM_FX_TICKS);
      const acx = P(g.x) + guardSizePx(g) / 2;
      const acy = P(g.y) + guardSizePx(g) / 2;
      // 방사 링 3겹을 시차로 쏜다. 한 겹은 게이트 토글과 헷갈리고, 세 겹이면
      // "여기서 뭔가 퍼져 나갔다"가 화면 어디를 보고 있어도 주변시로 잡힌다.
      for (let i = 0; i < 3; i++) {
        view.rings.push({
          x: acx,
          y: acy,
          age: -i * 5,
          life: 30,
          radius: 104,
          color: C_GUARD,
        });
      }
      view.flash = Math.max(view.flash, 0.28);
      view.flashColor = C_GUARD;
    }
    view.guardAlarmPrev.set(g.id, g.alarmCooldown);

    const fx = view.guardAlarmFx.get(g.id) ?? 0;
    if (fx > 0) view.guardAlarmFx.set(g.id, fx - 1);
  }
  for (const id of [...view.guardGaits.keys()]) {
    if (!guardSeen.has(id)) view.guardGaits.delete(id);
  }
  for (const id of [...view.guardAlarmPrev.keys()]) {
    if (!guardSeen.has(id)) view.guardAlarmPrev.delete(id);
  }
  for (const id of [...view.guardAlarmFx.keys()]) {
    if (!guardSeen.has(id)) view.guardAlarmFx.delete(id);
  }

  // ── 게이트 개폐 보간 ──
  const gateSeen = new Set<number>();
  for (const g of s.gates) {
    gateSeen.add(g.id);
    const target = g.open ? 1 : 0;
    const cur = view.gateAnim.get(g.id) ?? target;
    const step = 1 / GATE_LERP_TICKS;
    const next =
      cur < target
        ? Math.min(target, cur + step)
        : Math.max(target, cur - step);
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
      if (g.state === "CHASE") {
        view.rings.push({
          x: P(g.x) + guardSizePx(g) / 2,
          y: P(g.y) + guardSizePx(g) / 2,
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

  // 환경 단서(`note.ts`)도 렌더 전용 레이어다. `SimState` 를 읽기만 하므로
  // 여기 끼워 넣어도 결정론은 그대로다 — 그 불변은 tests/notes.test.ts 가 지킨다.
  updateNotes(s);
}

// ── 그리기 ─────────────────────────────────────────────────────────────────

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  ctx.imageSmoothingEnabled = false;
  // 월드 밖은 검정 보이드가 아니다 — 지하 시설이므로 **더 어두운 콘크리트**다.
  ctx.fillStyle = C_VOID;
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

  // 바닥·벽·조명은 레벨마다 한 번 굽는다(격자선 없음, 시드 고정 얼룩·이음새 포함).
  drawBakedWorld(ctx, s);
  // 소음 바닥은 **바닥의 일부**다 — 구운 바닥 바로 위, 나머지 전부의 아래.
  drawGrates(ctx, s, view);
  // 단서는 바닥에 놓인 물건이다 — 장치·몸보다 아래, 구운 바닥보다 위.
  drawNoteDecals(ctx, s, (x, y) => shadeAt(s, x, y));
  drawGates(ctx, s, view);
  drawPowerPanels(ctx, s, view);
  drawDevices(ctx, s);
  drawCrates(ctx, s, view);
  drawFlashPickups(ctx, s, view);
  drawCctvs(ctx, s, view);
  drawGuardCones(ctx, s, view);
  // 레이저는 몸보다 **아래**다. 위에 그리면 빔이 사람을 덮어 누가 어디 있는지 놓친다.
  drawLasers(ctx, s, view);
  drawGoals(ctx, s, view);
  drawGhosts(ctx, s, view);
  drawGuards(ctx, s, view);
  drawLive(ctx, s, view);
  // 폭발은 월드에서 가장 위 — 몸까지 덮어야 "터졌다"로 읽힌다.
  drawBooms(ctx, view);
  drawRings(ctx, view);
  // 키캡은 몸보다 위에 뜬다 — 잔상 뒤에 가려지면 안내가 안내로 기능하지 않는다.
  drawNotePrompt(ctx, s);

  ctx.restore();

  // ── 시설 레이어(전부 화면 공간) ──
  // 순서가 중요하다: 등이 꺼지고 → 가장자리가 죽고 → 그 위에 필름 질감(그레인·색수차).
  if (view.lampFrames > 0) {
    ctx.fillStyle = withAlpha("#000000", A_LAMP_DIP);
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  drawVignette(ctx);
  drawGrain(ctx, view.frame);
  drawFringe(ctx);
  // 펼쳐 든 문서. 필름 질감 **위**에 얹어야 손에 든 종이로 읽힌다 —
  // 그레인 아래에 두면 바닥에 그려진 그림과 구분되지 않는다.
  drawNoteOverlay(ctx, s);

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
    const g = ctx.createRadialGradient(
      cx,
      cy,
      CANVAS_H * 0.4,
      cx,
      cy,
      CANVAS_W * 0.72,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.6, withAlpha("#000000", A_VIGNETTE * 0.3));
    g.addColorStop(1, withAlpha("#000000", A_VIGNETTE));
    vignetteGrad = g;
    vignetteCtx = ctx;
  }
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// ── 시드 고정 텍스처 ───────────────────────────────────────────────────────
//
// **얼룩·균열·그레인은 프레임마다 뽑지 않는다.** Math.random() 을 매 프레임 부르면
// 콘크리트가 TV 노이즈처럼 지직거린다. 아래 값은 전부 고정 시드에서 한 번 생성해
// 레벨이 바뀔 때까지 재사용한다(그레인 드리프트도 난수가 아니라 결정론적 순환이다).

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

interface GrainSlot {
  tile?: HTMLCanvasElement;
  pat?: CanvasPattern;
  ctx?: CanvasRenderingContext2D;
}
/** 0 = 필름 그레인(1px 알갱이), 1 = 콘크리트 골재(2px 알갱이). */
const grainSlots: GrainSlot[] = [{}, {}];

/**
 * 흑백 알갱이 타일.
 *
 * `cell` 이 알갱이 한 알의 픽셀 크기다 — 필름 그레인은 1px(고주파), 콘크리트 골재는
 * 2px(굵은 반점). 그리고 **알파에 문턱을 준다**: 임계 미만은 완전히 투명하게 버려
 * 알갱이가 드문드문 박히게 만든다. 문턱이 없으면 모든 픽셀이 조금씩 흔들려
 * 콘크리트가 아니라 TV 노이즈가 된다.
 */
function grainPattern(
  ctx: CanvasRenderingContext2D,
  slot: 0 | 1,
): CanvasPattern | undefined {
  const s = grainSlots[slot];
  if (s === undefined) return undefined;
  const cell = slot === 0 ? 1 : 2;
  const cut = slot === 0 ? 0.45 : 0.3;
  if (s.tile === undefined) {
    if (typeof document === "undefined") return undefined;
    const cv = document.createElement("canvas");
    cv.width = GRAIN_TILE;
    cv.height = GRAIN_TILE;
    const g = cv.getContext("2d");
    if (g === null) return undefined;
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    const cells = GRAIN_TILE / cell;
    const rnd = seeded(0x51ed270b + slot * 0x9e37);
    const noise = new Float64Array(cells * cells);
    for (let i = 0; i < noise.length; i++) noise[i] = rnd();
    for (let y = 0; y < GRAIN_TILE; y++) {
      for (let x = 0; x < GRAIN_TILE; x++) {
        const v =
          noise[Math.floor(y / cell) * cells + Math.floor(x / cell)] ?? 0.5;
        const p = (y * GRAIN_TILE + x) * 4;
        // 밝은 알갱이 절반, 어두운 알갱이 절반. 무채색이라 어떤 색 위에 얹어도 색조를 밀지 않는다.
        const lum = v > 0.5 ? 255 : 0;
        img.data[p] = lum;
        img.data[p + 1] = lum;
        img.data[p + 2] = lum;
        const mag = Math.abs(v - 0.5) * 2;
        img.data[p + 3] =
          mag <= cut ? 0 : Math.round(((mag - cut) / (1 - cut)) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    s.tile = cv;
  }
  if (s.pat === undefined || s.ctx !== ctx) {
    const p = ctx.createPattern(s.tile, "repeat");
    if (p === null) return undefined;
    s.pat = p;
    s.ctx = ctx;
  }
  return s.pat;
}

/**
 * 필름 그레인. 애니메이션의 필름 질감 담당.
 *
 * 드리프트는 **결정론적 8단 순환**이다(7프레임마다 8px). 매 프레임 새 난수를 뽑으면
 * 화면이 지직거려 잔상 실루엣 경계가 무너진다 — 느린 순환이면 "살아 있는 필름"까지만 간다.
 */
function drawGrain(ctx: CanvasRenderingContext2D, frame: number): void {
  const pat = grainPattern(ctx, 0);
  if (pat === undefined) return;
  const step = GRAIN_TILE / GRAIN_STEPS;
  const k = Math.floor(frame / GRAIN_HOLD) % GRAIN_STEPS;
  const ox = k * step;
  const oy = ((k * 3) % GRAIN_STEPS) * step;
  ctx.save();
  ctx.globalAlpha = A_GRAIN;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(ox, oy, CANVAS_W, CANVAS_H);
  ctx.restore();
}

let fringeL: CanvasGradient | undefined;
let fringeR: CanvasGradient | undefined;
let fringeCtx: CanvasRenderingContext2D | undefined;

/**
 * 아주 약한 색수차. 렌즈 가장자리에서 붉은기/청록기가 갈리는 필름 특유의 흠이다.
 *
 * ponytail: 진짜 색수차는 화면을 RGB 채널별로 밀어 3패스로 합성해야 한다. 여기서는
 * 가장자리 그라디언트 두 장으로 대신한다 — 매 프레임 전면 재합성 3회를 피하고,
 * **화면 중앙(= 조작 몸이 있는 곳)의 색을 한 톤도 건드리지 않는 것**이 더 중요하기 때문이다.
 * 업그레이드 경로: 여벌 캔버스에 월드를 그린 뒤 채널 오프셋 합성으로 교체.
 */
function drawFringe(ctx: CanvasRenderingContext2D): void {
  if (fringeL === undefined || fringeR === undefined || fringeCtx !== ctx) {
    const edge = CANVAS_W * 0.22;
    const l = ctx.createLinearGradient(0, 0, edge, 0);
    l.addColorStop(0, withAlpha("#ff4a3c", A_FRINGE));
    l.addColorStop(1, withAlpha("#ff4a3c", 0));
    const r = ctx.createLinearGradient(CANVAS_W, 0, CANVAS_W - edge, 0);
    r.addColorStop(0, withAlpha("#3ce0ff", A_FRINGE));
    r.addColorStop(1, withAlpha("#3ce0ff", 0));
    fringeL = l;
    fringeR = r;
    fringeCtx = ctx;
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = fringeL;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = fringeR;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

// ── 실용 조명 ──────────────────────────────────────────────────────────────

interface Lamp {
  x: number;
  y: number;
}

/**
 * `(x, y)` 위치의 광량(0..1). 조명 웅덩이 안이면 1 에 가깝고 밖이면 `LIGHT_AMBIENT`.
 *
 * 베이킹된 감쇠 마스크와 **같은 감쇠 곡선**을 쓴다. CORE 처럼 "조명받는 금속"으로
 * 그려야 하는 오브젝트가 실제로 어두운 자리에서 어두워지려면 런타임에도 이 값이 필요하다.
 */
function lightAt(lamps: Lamp[], x: number, y: number): number {
  let best = 0;
  for (const l of lamps) {
    const dx = (x - l.x) / LAMP_RX;
    const dy = (y - l.y) / LAMP_RY;
    const d = Math.hypot(dx, dy);
    if (d >= 1) continue;
    const t = 1 - d;
    const v = t * t * (3 - 2 * t);
    if (v > best) best = v;
  }
  return LIGHT_AMBIENT + (1 - LIGHT_AMBIENT) * best;
}

/**
 * 천장 형광등 배치. 격자 위에 놓되 **벽에 박힌 등은 옆으로 밀어** 살린다 —
 * 그래야 좁은 방도 등 하나는 얻고, 동시에 격자가 그대로 드러나지 않는다.
 */
function placeLamps(s: SimState): Lamp[] {
  const lamps: Lamp[] = [];
  for (let ty = LAMP_PHASE_Y; ty < s.height; ty += LAMP_STEP_Y) {
    for (let tx = LAMP_PHASE_X; tx < s.width; tx += LAMP_STEP_X) {
      let px = -1;
      for (const dx of [0, 1, -1, 2, -2]) {
        if (!solidAt(s, tx + dx, ty)) {
          px = tx + dx;
          break;
        }
      }
      if (px < 0) continue;
      lamps.push({ x: px * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
    }
  }
  return lamps;
}

// ── 월드 베이킹 ────────────────────────────────────────────────────────────

interface WorldBake {
  key: string;
  cv: HTMLCanvasElement;
  lamps: Lamp[];
}

let bake: WorldBake | undefined;
/** 벽 배치가 바뀌었는지 판정하는 캐시 키. 레벨이 같으면 굽지 않는다. */
function levelKey(s: SimState): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.solid.length; i++) {
    h = Math.imul(h ^ (s.solid[i] ?? 0), 0x01000193) >>> 0;
  }
  return `${s.width}x${s.height}:${h}`;
}

/** 한쪽 종류의 칸만 클립 경로로 세운다. 바닥 장식이 벽 위로 새지 않게. */
function clipTiles(
  g: CanvasRenderingContext2D,
  s: SimState,
  want: "open" | "solid",
): void {
  g.beginPath();
  for (let ty = 0; ty < s.height; ty++) {
    for (let tx = 0; tx < s.width; tx++) {
      if (solidAt(s, tx, ty) !== (want === "solid")) continue;
      g.rect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  g.clip();
}

/** 부드러운 얼룩 한 점. 균일한 회색을 깨는 유일한 수단이다. */
function blotch(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
): void {
  const gd = g.createRadialGradient(x, y, 0, x, y, r);
  gd.addColorStop(0, withAlpha(color, alpha));
  gd.addColorStop(0.6, withAlpha(color, alpha * 0.45));
  gd.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = gd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * 콘크리트 바닥. **격자선의 대체물이 여기 다 있다.**
 *
 * 구획감은 `신축 줄눈(seam)` 이 만든다 — 3~5타일 간격에 ±7px 지터가 붙어 불규칙하고,
 * 1px 어두운 홈 + 1px 밝은 립으로 "파인 자리"로 읽히며, **발광하지 않는다.**
 * 여기에 골재 반점·물자국·균열·배수 홈이 얹혀 같은 회색이 두 번 반복되지 않는다.
 */
function bakeFloor(g: CanvasRenderingContext2D, s: SimState): void {
  const w = s.width * TILE;
  const h = s.height * TILE;
  const rnd = seeded(0x2f6b1c07);

  g.fillStyle = C_FLOOR;
  g.fillRect(0, 0, w, h);

  // 시멘트 색 편차 — 밝은 반점과 젖은 반점을 섞는다.
  const blotches = Math.round((w * h) / 5200);
  for (let i = 0; i < blotches; i++) {
    const pale = rnd() > 0.45;
    blotch(
      g,
      rnd() * w,
      rnd() * h,
      18 + rnd() * 42,
      pale ? C_FLOOR_PALE : C_FLOOR_DARK,
      0.05 + rnd() * 0.1,
    );
  }

  // 물자국 — 크고 어둡고 경계가 흐리다. 몇 군데만.
  for (let i = 0; i < 5; i++) {
    blotch(g, rnd() * w, rnd() * h, 30 + rnd() * 34, C_FLOOR_DARK, 0.14);
  }

  // 골재 반점.
  const pat = grainPattern(g, 1);
  if (pat !== undefined) {
    g.save();
    g.globalAlpha = A_GRAIN_FLOOR;
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  // 신축 줄눈(세로) — 불규칙 간격 + 지터.
  g.lineWidth = 1;
  for (let x = TILE * (2 + Math.floor(rnd() * 2)); x < w;) {
    const jx = Math.round(x + (rnd() - 0.5) * 14) + 0.5;
    g.strokeStyle = withAlpha(C_SEAM, 0.6);
    g.beginPath();
    g.moveTo(jx, 0);
    g.lineTo(jx, h);
    g.stroke();
    g.strokeStyle = withAlpha(C_SEAM_LIP, 0.22);
    g.beginPath();
    g.moveTo(jx + 1, 0);
    g.lineTo(jx + 1, h);
    g.stroke();
    x += TILE * (3 + Math.floor(rnd() * 3));
  }
  // 가로 줄눈은 더 드물게 — 두 방향이 같은 밀도면 다시 격자로 읽힌다.
  for (let y = TILE * (2 + Math.floor(rnd() * 3)); y < h;) {
    const jy = Math.round(y + (rnd() - 0.5) * 14) + 0.5;
    g.strokeStyle = withAlpha(C_SEAM, 0.5);
    g.beginPath();
    g.moveTo(0, jy);
    g.lineTo(w, jy);
    g.stroke();
    g.strokeStyle = withAlpha(C_SEAM_LIP, 0.18);
    g.beginPath();
    g.moveTo(0, jy + 1);
    g.lineTo(w, jy + 1);
    g.stroke();
    y += TILE * (4 + Math.floor(rnd() * 3));
  }

  // 배수 홈 한 줄 + 배수구. 긴 축을 따라 흐른다.
  const along = w >= h;
  const dPos = Math.round((0.3 + rnd() * 0.4) * (along ? h : w));
  g.fillStyle = withAlpha(C_SEAM, 0.75);
  if (along) g.fillRect(0, dPos, w, 3);
  else g.fillRect(dPos, 0, 3, h);
  g.fillStyle = withAlpha(C_SEAM_LIP, 0.2);
  if (along) g.fillRect(0, dPos - 1, w, 1);
  else g.fillRect(dPos - 1, 0, 1, h);
  const span = along ? w : h;
  for (let d = TILE * 2; d < span; d += TILE * 5) {
    const cx = along ? d : dPos + 1.5;
    const cy = along ? dPos + 1.5 : d;
    g.fillStyle = withAlpha(C_SEAM, 0.9);
    g.beginPath();
    g.arc(cx, cy, 4, 0, TAU);
    g.fill();
  }

  // 균열 — 줄눈에서 갈라져 나온 실금.
  for (let i = 0; i < 6; i++) {
    let cx = rnd() * w;
    let cy = rnd() * h;
    let a = rnd() * TAU;
    g.strokeStyle = withAlpha(C_SEAM, 0.55);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, cy);
    const segs = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < segs; k++) {
      a += (rnd() - 0.5) * 1.5;
      const len = 9 + rnd() * 18;
      cx += Math.cos(a) * len;
      cy += Math.sin(a) * len;
      g.lineTo(cx, cy);
    }
    g.stroke();
  }
}

/**
 * 벽. **위에서 내려다보므로 윗면이 보인다** — 윗면은 밝게, 카메라 쪽 측면은 어둡게,
 * 그리고 바닥에 그림자를 드리운다. 이 세 겹이 벽을 "선"이 아니라 두께 있는 덩어리로 만든다.
 *
 * 측면은 **벽 타일 안쪽**에만 그린다. 밖으로 내밀면 통행 가능한 칸을 그림이 잡아먹어
 * "보이는 곳 = 부딪히는 곳"이 거짓이 된다(그림자만 바깥으로 나간다 — 그건 통행을 막지 않으므로).
 */
function bakeWalls(g: CanvasRenderingContext2D, s: SimState): void {
  for (let ty = 0; ty < s.height; ty++) {
    for (let tx = 0; tx < s.width; tx++) {
      if (!solidAt(s, tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;

      g.fillStyle = C_WALL_TOP;
      g.fillRect(x, y, TILE, TILE);

      // 아래가 뚫려 있으면 카메라 쪽 측면이 보인다: 어두운 면 + 그 위 1px 립.
      if (!solidAt(s, tx, ty + 1)) {
        g.fillStyle = C_WALL;
        g.fillRect(x, y + TILE - WALL_SIDE_H, TILE, WALL_SIDE_H);
        g.fillStyle = withAlpha(C_WALL_LIP, 0.75);
        g.fillRect(x, y + TILE - WALL_SIDE_H - 1, TILE, 1);
      }
      // 위가 뚫려 있으면 그건 벽의 먼 쪽 모서리 — 얇은 하이라이트 한 줄.
      if (!solidAt(s, tx, ty - 1)) {
        g.fillStyle = withAlpha(C_WALL_LIP, 0.45);
        g.fillRect(x, y, TILE, 1);
      }
      // 좌우 측면 두께.
      if (!solidAt(s, tx - 1, ty)) {
        g.fillStyle = withAlpha(C_WALL, 0.75);
        g.fillRect(x, y, 2, TILE);
      }
      if (!solidAt(s, tx + 1, ty)) {
        g.fillStyle = withAlpha(C_WALL, 0.75);
        g.fillRect(x + TILE - 2, y, 2, TILE);
      }
      // 콘크리트 블록 이음. **행마다 반 칸씩 어긋난다** — 벽돌 쌓기라야 규칙적이면서도
      // 격자로 읽히지 않는다. 세로선을 매 칸 같은 자리에 두면 다시 모눈종이가 된다.
      g.fillStyle = withAlpha(C_SEAM, 0.32);
      g.fillRect(x + (ty % 2 === 0 ? 0 : TILE / 2), y, 1, TILE);
      if (solidAt(s, tx, ty - 1)) g.fillRect(x, y, TILE, 1);
    }
  }
}

/** 벽이 바닥에 드리우는 그림자 + 밑동 그라임. 바닥 클립 안에서 호출한다. */
function bakeWallContact(g: CanvasRenderingContext2D, s: SimState): void {
  const rnd = seeded(0x7a3d90f1);
  for (let ty = 0; ty < s.height; ty++) {
    for (let tx = 0; tx < s.width; tx++) {
      if (!solidAt(s, tx, ty)) continue;
      const x = tx * TILE;
      const y = ty * TILE;

      if (!solidAt(s, tx, ty + 1)) {
        const gd = g.createLinearGradient(
          0,
          y + TILE,
          0,
          y + TILE + WALL_SHADOW_H,
        );
        gd.addColorStop(0, withAlpha(C_BG, A_WALL_SHADOW));
        gd.addColorStop(1, withAlpha(C_BG, 0));
        g.fillStyle = gd;
        g.fillRect(x, y + TILE, TILE, WALL_SHADOW_H);

        // 밑동 물때·녹. 아주 미묘하게, 몇 군데만 — 확률을 올리면 벽 전체가 지저분해진다.
        if (rnd() > 0.7) {
          const rust = rnd() > 0.5;
          const n = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const sx = x + 3 + rnd() * (TILE - 8);
            const len = 6 + rnd() * 13;
            g.fillStyle = withAlpha(
              rust ? C_RUST : C_GRIME,
              0.18 + rnd() * 0.18,
            );
            g.fillRect(sx, y + TILE, 1 + Math.floor(rnd() * 2), len);
          }
        }
      }
      if (!solidAt(s, tx - 1, ty)) {
        const gd = g.createLinearGradient(x, 0, x - WALL_SHADOW_W, 0);
        gd.addColorStop(0, withAlpha(C_BG, A_WALL_SHADOW * 0.7));
        gd.addColorStop(1, withAlpha(C_BG, 0));
        g.fillStyle = gd;
        g.fillRect(x - WALL_SHADOW_W, y, WALL_SHADOW_W, TILE);
      }
      if (!solidAt(s, tx + 1, ty)) {
        const gd = g.createLinearGradient(
          x + TILE,
          0,
          x + TILE + WALL_SHADOW_W,
          0,
        );
        gd.addColorStop(0, withAlpha(C_BG, A_WALL_SHADOW * 0.7));
        gd.addColorStop(1, withAlpha(C_BG, 0));
        g.fillStyle = gd;
        g.fillRect(x + TILE, y, WALL_SHADOW_W, TILE);
      }
      // 위쪽 바닥으로도 아주 짧게 — 벽이 바닥에서 솟았다는 접합부.
      if (!solidAt(s, tx, ty - 1)) {
        const gd = g.createLinearGradient(0, y, 0, y - 5);
        gd.addColorStop(0, withAlpha(C_BG, A_WALL_SHADOW * 0.55));
        gd.addColorStop(1, withAlpha(C_BG, 0));
        g.fillStyle = gd;
        g.fillRect(x, y - 5, TILE, 5);
      }
    }
  }
}

/**
 * 조명 감쇠. **방 전체를 균일하게 밝히지 않는 것**이 공간감의 전부다.
 *
 * 어둠 한 장을 깔고 형광등 자리를 `destination-out` 으로 뚫는다 — 뚫는 그라디언트의
 * 알파가 곧 감쇠 곡선이고, 등이 겹치면 자연히 더 밝아진다. 픽셀 루프가 없어 한 번 굽는
 * 비용이 거의 0 이다.
 */
function bakeLightMask(
  s: SimState,
  lamps: Lamp[],
): HTMLCanvasElement | undefined {
  const w = s.width * TILE;
  const h = s.height * TILE;
  if (typeof document === "undefined") return undefined;
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const m = mask.getContext("2d");
  if (m === null) return undefined;

  m.fillStyle = withAlpha(C_DARK_AIR, A_LIGHT_FALLOFF * (1 - LIGHT_AMBIENT));
  m.fillRect(0, 0, w, h);

  m.globalCompositeOperation = "destination-out";
  for (const l of lamps) {
    m.save();
    m.translate(l.x, l.y);
    m.scale(1, LAMP_RY / LAMP_RX);
    const gd = m.createRadialGradient(0, 0, 0, 0, 0, LAMP_RX);
    gd.addColorStop(0, "rgba(0,0,0,1)");
    gd.addColorStop(0.34, "rgba(0,0,0,0.86)");
    gd.addColorStop(0.68, "rgba(0,0,0,0.42)");
    gd.addColorStop(1, "rgba(0,0,0,0)");
    m.fillStyle = gd;
    m.fillRect(-LAMP_RX, -LAMP_RX, LAMP_RX * 2, LAMP_RX * 2);
    m.restore();
  }
  return mask;
}

/**
 * 벽 윗면이 먹는 감쇠 배율.
 *
 * 벽 윗면은 **천장 형광등에 바닥보다 훨씬 가깝다** — 같은 감쇠를 먹이면 조명 웅덩이
 * 밖의 벽이 바닥과 함께 검정으로 뭉쳐서 벽이 사라진다(실측: 벽 윗면 L=0.147,
 * 어두운 바닥 L=0.116 — 구분 불가).
 *
 * 그렇다고 1 에서 너무 멀어지면 반대 사고가 난다: 벽이 조명 웅덩이보다 밝아져 **통행
 * 불가 영역이 화면에서 가장 밝은 면**이 된다. 목표 위계는 `조명 받은 바닥 > 벽 > 어두운
 * 바닥` 이고 0.62 가 그 지점이다(실측 L: 0.325 > 0.29 > 0.12).
 */
const WALL_LIGHT_MIX = 0.62;

/**
 * 천장 형광등 기구. 어둠 위에 얹히므로 감쇠를 먹지 않는다 — **광원 자체**다.
 *
 * 블룸을 기구보다 먼저, 그리고 넉넉하게 깐다. 이게 없으면 회색 막대가 허공에 떠 있는
 * 것으로만 보이고 "이 등이 저 빛 웅덩이를 만들었다"가 연결되지 않는다.
 */
function bakeLamps(g: CanvasRenderingContext2D, lamps: Lamp[]): void {
  for (const l of lamps) {
    // 등 아래가 하얗게 뜨는 느낌. 가로로 길게 — 막대 광원이므로.
    g.save();
    g.translate(l.x, l.y);
    g.scale(1, 0.52);
    blotch(g, 0, 0, 52, C_LAMP, 0.2);
    g.restore();

    g.fillStyle = withAlpha(C_LAMP_CASE, 0.95);
    g.fillRect(
      l.x - LAMP_TUBE_W / 2 - 3,
      l.y - LAMP_TUBE_H / 2 - 3,
      LAMP_TUBE_W + 6,
      LAMP_TUBE_H + 6,
    );
    // 하우징 아래 모서리 그늘 — 기구도 두께가 있다.
    g.fillStyle = withAlpha(C_BG, 0.5);
    g.fillRect(
      l.x - LAMP_TUBE_W / 2 - 3,
      l.y + LAMP_TUBE_H / 2 + 3,
      LAMP_TUBE_W + 6,
      2,
    );
    // 실측 기준: 이 알파에서 튜브 최고 밝기 L≈0.60. 조작 몸(I, L≈0.975)이 화면에서
    // 언제나 가장 밝은 것이어야 하므로 여기를 0.75 이상으로 올리지 말 것.
    g.fillStyle = withAlpha(C_LAMP, 0.62);
    g.fillRect(
      l.x - LAMP_TUBE_W / 2,
      l.y - LAMP_TUBE_H / 2,
      LAMP_TUBE_W,
      LAMP_TUBE_H,
    );
    // 양 끝 소켓 — 막대가 기구에 꽂혀 있다는 표시.
    g.fillStyle = withAlpha(C_METAL_DARK, 0.95);
    g.fillRect(l.x - LAMP_TUBE_W / 2, l.y - LAMP_TUBE_H / 2, 3, LAMP_TUBE_H);
    g.fillRect(
      l.x + LAMP_TUBE_W / 2 - 3,
      l.y - LAMP_TUBE_H / 2,
      3,
      LAMP_TUBE_H,
    );
  }
}

/** 레벨이 바뀌었으면 굽고, 아니면 캐시를 쓴다. 실패(document 없음)하면 undefined. */
function worldBake(s: SimState): WorldBake | undefined {
  const key = levelKey(s);
  if (bake !== undefined && bake.key === key) return bake;
  if (typeof document === "undefined") return undefined;

  const w = s.width * TILE;
  const h = s.height * TILE;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  if (g === null) return undefined;
  g.imageSmoothingEnabled = false;

  const lamps = placeLamps(s);

  // 순서가 곧 조명 모델이다: 바닥을 칠하고 → 벽 그림자를 얹고 → **바닥에만** 감쇠를
  // 전부 먹이고 → 그 위에 벽을 세우고 → 벽에는 감쇠를 절반만 먹인다(WALL_LIGHT_MIX).
  g.save();
  clipTiles(g, s, "open");
  bakeFloor(g, s);
  bakeWallContact(g, s);
  g.restore();

  const mask = bakeLightMask(s, lamps);
  if (mask !== undefined) {
    g.save();
    clipTiles(g, s, "open");
    g.drawImage(mask, 0, 0);
    g.restore();
  }

  bakeWalls(g, s);

  // 벽 윗면까지 같은 알갱이를 얹어 바닥과 한 재질로 묶는다.
  const pat = grainPattern(g, 1);
  if (pat !== undefined) {
    g.save();
    clipTiles(g, s, "solid");
    g.globalAlpha = A_GRAIN_FLOOR;
    g.fillStyle = pat;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  if (mask !== undefined) {
    g.save();
    clipTiles(g, s, "solid");
    g.globalAlpha = WALL_LIGHT_MIX;
    g.drawImage(mask, 0, 0);
    g.restore();
  }

  bakeLamps(g, lamps);

  bake = { key, cv, lamps };
  return bake;
}

/**
 * 바닥 + 벽 + 조명. 엔티티보다 아래 레이어다 — 위에 덮으면 좁은 복도에서 잔상 머리 위
 * 슬롯 라벨이 가려져 §7 가독성 규칙이 깨진다. 시야콘은 레이캐스트로 이미 잘려 있다.
 *
 * 감쇠가 여기 **구워져 있다**는 게 핵심이다: 세계는 어두워지지만 그 위에 그려지는 인물은
 * 감쇠를 먹지 않는다. 어두운 방에 들어갈수록 조작 몸(I)의 대비가 오히려 커진다.
 */
function drawBakedWorld(ctx: CanvasRenderingContext2D, s: SimState): void {
  const b = worldBake(s);
  if (b === undefined) return;
  ctx.drawImage(b.cv, 0, 0);
}

/** 지금 레벨의 조명 배치. 베이킹 전이면 빈 배열이라 광량은 전부 ambient 가 된다. */
function lampsOf(s: SimState): Lamp[] {
  return bake !== undefined && bake.key === levelKey(s) ? bake.lamps : [];
}

/**
 * 물리 오브젝트(상자·셔터·하우징)에 걸리는 밝기 배율.
 *
 * 발광체(잔상·장치 ON·위험 신호)에는 쓰지 않는다 — 스스로 빛나는 것은 주변 광량과
 * 무관해야 한다. 하한 0.45 는 "어두워도 형태는 읽힌다"의 최소선이다.
 */
function shadeAt(s: SimState, x: number, y: number): number {
  return 0.45 + 0.55 * lightAt(lampsOf(s), x, y);
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

    // 밝기는 이 문이 서 있는 자리의 광량을 따른다 — 강철이라 스스로 빛나지 않는다.
    const k = shadeAt(s, x + w / 2, y + h / 2);

    // 셔터는 4프레임(1 완전 열림 → 4 완전 닫힘)이다. 보간값 `a` 를 그대로
    // 프레임에 눕히므로 **그림이 열린 정도와 항상 일치**한다 — 판정은 채널이
    // 하고, 여기는 그 상태를 읽어 그리기만 한다.
    if (sprites.has("gate")) {
      const cell = sprites.cellOf("gate");
      const step = cell === undefined ? TILE : cell.w;
      const col = Math.max(0, Math.min(3, Math.round((1 - a) * 3)));
      for (let ty = 0; ty < h; ty += step) {
        for (let tx = 0; tx < w; tx += step) {
          sprites.draw(ctx, "gate", col, 0, x + tx, y + ty);
        }
      }
      // 열린 문에는 지나갈 수 있다는 초록 바닥 신호만 얹는다.
      if (a > 0.999) {
        ctx.fillStyle = withAlpha(C_ON, 0.12);
        ctx.fillRect(x, y, w, h);
      }
      continue;
    }

    // 문틀(문턱)은 항상 보인다 — 닫힌 문이 사라지면 길인지 벽인지 헷갈린다.
    // 콘크리트에 박힌 강철 레일이므로 어두운 홈 + 빛 받는 립 한 줄로 그린다.
    ctx.fillStyle = withAlpha(C_METAL_DARK, 0.85);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const closed = 1 - a;
    if (closed <= 0.001) {
      // 열린 문 = 지나갈 수 있다. 초록은 기능 신호이므로 광량과 무관하게 유지한다.
      ctx.fillStyle = withAlpha(C_ON, 0.12);
      ctx.fillRect(x, y, w, h);
      continue;
    }

    // 긴 축을 따라 양쪽에서 닫히는 셔터.
    const horizontal = w >= h;
    const panels: Rect[] = [];
    if (horizontal) {
      const half = (w * closed) / 2;
      panels.push({ x, y, w: half, h }, { x: x + w - half, y, w: half, h });
    } else {
      const half = (h * closed) / 2;
      panels.push({ x, y, w, h: half }, { x, y: y + h - half, w, h: half });
    }

    for (const p of panels) {
      if (p.w < 0.6 || p.h < 0.6) continue;
      ctx.fillStyle = mulHex(C_METAL, k);
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // 셔터판 두께: 위 모서리는 빛을 받고 아래 모서리는 그늘진다.
      ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.7);
      ctx.fillRect(p.x, p.y, p.w, 1);
      ctx.fillStyle = withAlpha(C_METAL_DARK, 0.9);
      ctx.fillRect(p.x, p.y + p.h - 2, p.w, 2);
    }

    // 낡은 위험 도색. 형광이 아니라 **바래고 더러운** 노랑이라 네온과 경쟁하지 않는다.
    ctx.save();
    ctx.beginPath();
    for (const p of panels) ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.strokeStyle = withAlpha(mulHex(C_HAZARD, k), 0.75);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -h; i < w + h; i += 11) {
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
    }
    ctx.stroke();
    ctx.restore();

    // 셔터가 바닥에 드리우는 접지 그림자 — 문이 두께를 가진 강철판이라는 증거.
    for (const p of panels) {
      if (p.w < 3 || p.h < 3) continue;
      const gd = ctx.createLinearGradient(0, p.y + p.h, 0, p.y + p.h + 8);
      gd.addColorStop(0, withAlpha(C_BG, 0.45));
      gd.addColorStop(1, withAlpha(C_BG, 0));
      ctx.fillStyle = gd;
      ctx.fillRect(p.x, p.y + p.h, p.w, 8);
    }
  }
}

/**
 * 장치. **하우징은 강철이고 램프만 빛난다.**
 *
 * 예전엔 몸체 전체가 채널 색으로 발광해서 바닥에 붙은 홀로그램처럼 읽혔다. 이제 판·
 * 하우징·레버 몸통은 광량을 먹는 금속(`shadeAt`)이고, ON 초록·OFF 회색은 그 위에 박힌
 * **램프**다 — 세 위험 색 중 "장치 ON = 형광 초록"의 역할 구분은 그대로 유지된다.
 */
function drawDevices(ctx: CanvasRenderingContext2D, s: SimState): void {
  // 발판 — 콘크리트에 박힌 강철판. 눌리면 테두리 램프가 들어온다.
  for (const p of s.plates) {
    const x = P(p.x);
    const y = P(p.y);
    const w = P(p.w);
    const h = P(p.h);
    const k = shadeAt(s, x + w / 2, y + h / 2);
    const col = p.on ? C_ON : C_OFF;

    // 판 몸통은 에셋. 다만 **밟는 것이라는 표시는 코드가 계속 그린다** —
    // B7 시트에는 그 표시가 없어서, 에셋만 쓰면 처음 온 사람이 이 판을 다시
    // 방 이름표로 읽는다(심사에서 세 명이 실제로 그렇게 읽었다).
    const plateSprite = sprites.has("plate");
    if (plateSprite) {
      const cell = sprites.cellOf("plate");
      const step = cell === undefined ? TILE : cell.w;
      for (let ty = 0; ty < h; ty += step) {
        for (let tx = 0; tx < w; tx += step) {
          sprites.draw(ctx, "plate", p.on ? 1 : 0, 0, x + tx, y + ty);
        }
      }
    } else {
      // 바닥에 파인 자리 — 판 둘레의 어두운 홈. 판이 바닥 위에 뜬 게 아니라 박혀 있다.
      ctx.fillStyle = withAlpha(C_BG, 0.4);
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = mulHex(C_METAL, k * (p.on ? 0.85 : 1));
      ctx.fillRect(x, y, w, h);
      // 베벨: 위·왼쪽은 빛을 받고 아래·오른쪽은 그늘진다. 눌린 판은 이게 반대로 뒤집힌다.
      ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), p.on ? 0.25 : 0.65);
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = withAlpha(C_METAL_DARK, p.on ? 0.95 : 0.7);
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x + w - 1, y, 1, h);
    }

    // 미끄럼 방지 홈 — **밟기 전에도 "밟는 것"으로 보여야 한다.**
    //
    // 이게 없을 때 처음 온 사람은 판 가운데 찍힌 채널 스텐실만 보고 이 판을
    // **방 이름표**로 읽었다. 실제로 게이트(`SEALED`)도 테두리 + 가운데 대문자
    // 라벨이라, 둘이 같은 종류의 표지판으로 보인 것이다. 밟을 생각을 아예 못
    // 하니 게임의 첫 아하까지 도달하지 못한다.
    //
    // 그래서 질감으로 갈랐다 — **게이트는 비스듬한 위험 도색, 발판은 수평 홈**.
    // 발로 딛는 철판의 미끄럼 방지 홈은 현실에서도 "여기를 밟는다"는 뜻이다.
    // 램프가 아니라 깎인 홈이라 "하우징은 강철, 램프만 빛난다" 규칙도 지킨다.
    {
      const step = 5;
      const inset = 4;
      // 채널 각인이 앉을 자리는 홈을 비운다 — 글자 위로 홈이 지나가면 둘 다 못 읽는다.
      const bandTop = y + h / 2 - 6;
      const bandBot = y + h / 2 + 4.5;
      for (let gy = y + inset + 2; gy < y + h - inset; gy += step) {
        if (gy > bandTop && gy < bandBot) continue;
        ctx.fillStyle = withAlpha(C_METAL_DARK, 0.55);
        ctx.fillRect(x + inset, gy, w - inset * 2, 1);
        ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), p.on ? 0.3 : 0.55);
        ctx.fillRect(x + inset, gy + 1, w - inset * 2, 1);
      }
    }

    // 딛는 자리 표시 — 판 위쪽 가운데를 향해 꺾인 갈매기. 바닥 도색이라
    // 꺼져 있을 때 더 진하고, 켜지면 초록 램프에 자리를 넘긴다.
    {
      const cx = x + w / 2;
      const top = y + 4.5;
      const arm = Math.min(6, w * 0.22);
      // 안전 도색은 **어두운 구석에서도 읽혀야** 한다. 방 조도(k)를 그대로 곱하면
      // 등에서 먼 발판이 배경에 묻히는데, 스테이지 1 의 발판이 정확히 그 자리다.
      // 그래서 감쇠에 바닥을 깔아 준다 — 현실의 축광 도색과 같은 이유다.
      ctx.strokeStyle = withAlpha(
        mulHex(C_FLOOR_MARK, Math.max(k, 0.78)),
        p.on ? 0.35 : 0.95,
      );
      ctx.lineWidth = 2;
      ctx.lineJoin = "miter";
      ctx.beginPath();
      ctx.moveTo(cx - arm, top);
      ctx.lineTo(cx, top + arm * 0.75);
      ctx.lineTo(cx + arm, top);
      ctx.stroke();
    }

    // 상태 램프 — 테두리 안쪽 한 줄. ON 이면 초록이 확실히 살아난다.
    // OFF 는 채널 색(C_OFF, 남색)이 아니라 **깎인 금속 홈**이다 — 남색 선은 콘크리트
    // 위에서 유일하게 남은 "사이버" 잔재이고, 어두운 방에서는 아예 안 보인다.
    if (!plateSprite) {
      ctx.strokeStyle = p.on
        ? withAlpha(col, 0.95)
        : withAlpha(C_METAL_LIP, 0.45);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      if (p.on) {
        ctx.strokeStyle = withAlpha(col, 0.22);
        ctx.lineWidth = 6;
        ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      }
    }
    // 채널 라벨 — 어느 발판이 어느 문을 여는지는 여전히 읽혀야 하지만, **표지판의
    // 제목처럼 굵게 가운데 박히면 판 전체가 이름표로 읽힌다**. 그래서 아래쪽으로
    // 내려 각인처럼 눕힌다. 홈과 갈매기가 먼저 보이고, 채널은 그 다음에 읽힌다.
    ctx.fillStyle = p.on ? withAlpha(col, 0.9) : withAlpha(C_METAL_LIP, 0.72);
    ctx.font = font(7);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.channel.toUpperCase(), x + w / 2, y + h / 2);
  }

  // 버튼 (시간차 — 남은 holdTicks 를 링으로 보여준다)
  for (const b of s.buttons) {
    const cx = tileCenterPx(b.x);
    const cy = tileCenterPx(b.y);
    const k = shadeAt(s, cx, cy);
    const col = b.on ? C_ON : C_OFF;

    contactShadow(ctx, cx, cy, 18, 0.8);
    // 눌린 직후 몇 틱은 PRESSED 프레임. 그다음은 ON/OFF 정지 프레임이다.
    const pressed = b.on && b.holdTicks > 0 && b.timer > b.holdTicks - 8;
    if (
      !sprites.drawCentered(
        ctx,
        "wallButton",
        pressed ? 2 : b.on ? 1 : 0,
        0,
        cx,
        cy,
      )
    ) {
      // 하우징: 벽에 붙은 금속 함. 위쪽 립이 빛을 받는다.
      ctx.fillStyle = mulHex(C_METAL, k);
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, Math.PI, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(C_METAL_DARK, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, 10.5, 0, Math.PI);
      ctx.stroke();

      // 램프. 여기만 빛난다.
      ctx.fillStyle = withAlpha(col, b.on ? 0.95 : 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, TAU);
      ctx.fill();
      if (b.on) {
        ctx.fillStyle = withAlpha(col, 0.2);
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, TAU);
        ctx.fill();
      }
    }

    if (b.on && b.holdTicks > 0) {
      const frac = Math.max(0, Math.min(1, b.timer / b.holdTicks));
      ctx.strokeStyle = C_ON;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    // 라벨은 강철에 찍은 스텐실 — OFF 일 때 남색(C_OFF)으로 두면 어두운 방에서 사라진다.
    ctx.fillStyle = b.on ? withAlpha(col, 0.9) : withAlpha(C_METAL_LIP, 0.85);
    ctx.font = font(8, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.channel.toUpperCase(), cx, cy - 20);
  }

  // 레버 — 금속 베이스에 꽂힌 손잡이. 노브만 채널 색이다.
  for (const l of s.levers) {
    const cx = tileCenterPx(l.x);
    const cy = tileCenterPx(l.y);
    const k = shadeAt(s, cx, cy);
    const col = l.on ? C_ON : C_OFF;

    contactShadow(ctx, cx, cy + 4, 20, 0.8);
    // 프레임 1 = 손잡이 왼쪽(OFF), 프레임 2 = 오른쪽(ON). 실제 스위치 상태와 같다.
    if (!sprites.drawCentered(ctx, "lever", l.on ? 1 : 0, 0, cx, cy)) {
      ctx.fillStyle = mulHex(C_METAL, k);
      ctx.fillRect(cx - 9, cy + 3, 18, 6);
      ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.7);
      ctx.fillRect(cx - 9, cy + 3, 18, 1);
      ctx.fillStyle = withAlpha(C_METAL_DARK, 0.95);
      ctx.fillRect(cx - 9, cy + 8, 18, 1);

      // 손잡이 축은 금속, 끝의 노브만 램프.
      ctx.strokeStyle = mulHex(C_METAL_LIP, k);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy + 5);
      ctx.lineTo(cx + (l.on ? 7 : -7), cy - 9);
      ctx.stroke();
      ctx.fillStyle = withAlpha(col, l.on ? 1 : 0.7);
      ctx.beginPath();
      ctx.arc(cx + (l.on ? 7 : -7), cy - 9, 3.5, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = l.on ? withAlpha(col, 0.9) : withAlpha(C_METAL_LIP, 0.85);
    ctx.font = font(8, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(l.channel.toUpperCase(), cx, cy - 20);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// A그룹 — 지금까지 화면에 **아무것도 없던** 장치들
//
// grate·laser·powerBus·flash 는 레벨 데이터에는 있는데 그리는 코드가 없었다.
// 2막의 "빠른 길은 시끄럽다", 3막의 "통과할 시각을 고른다", 4막의 "하나를 켜면
// 하나가 꺼진다"가 전부 화면에 안 나와 있었다는 뜻이다. 스프라이트가 아직
// 안 왔으면 각 함수는 **코드로 그린 대체 표현**을 남긴다 — 빈 바닥보다 낫다.
// ══════════════════════════════════════════════════════════════════════════

/**
 * 소음 바닥. 밟고 **움직이는** 동안만 파문이 뜬다.
 *
 * 바닥에 깔린 것이므로 구운 바닥 바로 위, 다른 장치보다 아래에 그린다.
 */
function drawGrates(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const g of s.grates) {
    const x = P(g.x);
    const y = P(g.y);
    const w = P(g.w);
    const h = P(g.h);
    const left = view.grateFx.get(g.id) ?? 0;
    // 남은 프레임 → 2~5번 프레임. 대기(0번)는 파문이 없는 격자 그 자체다.
    const col =
      left <= 0 ? 0 : 1 + Math.min(3, Math.floor((GRATE_FX_FRAMES - left) / 4));

    if (sprites.has("grate")) {
      const cell = sprites.cellOf("grate");
      const step = cell === undefined ? TILE : cell.w;
      for (let ty = 0; ty < h; ty += step) {
        for (let tx = 0; tx < w; tx += step) {
          sprites.draw(ctx, "grate", col, 0, x + tx, y + ty);
        }
      }
      continue;
    }

    // 폴백 — 강철 격자를 코드로. 소음이 나면 테두리가 밝아진다.
    const k = shadeAt(s, x + w / 2, y + h / 2);
    ctx.fillStyle = withAlpha(C_METAL_DARK, 0.55);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.45);
    for (let gy = y + 3; gy < y + h; gy += 6) ctx.fillRect(x + 2, gy, w - 4, 1);
    ctx.strokeStyle = withAlpha(mulHex(C_METAL_LIP, k), left > 0 ? 0.9 : 0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
}

/**
 * 주기 레이저. 발사기는 양 끝에, 빔은 그 사이를 **타일링**해서 잇는다.
 *
 * 빔을 한 장 늘려 쓰면 픽셀이 뭉개지므로 필요한 길이만큼 반복해 붙인다.
 * 지금 레벨의 레이저는 전부 수직이라 90° 회전해 그린다 — 정확히 직각이고
 * 평행이동이 정수라 회전해도 픽셀이 흐려지지 않는다.
 *
 * **꺼져 있으면 빔을 한 픽셀도 그리지 않는다.** 발사기만 OFF 프레임으로 남는다.
 */
function drawLasers(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const l of s.lasers) {
    const x0 = P(l.x0);
    const y0 = P(l.y0);
    const x1 = P(l.x1);
    const y1 = P(l.y1);
    const vertical = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
    const len = vertical ? Math.abs(y1 - y0) : Math.abs(x1 - x0);

    if (l.on) {
      const beam = sprites.cellOf("laserBeam");
      if (beam !== undefined) {
        // 4프레임을 6프레임씩 — 너무 빠르면 깜빡임으로 읽힌다.
        const f = Math.floor(view.frame / 6) % 4;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(
          Math.round(Math.min(x0, x1)),
          Math.round(Math.min(y0, y1)),
        );
        if (vertical) ctx.rotate(Math.PI / 2);
        // 회전 후 좌표계에서 x 가 진행 방향이다. 빔 두께의 절반만큼 올려 중심을 맞춘다.
        for (let d = 0; d < len; d += beam.w) {
          sprites.draw(ctx, "laserBeam", f, 0, d, -beam.h / 2);
        }
        ctx.restore();
      } else {
        // 폴백 — 저채도 흰빛 선. 판정과 같은 선분이다.
        ctx.strokeStyle = withAlpha(C_CCTV_SCAN, 0.85);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    // 발사기는 켜지든 꺼지든 양 끝에 남는다 — 여기가 위험한 자리라는 표시다.
    const emitCol = l.on ? 1 : 0;
    if (!sprites.drawCentered(ctx, "laserEmitter", emitCol, 0, x0, y0)) {
      ctx.fillStyle = withAlpha(l.on ? C_CCTV_SCAN : C_METAL_LIP, 0.8);
      ctx.fillRect(x0 - 5, y0 - 5, 10, 10);
    }
    if (!sprites.drawCentered(ctx, "laserEmitter", emitCol, 0, x1, y1)) {
      ctx.fillStyle = withAlpha(l.on ? C_CCTV_SCAN : C_METAL_LIP, 0.8);
      ctx.fillRect(x1 - 5, y1 - 5, 10, 10);
    }
  }
}

/** 바닥에 놓인 눈뽕. 주운 것은 그리지 않는다. */
function drawFlashPickups(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const f of s.flashes) {
    if (f.taken) continue;
    const cx = P(f.x) + TILE / 2;
    const cy = P(f.y) + TILE / 2;
    // 바닥에 놓인 물건이라는 증거. 스프라이트가 공중에 뜨지 않게 먼저 깐다.
    contactShadow(ctx, cx, cy + 5, 14, 0.7);
    // 12프레임에 한 칸 — 천천히 도는 금속 반사다. 스스로 빛나지 않는다.
    const col = Math.floor(view.frame / 12) % 4;
    if (sprites.drawCentered(ctx, "flashbang", col, 0, cx, cy)) continue;

    const k = shadeAt(s, cx, cy);
    ctx.fillStyle = mulHex(C_METAL_LIP, k);
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = withAlpha(C_METAL_DARK, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * 터진 눈뽕. **한 번만** 재생하고 사라진다.
 *
 * 화면 전체를 덮는 흰 플래시는 이미 `view.flash` 가 하고 있으므로 여기서는
 * 스프라이트만 얹는다. 둘을 겹쳐 세게 때리면 광과민성 위험이 커진다.
 */
function drawBooms(ctx: CanvasRenderingContext2D, view: ViewState): void {
  for (const b of view.booms) {
    const col = Math.min(7, Math.floor((BOOM_FX_FRAMES - b.f) / 3));
    sprites.drawCentered(ctx, "flashbangBoom", col, 0, b.x, b.y);
  }
}

/**
 * 전력 패널. `PowerBus` 에는 좌표가 없으므로(채널 묶음일 뿐이다) **그 채널을
 * 쥐고 있는 장치 위**에 붙인다 — 플레이어가 "지금 어느 쪽에 전기가 갔나"를
 * 물어보는 자리가 바로 거기다.
 */
function drawPowerPanels(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  if (s.powerBuses.length === 0) return;
  for (const bus of s.powerBuses) {
    const left = view.busFx.get(bus.bus) ?? 0;
    for (let i = 0; i < bus.channels.length; i++) {
      const ch = bus.channels[i]!;
      const live = i === bus.activeIndex;
      // 전환 중이면 3~6번, 아니면 1(ON)·2(OFF) 정지 프레임.
      const col =
        left > 0
          ? 2 + Math.min(3, Math.floor((BUS_FX_FRAMES - left) / 4))
          : live
            ? 0
            : 1;
      for (const pos of channelSources(s, ch)) {
        const cx = pos.x;
        const cy = pos.y - 26;
        if (sprites.drawCentered(ctx, "powerBus", col, 0, cx, cy)) continue;
        ctx.fillStyle = withAlpha(live ? C_ON : C_OFF, 0.85);
        ctx.fillRect(cx - 7, cy - 4, 14, 8);
        ctx.strokeStyle = withAlpha(C_METAL_LIP, 0.8);
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 7.5, cy - 4.5, 15, 9);
      }
    }
  }
}

/** 이 채널을 **켜는** 장치들의 화면 좌표. 레버·버튼·발판이 소스다. */
function channelSources(
  s: SimState,
  channel: string,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const l of s.levers) {
    if (l.channel === channel)
      out.push({ x: tileCenterPx(l.x), y: tileCenterPx(l.y) });
  }
  for (const b of s.buttons) {
    if (b.channel === channel)
      out.push({ x: tileCenterPx(b.x), y: tileCenterPx(b.y) });
  }
  for (const p of s.plates) {
    if (p.channel === channel)
      out.push({ x: P(p.x) + P(p.w) / 2, y: P(p.y) + P(p.h) / 2 });
  }
  return out;
}

/**
 * 상자. 위에서 보면 **뚜껑(윗면)** 이 보이고, 카메라 쪽 측면이 두께로 드러나며,
 * 바닥에 접지 그림자가 깔린다 — 벽과 같은 작도법이라 같은 세계의 물건으로 읽힌다.
 */
function drawCrates(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const c of s.crates) {
    const x = P(c.x);
    const y = P(c.y);
    const k = shadeAt(s, x + CRATE_SIZE / 2, y + CRATE_SIZE / 2);
    const S = CRATE_SIZE;

    // 상자는 바닥에 **딱 붙어** 있다 — 그림자를 몸집만큼 벌리면 상자가 구덩이 위에
    // 뜬 것처럼 보인다. 인물(SHADOW_W=20)보다 몸집이 큰 만큼만 넓힌다.
    contactShadow(ctx, x + S / 2, y + S - 5, S * 0.78, 0.9);

    // 밀리는 중에만 흔들림 프레임(2·3번)을 쓴다. 가만히 있는 상자는 0번이다.
    const prev = view.cratePrev.get(c.id);
    const moved = prev !== undefined && (prev.x !== c.x || prev.y !== c.y);
    view.cratePrev.set(c.id, { x: c.x, y: c.y });
    if (
      sprites.draw(
        ctx,
        "crate",
        moved ? 1 + (Math.floor(view.frame / 4) % 2) : 0,
        0,
        x,
        y,
      )
    ) {
      continue;
    }

    // 윗면(뚜껑).
    ctx.fillStyle = mulHex(C_METAL, k);
    ctx.fillRect(x, y, S, S);
    // 카메라 쪽 측면 — 상자 **안쪽**에만. 밖으로 내밀면 통행 가능한 칸을 잡아먹는다.
    ctx.fillStyle = mulHex(C_METAL_DARK, k);
    ctx.fillRect(x, y + S - 6, S, 6);
    ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.6);
    ctx.fillRect(x, y + S - 7, S, 1);
    // 먼 쪽 모서리 하이라이트 + 좌우 두께.
    ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.75);
    ctx.fillRect(x, y, S, 1);
    ctx.fillStyle = withAlpha(C_METAL_DARK, 0.55);
    ctx.fillRect(x + S - 2, y, 2, S);
    ctx.fillStyle = withAlpha(C_METAL_DARK, 0.3);
    ctx.fillRect(x, y, 1, S);

    // 뚜껑 판자 이음 — 발광하지 않는 얇은 홈 두 줄. X 자 네온은 없앴다.
    ctx.fillStyle = withAlpha(C_SEAM, 0.55);
    ctx.fillRect(x + 2, y + 10, S - 4, 1);
    ctx.fillRect(x + 2, y + 19, S - 4, 1);
    // 강철 밴드 하나 — 상자가 묶여 있다.
    ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.35);
    ctx.fillRect(x + 13, y + 1, 3, S - 8);
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
      d = Math.max(
        0,
        d - (Math.sin(i * 2.7 + frame * 0.33) * 0.5 + 0.5) * noise,
      );
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
    case "CHASE":
      // 추격 중에는 세게 맥동시킨다 — 화면 어디를 보고 있어도 주변시로 잡힌다.
      return A_CONE_CHASE + 0.07 + Math.sin(frame * 0.32) * 0.11;
    case "SUSPICIOUS":
    case "INVESTIGATE":
      return A_CONE_SUSPICIOUS + Math.sin(frame * 0.16) * 0.03;
    default:
      return A_CONE_PATROL;
  }
}

/** 상태별 시야콘 가장자리 노이즈 진폭. 쫓을수록 가장자리가 거칠어진다. */
function coneNoise(g: Guard): number {
  switch (g.state) {
    case "CHASE":
      return CONE_NOISE[2];
    case "SUSPICIOUS":
    case "INVESTIGATE":
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
        // (그리고 경비 CHASE 콘보다 살짝 아래)가 되도록 알파를 되맞춘 것이다.
        locking
          ? A_CONE_CCTV + 0.05 + Math.sin(view.frame * 0.4) * 0.02
          : A_CONE_CCTV,
      );
    }
    // 카메라 본체. 시트는 8프레임 렌즈 스윕 + 9번째 **비활성** 프레임이다.
    // 렌즈 위치는 시뮬의 facing 을 그대로 따라간다 — 그림이 보는 쪽과 실제
    // 감시 방향이 어긋나면 플레이어가 안전한 자리를 잘못 고른다.
    const col = c.enabled ? C_CCTV : C_OFF;
    const eyeCol = c.enabled
      ? ((Math.round((c.facing / DIR_STEPS) * 8) % 8) + 8) % 8
      : 8;
    if (!sprites.drawCentered(ctx, "eye", eyeCol, 0, cx, cy)) {
      // 카메라 본체 — 하우징은 강철이고 **렌즈만** 빛난다. 꺼지면 회색으로 죽는다(레버 효과의 시각 증거).
      const k = shadeAt(s, cx, cy);
      contactShadow(ctx, cx, cy, 20, 0.85);
      ctx.fillStyle = mulHex(C_METAL, k);
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 9.5, Math.PI, TAU);
      ctx.stroke();
      ctx.fillStyle = withAlpha(col, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha(col, c.enabled ? 0.55 : 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, TAU);
      ctx.stroke();
      if (!c.enabled) {
        // 죽은 눈 위의 X. 남색(C_OFF)으로 그으면 금속 하우징 위에서 안 보인다.
        ctx.strokeStyle = withAlpha(C_METAL_LIP, 0.9);
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 8);
        ctx.lineTo(cx + 8, cy + 8);
        ctx.stroke();
      }
      // EYE(감시안) — 꺼진 눈은 라벨까지 죽되, 강철 스텐실로 읽히는 선까지는 남긴다.
    }

    ctx.fillStyle = c.enabled
      ? withAlpha(col, 0.6)
      : withAlpha(C_METAL_LIP, 0.6);
    ctx.font = font(7, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EYE", cx, cy + 19);
  }
}

/**
 * 콘 한 개를 그릴 레이 수. SENTRY(반각 50°, 224px)에서 정확히 26 이 나오는 밀도다.
 * 각도만 보면 WATCHER 의 320px 짜리 긴 콘이 끝단에서 성기게 끊기므로 사거리로 한 번 더
 * 보정한다 — 시야 **경계**가 곧 회피 정보라, 거기가 톱니로 보이면 안 된다.
 */
function coneRays(halfAngle: number, rangePx: number): number {
  return Math.max(
    14,
    Math.round(((halfAngle * 2) / 0.0671) * Math.sqrt(rangePx / 224)),
  );
}

function drawGuardCones(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  view: ViewState,
): void {
  for (const g of s.guards) {
    // **시야콘 치수는 시뮬의 유형표에서 그대로 읽는다.** 여기에 연출용 배율을 곱하는
    // 순간 "저 벽 뒤는 안전하다"가 거짓말이 되므로, 유형별 콘 모양은 내가 정하는 것이
    // 아니라 `GUARD_KINDS` 가 정한다: HOUND 좁고(35°) 짧게(176), BRUTE 넓고(65°)
    // 짧게(192), WATCHER 아주 길게(320) 가늘게(40°), SENTRY 기준(50°/224).
    const spec = GUARD_KINDS[g.kind];
    const half = halfAngleOf(spec.fovTan);
    const range = P(spec.viewRange);
    const rays = coneRays(half, range);
    const cx = P(g.x) + guardSizePx(g) / 2;
    const cy = P(g.y) + guardSizePx(g) / 2;
    const ang = angleOf(g.facing);
    const alarmFx = view.guardAlarmFx.get(g.id) ?? 0;

    const pts = conePolygon(
      s,
      cx,
      cy,
      ang,
      half,
      range,
      rays,
      coneNoise(g),
      view.frame,
    );
    // 경보 중에는 콘 전체가 세게 점멸한다 — 채우기만 밝아질 뿐 **넓어지지는 않는다.**
    const flick =
      alarmFx > 0
        ? 0.2 *
          (alarmFx / ALARM_FX_TICKS) *
          (0.55 + Math.sin(view.frame * 0.9) * 0.45)
        : 0;
    fillCone(ctx, cx, cy, pts, C_GUARD, coneAlpha(g, view.frame) + flick);

    // 경보 섬광: 콘 **안쪽**에서 바깥으로 훑고 지나가는 밝은 띠.
    // 콘이 순간적으로 커지는 것처럼 읽히지만 실제 시야 밖으로는 한 픽셀도 나가지 않는다
    // (`conePolygon` 의 "그려진 콘은 실제 시야보다 절대 크지 않다" 규칙을 지킨다).
    if (alarmFx > 0) {
      const t = 1 - alarmFx / ALARM_FX_TICKS;
      const sweep = conePolygon(
        s,
        cx,
        cy,
        ang,
        half,
        range * (0.12 + t * 0.88),
        rays,
        0,
        view.frame,
      );
      fillCone(ctx, cx, cy, sweep, C_GUARD, 0.3 * (1 - t));
    }

    // 추격 중에는 콘 안쪽에 한 겹을 더 태운다 — 붉은 덩어리가 나를 향해 밀려온다.
    if (g.state === "CHASE") {
      const near = conePolygon(
        s,
        cx,
        cy,
        ang,
        half * 0.6,
        range * 0.55,
        Math.max(10, Math.round(rays * 0.55)),
        CONE_NOISE[2],
        view.frame,
      );
      fillCone(
        ctx,
        cx,
        cy,
        near,
        C_GUARD,
        0.1 + Math.sin(view.frame * 0.32) * 0.05,
      );
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
  // 봉인 상태의 테두리·글자는 셔터 몸통색(어두운 강철)이 아니라 **강철 립 색**이다.
  // 몸통색으로 쓰면 자기가 칠한 어두운 판 위에 얹혀 `SEALED` 가 안 읽힌다.
  const col = unlocked ? C_ESCAPE_OPEN : C_METAL_LIP;

  // 봉인 상태의 출구는 **강철 셔터**다. 빛나는 사각형이 아니라 벽에 박힌 금속판이라야
  // "여긴 아직 못 나간다"가 세계의 물건으로 읽힌다. 열리면 초록 신호가 그 위에 켜진다.
  // 출구 시트는 4프레임이다 — 1·2 봉인(먼지 반짝임), 3·4 개방(초록 점선 흐름).
  // 2타일짜리 출구(1·5·7·12번)에서는 같은 셀을 가로로 이어 붙인다.
  const exitSprite = sprites.has("exit");
  if (exitSprite) {
    const cell = sprites.cellOf("exit");
    const step = cell === undefined ? TILE : cell.w;
    const col = (unlocked ? 2 : 0) + (Math.floor(view.frame / 18) % 2);
    for (let ty = 0; ty < eh; ty += step) {
      for (let tx = 0; tx < ew; tx += step) {
        sprites.draw(ctx, "exit", col, 0, ex + tx, ey + ty);
      }
    }
  } else if (!unlocked) {
    const k = shadeAt(s, ex + ew / 2, ey + eh / 2);
    ctx.fillStyle = mulHex(C_ESCAPE_LOCKED, k * 0.8);
    ctx.fillRect(ex, ey, ew, eh);
    ctx.fillStyle = withAlpha(mulHex(C_METAL_LIP, k), 0.55);
    ctx.fillRect(ex, ey, ew, 1);
    ctx.fillStyle = withAlpha(C_METAL_DARK, 0.9);
    ctx.fillRect(ex, ey + eh - 2, ew, 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ex, ey, ew, eh);
    ctx.clip();
    ctx.strokeStyle = withAlpha(mulHex(C_HAZARD, k), 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -eh; i < ew + eh; i += 13) {
      ctx.moveTo(ex + i, ey + eh);
      ctx.lineTo(ex + i + eh, ey);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = withAlpha(col, unlocked ? 0.16 : 0);
  ctx.fillRect(ex, ey, ew, eh);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(col, unlocked ? 1 : 0.6);
  ctx.lineDashOffset = unlocked ? -view.frame * 0.4 : 0;
  ctx.strokeRect(ex + 1, ey + 1, ew - 2, eh - 2);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.fillStyle = withAlpha(col, unlocked ? 1 : 0.65);
  ctx.font = font(9, "bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // 코어를 되찾기 전까지 바깥 문은 SEALED 다 — 잠긴 게 아니라 봉인된 것이다.
  ctx.fillText(unlocked ? "EXIT" : "SEALED", ex + ew / 2, ey + eh / 2);

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

  // **CORE 는 발광 오브젝트가 아니라 조명받는 금속이다.** 그래서 셋이 필요하다:
  // 바닥에 앉히는 접지 그림자, 광량에 따라 변하는 몸통 밝기, 그리고 하이라이트/그늘.
  // 하한 0.62 는 어두운 방에서도 목표물이 사라지지 않는 최소선이다.
  const k = Math.max(0.62, shadeAt(s, lx, ly));
  if (carrier === undefined) {
    // 떠 있는 만큼(bob) 그림자는 넓고 옅어진다 — 이 연동이 "떠 있음"을 진짜로 만든다.
    const lift = (bob + 2) / 4;
    contactShadow(ctx, lx, ly + 8, 20 + lift * 6, 1 - lift * 0.35);
  }

  // 회전은 **에셋이 이미 8프레임으로 갖고 있다.** 시뮬의 회전 상태와 무관하게
  // 6프레임마다 한 칸씩 부드럽게 돌린다(README C그룹 규격: "one full smooth
  // rotation, constant size, no trail"). 잔광 한 겹은 코드가 계속 얹는다 —
  // 억제 장치라 완전히 죽은 금속은 아니라는 표시다.
  if (sprites.has("core")) {
    ctx.save();
    ctx.translate(lx, ly + bob);
    const gr = 18;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    glow.addColorStop(0, withAlpha(C_LOOT, 0.14 + pulse * 0.06));
    glow.addColorStop(1, withAlpha(C_LOOT, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-gr, -gr, gr * 2, gr * 2);
    ctx.restore();
    sprites.drawCentered(
      ctx,
      "core",
      Math.floor(view.frame / 6) % 8,
      0,
      lx,
      ly + bob,
    );
  } else {
    ctx.save();
    ctx.translate(lx, ly + bob);
    // 억제 장치라 완전히 죽은 금속은 아니다 — 아주 옅은 잔광 한 겹만 남긴다(예전 0.42 → 0.14).
    const gr = 18;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
    glow.addColorStop(0, withAlpha(C_LOOT, 0.14 + pulse * 0.06));
    glow.addColorStop(1, withAlpha(C_LOOT, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-gr, -gr, gr * 2, gr * 2);

    // 바깥 껍질: 반대로 도는 마름모 링. 어두운 금속 테라서 하이라이트만 반짝인다.
    ctx.save();
    ctx.rotate(-spin * 0.6);
    const outer = 13;
    ctx.strokeStyle = withAlpha(mulHex(C_LOOT_DARK, k), 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -outer);
    ctx.lineTo(outer, 0);
    ctx.lineTo(0, outer);
    ctx.lineTo(-outer, 0);
    ctx.closePath();
    ctx.stroke();
    // 위쪽 두 변만 빛을 받는다 — 링이 입체로 읽히는 이유가 이 반쪽이다.
    ctx.strokeStyle = withAlpha(mulHex(C_LOOT_LIT, k), 0.5 + pulse * 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-outer, 0);
    ctx.lineTo(0, -outer);
    ctx.lineTo(outer, 0);
    ctx.stroke();
    ctx.restore();

    ctx.rotate(spin);
    // 몸통: 왼쪽 위(빛)에서 오른쪽 아래(그늘)로 흐르는 금속 그라디언트.
    const body = ctx.createLinearGradient(-6, -8, 6, 8);
    body.addColorStop(0, mulHex(C_LOOT_LIT, k));
    body.addColorStop(0.45, mulHex(C_LOOT, k));
    body.addColorStop(1, mulHex(C_LOOT_DARK, k));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(7, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fill();
    // 그늘진 아래쪽 두 변 = 오클루전 에지. 이게 없으면 다시 납작한 네온 마름모가 된다.
    ctx.strokeStyle = withAlpha(C_BG, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-7, 0);
    ctx.stroke();
    // 스페큘러 — 위쪽 모서리에 걸린 짧은 하이라이트 한 획.
    ctx.strokeStyle = withAlpha(mulHex(C_LOOT_LIT, k), 0.9);
    ctx.beginPath();
    ctx.moveTo(-4.5, -3.5);
    ctx.lineTo(-0.5, -7.5);
    ctx.stroke();
    ctx.restore();
  }

  if (carrier === undefined) {
    ctx.fillStyle = withAlpha(C_LOOT_LIT, 0.55 + pulse * 0.25);
    ctx.font = font(7, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CORE", lx, ly + 20);
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
 * 접지 그림자(contact shadow). **물체를 바닥에 앉히는 핵심 장치다** — 붕 떠 보이는
 * 물체는 예외 없이 이게 없는 물체다. 그래서 몸·상자·CORE·장치 하우징까지 전부 이걸 깐다.
 *
 * 두 겹인 이유: 물체 **바로 아래**는 좁고 진하고(코어), 멀어지며 넓고 흐려진다(halo).
 * 한 겹만 쓰면 진하면 스티커, 흐리면 안개가 된다. 빛이 천장에서 오므로 전체가
 * `SHADOW_DROP` 만큼 아래로 밀린다. 인물이 출발·정지에 기울어도 그림자는 **그 자리에
 * 남는다** — 그 어긋남이 곧 관성으로 읽힌다.
 *
 * `angle`/`elong` 은 네발짐승처럼 **길쭉한 몸**을 위한 것이다: 사람은 어느 방향을 봐도
 * 바닥 면적이 거의 원이라 회전이 무의미하지만, 개는 몸이 진행 방향으로 길어서 그림자가
 * 같이 돌지 않으면 몸과 그림자의 모양이 어긋나 붕 뜬다. 생략하면 예전 그림 그대로다.
 */
function contactShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  strength: number,
  angle = 0,
  elong = 1,
): void {
  const oy = cy + w * SHADOW_DROP;
  const soft = w * SHADOW_SOFT_R;
  // 바닥면 → 화면의 세로 눌림. 코어 타원은 눌린 값(0.19)을 이미 들고 있으므로 같은
  // 비율을 되뽑아 쓴다 — 기본값(angle 0, elong 1)에서 예전 그림과 한 픽셀도 다르지 않다.
  const squash = SHADOW_CORE_RY / SHADOW_CORE_RX;

  ctx.save();
  ctx.translate(cx, oy);
  // 위에서 본 바닥은 세로로 눌려 보인다 — 그림자도 같이 눌러야 바닥에 누운 것처럼 보인다.
  ctx.scale(1, 0.5);
  // 회전은 **눌리기 전** 바닥면에서 일어난다(변환은 안쪽부터 적용된다). 그래야 길쭉한
  // 그림자가 어느 방향을 봐도 같은 모양으로 돌아간다.
  ctx.rotate(angle);
  ctx.scale(elong, 1);
  const gd = ctx.createRadialGradient(0, 0, w * 0.12, 0, 0, soft);
  gd.addColorStop(0, withAlpha(C_BG, A_SHADOW_SOFT * strength));
  gd.addColorStop(0.55, withAlpha(C_BG, A_SHADOW_SOFT * strength * 0.5));
  gd.addColorStop(1, withAlpha(C_BG, 0));
  ctx.fillStyle = gd;
  ctx.fillRect(-soft, -soft, soft * 2, soft * 2);
  ctx.restore();

  ctx.save();
  ctx.translate(cx, oy);
  ctx.scale(1, squash);
  ctx.rotate(angle);
  ctx.fillStyle = withAlpha(C_BG, A_SHADOW_CORE * strength);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * SHADOW_CORE_RX * elong, w * SHADOW_CORE_RX, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
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
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
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
  ctx.font = font(8, "bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
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
    contactShadow(ctx, cx, cy, SHADOW_W, Math.min(1, baseA + 0.35));
    // 시선 표시는 **바닥에** 찍는다. 몸 위로 그으면 실루엣을 가로지르는 막대가 된다.
    // 그림은 부드럽게 돌지만 이 화살촉은 **실제 facing** 이다 — 회피 판정이 여기 걸려 있다.
    facingPip(ctx, cx, cy, b.facing, withAlpha(col, baseA + 0.25), 16, 5);

    const gait = view.gaits.get(b.id);
    // 잔상은 같은 시트에 **코드로 색과 알파를 입혀** 쓴다. 4색을 따로 만들면
    // 톤이 어긋난다(DESIGN-PROMPTS B1 구현 메모).
    if (
      !drawBodySprite(ctx, "player", cx, cy, b.facing, gait, {
        color: col,
        alpha: Math.min(1, baseA + 0.12),
      })
    ) {
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
          style: "silhouette",
          shade: C_BG,
        },
      );
    }

    if (b.frozen) {
      frozenMark(ctx, cx, top, cy + FIG_R, col, Math.min(1, baseA + 0.4));
    }

    if (b.spotted) {
      ctx.strokeStyle = withAlpha(
        C_GUARD,
        0.5 + Math.sin(view.frame * 0.3) * 0.25,
      );
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, BODY_SIZE * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 머리 위 슬롯 라벨 (MY / ME / MINE). 배치는 몸을 다 그린 뒤 한꺼번에 — 겹침 회피.
    labels.push({
      text: SLOT_NAMES[b.slot] ?? "?",
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
  // 누운 몸도 바닥에 닿아 있다 — 접지 그림자를 서 있는 몸보다 넓고 옅게 깐다.
  contactShadow(ctx, cx, restY, BODY_SIZE * 1.1, 0.6);
  ctx.fillStyle = withAlpha(C_CORPSE, a * 0.85);
  ctx.beginPath();
  ctx.ellipse(cx, restY, BODY_SIZE * 0.56, BODY_SIZE * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  // 스캔 빔 안에서 회색이 배경에 먹히지 않도록 뒤를 살짝 눌러 둔다.
  ghostBacking(ctx, cx, restY, A_GHOST_OUTLINE * 0.5);

  // 서 있는 몸과 **같은 작도법**이되 `sprawl: 1` 이라 머리 원이 몸통 타원 옆으로 빠지고
  // 다리가 벌어진다. 위에서 본 사람이 서 있지 않다는 걸 그 배치 하나가 말한다 —
  // 회색 + 낮은 알파까지 더해 살아 있는 잔상과 한 프레임도 헷갈리지 않는다.
  drawTopFigure(
    ctx,
    cx,
    restY,
    FIG_W,
    angleOf(b.facing),
    {
      shoulderTwist: 0.55,
      hipTwist: -0.32,
      armL: 0.85,
      armR: -0.55,
      lean: 0,
      footL: 0.45,
      footR: -0.6,
      hairMass: 0.6,
      sprawl: 1,
    },
    {
      color: C_CORPSE,
      alpha: Math.min(1, a * 2.1),
      bulk: BULK_BODY,
      inkSeed: 700 + b.slot * 31,
      shade: C_BG,
      style: "silhouette",
    },
  );

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
    text: SLOT_NAMES[b.slot] ?? "?",
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
    const size = guardSizePx(g);
    const x = P(g.x);
    const y = P(g.y);
    const cx = x + size / 2;
    const cy = y + size / 2;
    const shoulder = guardShoulderPx(g);
    const drawR = guardDrawR(g);
    const top = cy - drawR;
    const alarmFx = view.guardAlarmFx.get(g.id) ?? 0;
    const gg = view.guardGaits.get(g.id);
    const drawAng = gg?.drawAng ?? angleOf(g.facing);
    /** 네발 유형은 그림자도 몸을 따라 길쭉하게 눕는다(30 : 13 = 몸통 28 : 14 와 같은 비). */
    const quad = TOP_BUILD[g.kind].quad === true;

    if (g.state === "CHASE") {
      const pulse = 0.3 + Math.sin(view.frame * 0.3) * 0.16;
      const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, size * 1.5);
      halo.addColorStop(0, withAlpha(C_GUARD, pulse));
      halo.addColorStop(1, withAlpha(C_GUARD, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(cx - size * 1.5, cy - size * 1.5, size * 3, size * 3);
    }

    floorTint(ctx, cx, cy, size * 0.9, C_GUARD, 0.26);
    contactShadow(
      ctx,
      cx,
      cy,
      guardShadowW(g),
      1,
      quad ? drawAng : 0,
      quad ? 30 / 13 : 1,
    );
    // 꺾쇠는 실루엣 밖에 놓는다. 고정 24px 로 두면 BRUTE(어깨 51)의 몸 **안쪽**에 찍혀
    // 방향 정보가 실루엣에 먹히고, WATCHER 는 삼각대 다리 위에 겹친다.
    facingPip(ctx, cx, cy, g.facing, "#ffb0a8", drawR + 5, 7);

    // 유형은 **형태로만** 갈린다(색은 상태가 쓴다). 몸 크기는 시뮬의 충돌 박스에서
    // 파생되므로 BRUTE 는 화면에서도 실제로 압도적이다 — 어깨 51px 대 SENTRY 28px.
    // 유형 → 시트는 이름으로 잇는다. 배열 인덱스로 이으면 레벨에서 유형 순서가
    // 바뀌는 순간 HOUND 가 사람처럼 걷는 사고가 난다.
    if (
      !drawBodySprite(
        ctx,
        GUARD_SHEET[g.kind] ?? "sentry",
        cx,
        cy,
        g.facing,
        gg,
      )
    ) {
      drawTopFigure(
        ctx,
        cx,
        cy,
        guardFigU(g) * gaitLift(gg),
        drawAng,
        topPose({
          phase: gg?.phase ?? 0,
          run: gg?.run ?? 0,
          motion: gg?.motion ?? 0,
          lean: leanOf(gg),
          build: g.kind,
        }),
        {
          color: C_GUARD,
          outline: "#ff9a90",
          shade: "#2a0d0b",
          bulk: BULK_GUARD,
          inkSeed: 900 + g.id * 17,
        },
      );
    }

    // 경보를 울리는 순간의 몸 신호: 흰빛으로 달아오르는 링 두 겹.
    // 방사 링(`view.rings`)은 사방으로 퍼지고, 이건 **누가** 울렸는지를 못 박는다.
    if (alarmFx > 0) {
      const t = 1 - alarmFx / ALARM_FX_TICKS;
      const blink = 0.55 + Math.sin(view.frame * 0.9) * 0.45;
      ctx.strokeStyle = withAlpha("#ffd9d2", (1 - t) * blink * 0.95);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, drawR + t * 6, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(C_GUARD, (1 - t) * 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, drawR + 5 + t * 14, 0, TAU);
      ctx.stroke();
    }

    // 감지 게이지 — 언제 SUSPICIOUS 로 넘어가는지 플레이어가 읽을 수 있어야 한다.
    // 폭도 어깨를 따라간다: BRUTE 위에 26px 막대만 떠 있으면 몸에 비해 사라진다.
    if (g.detect > 0) {
      const w = Math.max(26, shoulder * 0.9);
      const frac = Math.max(0, Math.min(1, g.detect / DETECT_MAX));
      ctx.fillStyle = withAlpha("#000000", 0.6);
      ctx.fillRect(cx - w / 2, top - 8, w, 4);
      ctx.fillStyle = frac >= 1 ? C_GUARD : frac >= 0.4 ? "#ffb057" : "#ffe08a";
      ctx.fillRect(cx - w / 2, top - 8, w * frac, 4);
    }

    const tag =
      g.state === "CHASE"
        ? "!"
        : g.state === "SUSPICIOUS" || g.state === "INVESTIGATE"
          ? "?"
          : "";
    if (tag !== "") {
      ctx.fillStyle = C_GUARD;
      ctx.font = font(13, "bold");
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(tag, cx, top - 12);
    }

    // 유형 이름. 감지 게이지와 !/? 는 위쪽을 이미 쓰고 있으니 라벨은 발밑에.
    // 실루엣이 아직 안 외워진 플레이어에게는 이 한 줄이 유일한 확답이다.
    ctx.fillStyle = withAlpha(C_GUARD, 0.5);
    ctx.font = font(7, "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(g.kind, cx, cy + drawR + 9);
  }
}

/** 조작 중인 몸(I). 항상 최상단, 항상 불투명. */
/**
 * 몸(주인공·잔상·경비)을 스프라이트로 그린다. 시트가 없으면 false 를 돌려
 * 호출부가 기존 코드 드로잉으로 떨어지게 한다.
 *
 * **판정은 한 톨도 건드리지 않는다.** 그리는 자리는 시뮬이 준 `cx`/`cy` 그대로고,
 * 방향은 `facing` 을 그대로 읽는다. 스프라이트가 충돌 박스보다 커 보여도 박스를
 * 늘리지 않고 그림만 그 자리에 놓는다.
 *
 * 걸음 프레임은 `Gait.phase`(이동 **거리**로만 자라는 위상)에서 뽑는다. 그래서
 * 멈추면 프레임도 멈추고, 달리면 저절로 빨라지며, frozen 잔상은 마지막 걸음에서
 * 굳는다 — 코드 드로잉이 이미 갖고 있던 성질을 그대로 물려받는다.
 */
function drawBodySprite(
  ctx: CanvasRenderingContext2D,
  id: sprites.SpriteId,
  cx: number,
  cy: number,
  facing: number,
  gait: Gait | undefined,
  tint?: { color: string; alpha: number },
): boolean {
  if (!sprites.has(id)) return false;
  const row = sprites.rowOfFacing(facing);
  const moving = (gait?.motion ?? 0) > 0.05;
  const turns = (gait?.phase ?? 0) / (Math.PI * 2);
  const col = moving ? ((Math.floor(turns * 8) % 8) + 8) % 8 : 0;
  // 셀 가운데가 아니라 **발밑**을 몸 중심에 맞춘다. 시트의 인물은 셀 아래쪽에
  // 서 있어서 가운데로 놓으면 바닥에서 떠 보인다.
  const cell = sprites.cellOf(id);
  const dy = cell === undefined ? 0 : cell.h * 0.12;
  if (tint !== undefined) {
    return sprites.drawTinted(
      ctx,
      id,
      col,
      row,
      cx,
      cy - dy,
      tint.color,
      tint.alpha,
    );
  }
  return sprites.draw(
    ctx,
    id,
    col,
    row,
    cx - (cell?.w ?? 0) / 2,
    cy - dy - (cell?.h ?? 0) / 2,
  );
}

/** 경비 유형 → 시트 아이디. 파일명 순서가 아니라 **유형 이름**으로 잇는다. */
const GUARD_SHEET: Readonly<Record<string, sprites.SpriteId>> = {
  SENTRY: "sentry",
  HOUND: "hound",
  BRUTE: "brute",
  WATCHER: "watcher",
};

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
  floorTint(ctx, cx, cy, FIG_W, C_I_CORE, 0.34);
  contactShadow(ctx, cx, cy, SHADOW_W, 1);

  // 발밑 시안 링 **하나**. 잔상 셋과 경비 둘이 겹쳐도 바닥에서 조작 중인 몸을 못 박되,
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
  if (!drawBodySprite(ctx, "player", cx, cy, b.facing, gait)) {
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
        shade: "#0a1018",
        bulk: BULK_BODY,
        inkSeed: 401,
      },
    );
  }

  // 바깥 펄스 링은 없앴다. 접지 링과 합쳐 동심원 두 겹이 되는 순간 인물이 표적 마커로
  // 읽히고, 정작 머리와 어깨가 안 보인다. 밀집 상황의 식별은 링 하나 + 머리 위 `I` 로 한다.

  ctx.fillStyle = C_I_CORE;
  ctx.font = font(9, "bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("I", cx, top - 4);
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
