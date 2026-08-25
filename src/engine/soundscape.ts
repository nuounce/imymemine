/**
 * 정위 오디오 — **내가 게임을 듣는** 채널.
 *
 * `mic.ts` 가 "게임이 나를 듣는" 단방향이라면 이 파일은 그 반대다. 매 틱 `SimState` 를
 * **읽기만** 해서 "지금 무슨 소리가, 어느 쪽에서, 얼마나 멀리서, 벽 너머인지"를
 * 계산해 `Cue` 목록으로 내놓는다. 실제 발음은 `audio.ts` 가 한다.
 *
 * ── 왜 DOM 을 모르는가 ────────────────────────────────────────────────────
 * WebAudio 를 여기 섞으면 헤드리스로 검증할 수 없다. 정위·감쇠·차폐·발소리 주기는
 * 전부 수치 판정이라 순수 함수로 짜면 `tests/soundscape.test.ts` 가 그대로 증명한다.
 * 그래서 이 파일에는 `AudioContext` 도 `window` 도 등장하지 않는다.
 *
 * ── 결정론 ────────────────────────────────────────────────────────────────
 * **`SimState` / `Session` 을 한 비트도 쓰지 않는다.** 오디오 상태(발소리 위상,
 * 이전 경비 상태 등)는 전부 `SoundscapeState` 안에 있다. 쓰는 순간 잔상 재생이
 * 어긋나므로, 이 불변은 해시 비교로 테스트한다 (§8).
 */

import { BODY_SUB, DETECT_MAX, IN_RUN, SUBPIXEL, TILE_SUB } from '../sim/constants';
import { closedGateRects } from '../sim/devices';
import { crateRects, lineBlocked, type Rect } from '../sim/physics';
import type { GuardKind, GuardState, SimState } from '../sim/types';

// ── 공개 타입 ──────────────────────────────────────────────────────────────

/** 감지 방식. `game/session.ts` 의 `Mode` 와 같은 값이지만 의존을 만들지 않는다. */
export type AudioMode = 'EASY' | 'LISTEN';

export type CueKind =
  /** SENTRY — 규칙적인 구둣발. 중역 짧은 탁음. */
  | 'FOOT_SENTRY'
  /** BRUTE — 무겁고 느린 저역 쿵. */
  | 'FOOT_BRUTE'
  /** HOUND — 빠르고 가벼운 발톱. */
  | 'FOOT_HOUND'
  /** HOUND 의 주기적인 킁킁대는 숨. */
  | 'SNIFF'
  /** WATCHER — 렌즈 도는 미세한 모터음. 발소리가 없는 대신 이게 계속 난다. */
  | 'MOTOR'
  /** SUSPICIOUS 진입 — 숨 들이키는 소리. */
  | 'GASP'
  /** INVESTIGATE 진입 — 무전 잡음. */
  | 'RADIO'
  /** CHASE 진입 — 고함. */
  | 'SHOUT'
  /** WATCHER 경보 — 가장 크고 멀리 들린다. */
  | 'SIREN'
  /** 눈뽕에 당한 순간의 신음. */
  | 'GROAN'
  /** 잔상의 발소리. 먹먹하다 = 과거다. */
  | 'GHOST_FOOT'
  /** 주인공의 숨. 감지 게이지가 오를수록 가빠진다. */
  | 'BREATH';

export interface Cue {
  kind: CueKind;
  /** 소스 엔티티 id. 같은 소스는 항상 같은 값 (정렬 tie-break 에도 쓴다). */
  srcId: number;
  /** 좌우 정위 −1(왼쪽) … 0(정면) … +1(오른쪽). */
  pan: number;
  /** 최종 게인 0..1. 모드 배수·거리 감쇠·차폐 감쇠가 모두 반영돼 있다. */
  gain: number;
  /** 로우패스 컷오프 Hz. `null` = 필터 없음(트인 곳). */
  cutoffHz: number | null;
  /** 리스너와의 거리(서브픽셀). `BREATH` 만 −1 (내 몸에서 나므로 항상 최우선). */
  dist: number;
  /** 세기 0..1. `BREATH` 는 감지 게이지, 나머지는 1. */
  intensity: number;
}

export interface ModeTuning {
  /** 기준 사거리(서브픽셀). 이보다 멀면 게인 0. */
  range: number;
  /** 전체 게인 배수. */
  gain: number;
  /**
   * 발소리 주기 배수. 1 보다 작으면 같은 거리를 걸어도 발소리가 더 자주 난다
   * = **촘촘하다**. LISTEN 이 "예민한 모드"인 이유의 절반이 이 숫자다.
   */
  strideScale: number;
  /** 숨소리 게인 배수. */
  breathGain: number;
}

// ── 튜닝 상수 ──────────────────────────────────────────────────────────────

/**
 * 동시 재생 상한. 경비 넷 + 잔상 셋이 한꺼번에 울면 소리가 뭉개져 오히려
 * 정보가 사라진다. 넘치면 **가까운 것부터** 남긴다.
 */
export const MAX_VOICES = 12;

/** 이 x 차이에서 정위가 완전히 한쪽으로 붙는다 = 6타일. */
export const PAN_SPREAD = 6 * TILE_SUB;

/** 벽 너머 소리의 로우패스 컷오프. 저역만 남아 "막혔다"로 읽힌다. */
export const MUFFLE_CUTOFF_HZ = 420;
/** 차폐된 소리의 게인 배수. */
export const MUFFLE_GAIN = 0.55;

/** 잔상 발소리는 더 낮게 자른다 — "지금"과 "과거"를 귀로 가른다. */
export const GHOST_CUTOFF_HZ = 260;
export const GHOST_GAIN = 0.42;

/** 이보다 작은 게인은 발음하지 않는다(들리지도 않으면서 자리만 먹는다). */
const GAIN_EPSILON = 0.0008;

/**
 * 정위 오디오와 발소리는 **두 모드 모두**에서 난다 — 재미 요소이기 때문이다.
 * LISTEN 은 그 위에 사거리·게인·촘촘함·숨소리를 얹어 "예민한 모드"를 만든다.
 *
 * | 항목 | EASY | LISTEN | 배수 |
 * |---|---|---|---|
 * | 사거리 | 9타일 | 15타일 | 1.67× |
 * | 게인 | 0.72 | 1.00 | 1.39× |
 * | 발소리 주기 | 1.00 | 0.75 | 1.33× 촘촘 |
 * | 숨소리 게인 | 0.30 | 1.00 | 3.33× |
 */
export const TUNING: Readonly<Record<AudioMode, ModeTuning>> = Object.freeze({
  EASY: Object.freeze({
    range: 9 * TILE_SUB,
    gain: 0.72,
    strideScale: 1,
    breathGain: 0.3,
  }),
  LISTEN: Object.freeze({
    range: 15 * TILE_SUB,
    gain: 1,
    strideScale: 0.75,
    breathGain: 1,
  }),
});

/**
 * 유형별 발소리 보폭(서브픽셀). **주기가 아니라 거리**다 — 실제로 그만큼 움직여야
 * 한 발이 난다. 그래서 경비가 멈추면 발소리도 멈춘다(별도 분기 없이).
 *
 * 기본 순찰 속도로 환산한 실제 간격:
 *   SENTRY 6656 / 416 = 16틱 (0.27초)  — 규칙적인 구둣발
 *   BRUTE 10240 / 256 = 40틱 (0.67초)  — 간격이 길다 = 무겁다
 *   HOUND  3328 / 480 =  7틱 (0.12초)  — 빠르고 가볍다
 *   WATCHER 0 = 발소리 없음 (대신 MOTOR)
 */
const STRIDE_SUB: Readonly<Record<GuardKind, number>> = Object.freeze({
  SENTRY: 26 * SUBPIXEL,
  BRUTE: 40 * SUBPIXEL,
  HOUND: 13 * SUBPIXEL,
  WATCHER: 0,
  // 보스 4종. 발소리는 가장 가까운 기존 유형의 보폭을 쓴다 — 보스만의 음색은
  // 아직 없다(전용 큐가 생기면 `footKindOf` 와 함께 갈아 끼우면 된다).
  // COUNTER 는 WATCHER 처럼 서 있지 않고 **천천히 걷는다**(순찰 288) — 그래서
  // 보폭 0 이 아니라 SENTRY 보다 긴 보폭을 준다. 느린 발소리가 곧 그 유형의 정보다.
  INSPECTOR: 26 * SUBPIXEL,
  PACK_LEAD: 13 * SUBPIXEL,
  OVERSEER: 26 * SUBPIXEL,
  COUNTER: 30 * SUBPIXEL,
});

/** 잔상의 보폭. 걷기 512/틱 기준 12틱, 달리면 저절로 잦아진다. */
const GHOST_STRIDE_SUB = 24 * SUBPIXEL;

/** 몸의 AABB 중심 보정. 리스너는 좌상단이 아니라 **귀의 위치**다. */
const BODY_HALF = BODY_SUB / 2;

/** HOUND 가 킁킁대는 간격(틱). */
const SNIFF_TICKS = 46;
/** WATCHER 렌즈 모터음 간격(틱). 끊기지 않게 소리 길이(0.35초 ≈ 21틱)보다 짧게 잡는다. */
const MOTOR_TICKS = 18;

/** 안전할 때의 숨 간격 / 완전히 발각됐을 때의 숨 간격(틱). */
const BREATH_SLOW = 78;
const BREATH_FAST = 20;
/** 달리면 이 배수만큼 더 가빠진다. */
const BREATH_RUN_PERIOD = 0.7;
/** 안전할 때는 거의 안 들린다. 가득 차면 화면을 안 봐도 안다. */
const BREATH_MIN_GAIN = 0.04;
const BREATH_MAX_GAIN = 0.5;
const BREATH_RUN_GAIN = 0.09;

/**
 * 종류별 상대 크기와 사거리 배수.
 *
 * 경보(SIREN)의 사거리 3배는 연출이 아니라 규칙이다 — WATCHER 는 직접 잡지 않고
 * **다른 경비를 부르는** 적이므로, 그 사실이 맵 반대편에서도 들려야 대응할 수 있다.
 */
const KIND: Readonly<Record<CueKind, { gain: number; range: number }>> =
  Object.freeze({
    FOOT_SENTRY: { gain: 0.5, range: 1 },
    FOOT_BRUTE: { gain: 0.7, range: 1.25 },
    FOOT_HOUND: { gain: 0.4, range: 0.85 },
    SNIFF: { gain: 0.35, range: 0.7 },
    MOTOR: { gain: 0.28, range: 0.75 },
    GASP: { gain: 0.4, range: 0.7 },
    RADIO: { gain: 0.5, range: 1.1 },
    SHOUT: { gain: 0.85, range: 1.6 },
    SIREN: { gain: 1, range: 3 },
    GROAN: { gain: 0.45, range: 0.8 },
    GHOST_FOOT: { gain: 0.3, range: 0.8 },
    BREATH: { gain: 1, range: 1 },
  });

// ── 순수 계산 ──────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 좌우 정위. `dx` = 소스 x − 리스너 x (서브픽셀).
 * 오른쪽이 양수, `PAN_SPREAD` 에서 −1/+1 로 포화한다.
 */
export function panOf(dx: number): number {
  const p = dx / PAN_SPREAD;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/**
 * 거리 감쇠. 사거리 안에서는 **단조 감소**하고, 사거리 밖은 정확히 0 이다.
 * 제곱을 쓰는 이유는 가까운 소리가 확실히 두드러져야 방향 판단이 되기 때문이다.
 */
export function distanceGain(dist: number, range: number): number {
  if (range <= 0) return 0;
  if (dist >= range) return 0;
  if (dist <= 0) return 1;
  const t = 1 - dist / range;
  return t * t;
}

/** 유형별 보폭(서브픽셀). 0 이면 발소리를 내지 않는 유형이다. */
export function strideOf(kind: GuardKind, tuning: ModeTuning): number {
  return (STRIDE_SUB[kind] ?? 0) * tuning.strideScale;
}

/** 감지 게이지 0..1 → 숨 간격(틱). 게이지가 오를수록 짧아진다 = 가빠진다. */
export function breathPeriod(intensity: number, running: boolean): number {
  const t = clamp01(intensity);
  const p = BREATH_SLOW + (BREATH_FAST - BREATH_SLOW) * t;
  return Math.max(8, Math.round(running ? p * BREATH_RUN_PERIOD : p));
}

/** 감지 게이지 0..1 → 숨 게인. `intensity` 에 대해 **강한 단조 증가**다. */
export function breathGain(
  intensity: number,
  running: boolean,
  tuning: ModeTuning,
): number {
  const t = clamp01(intensity);
  const base = BREATH_MIN_GAIN + (BREATH_MAX_GAIN - BREATH_MIN_GAIN) * t * t;
  return (base + (running ? BREATH_RUN_GAIN : 0)) * tuning.breathGain * tuning.gain;
}

/**
 * 동시 재생 상한 적용. 가까운 것이 남는다.
 * 같은 거리는 `srcId` → `kind` 로 갈라 출력 순서를 고정한다(디버깅 재현성).
 */
export function limitCues(cues: readonly Cue[], max: number = MAX_VOICES): Cue[] {
  const sorted = cues.slice().sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.srcId !== b.srcId) return a.srcId - b.srcId;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  return sorted.length <= max ? sorted : sorted.slice(0, max);
}

// ── 오디오 전용 상태 ───────────────────────────────────────────────────────

/** 한 소스(경비 또는 몸)의 오디오 상태. 시뮬에는 존재하지 않는 값들이다. */
interface SrcState {
  /** 직전 틱 좌표. 이번 틱 이동량을 재는 데만 쓴다. */
  x: number;
  y: number;
  /** 마지막 발소리 이후 누적 이동 거리(서브픽셀). */
  stride: number;
  /** 시간 기반 소리(킁킁 · 모터)의 위상(틱). */
  phase: number;
  /** 직전 틱의 상태/타이머. 전이 순간을 잡는다. */
  state: GuardState | null;
  dazed: number;
  alarm: number;
}

export interface SoundscapeState {
  srcs: Map<number, SrcState>;
  breathPhase: number;
  /** 마지막으로 알려진 리스너(조작 중인 몸) 중심. 몸이 없을 때의 폴백. */
  listenerX: number;
  listenerY: number;
}

export function createSoundscape(): SoundscapeState {
  return { srcs: new Map(), breathPhase: 0, listenerX: 0, listenerY: 0 };
}

/**
 * 루프/스테이지 경계에서 부른다. 위상과 이전 상태를 버려 전환 직후에
 * "없던 발소리 한 발"이나 가짜 상태 전이가 터지지 않게 한다.
 */
export function resetSoundscape(st: SoundscapeState): void {
  st.srcs.clear();
  st.breathPhase = 0;
}

function srcOf(st: SoundscapeState, id: number, x: number, y: number): SrcState {
  const cur = st.srcs.get(id);
  if (cur !== undefined) return cur;
  // 처음 본 소스는 "이번 틱에 제자리에 있었다"로 시작한다 — 스폰 좌표를 이동으로
  // 오인해 첫 틱에 발소리가 터지는 것을 막는다.
  const fresh: SrcState = { x, y, stride: 0, phase: 0, state: null, dazed: 0, alarm: 0 };
  st.srcs.set(id, fresh);
  return fresh;
}

// ── 갱신 ───────────────────────────────────────────────────────────────────

interface EmitCtx {
  st: SoundscapeState;
  sim: SimState;
  rects: readonly Rect[];
  tuning: ModeTuning;
  out: Cue[];
}

function emit(
  c: EmitCtx,
  kind: CueKind,
  srcId: number,
  sx: number,
  sy: number,
  intensity: number,
): void {
  const spec = KIND[kind];
  const dx = sx - c.st.listenerX;
  const dy = sy - c.st.listenerY;
  const dist = Math.hypot(dx, dy);
  const base = distanceGain(dist, c.tuning.range * spec.range);
  if (base <= 0) return;

  let gain = base * spec.gain * c.tuning.gain * intensity;
  let cutoff: number | null = null;

  // 차폐 판정은 SimState 를 **읽기만** 한다. 경비 시야에 쓰는 레이캐스트를 그대로
  // 재사용하므로, 눈에 안 보이는 곳은 귀에도 벽 너머로 들린다 — 일관성이 공짜다.
  if (lineBlocked(c.sim, c.rects, c.st.listenerX, c.st.listenerY, sx, sy)) {
    gain *= MUFFLE_GAIN;
    cutoff = MUFFLE_CUTOFF_HZ;
  }
  if (kind === 'GHOST_FOOT') {
    gain *= GHOST_GAIN;
    cutoff = cutoff === null ? GHOST_CUTOFF_HZ : Math.min(cutoff, GHOST_CUTOFF_HZ);
  }
  if (gain <= GAIN_EPSILON) return;

  c.out.push({ kind, srcId, pan: panOf(dx), gain, cutoffHz: cutoff, dist, intensity });
}

function footKindOf(kind: GuardKind): CueKind | null {
  switch (kind) {
    case 'SENTRY':
    // 보스 3종은 걷는 유형이다. 전용 음색이 없다고 **소리 없이** 걷게 두면
    // 귀로 위치를 잡는 플레이가 이 셋 앞에서만 통하지 않는다.
    case 'INSPECTOR':
    case 'OVERSEER':
    case 'COUNTER':
      return 'FOOT_SENTRY';
    case 'BRUTE':
      return 'FOOT_BRUTE';
    case 'HOUND':
    case 'PACK_LEAD':
      return 'FOOT_HOUND';
    default:
      return null; // WATCHER 는 걷지 않는다.
  }
}

/** 이동 거리를 보폭에 누적하고, 한 발이 찼으면 true. 한 틱에 최대 한 발. */
function advanceStride(src: SrcState, moved: number, stride: number): boolean {
  if (stride <= 0) return false;
  src.stride += moved;
  if (src.stride < stride) return false;
  // 순간이동(스테이지 리셋 등)으로 누적이 폭주해도 다음 틱에 몰아 터지지 않게 자른다.
  src.stride = Math.min(src.stride - stride, stride);
  return true;
}

/**
 * 이번 틱에 들려야 할 소리 전부.
 *
 * @param sim **읽기 전용으로만 다룬다.** 이 함수는 `sim` 의 어떤 필드도 쓰지 않는다.
 * @returns 상한(`MAX_VOICES`)이 적용되고 가까운 순으로 정렬된 목록.
 */
export function updateSoundscape(
  st: SoundscapeState,
  sim: SimState,
  mode: AudioMode,
): Cue[] {
  const tuning = TUNING[mode];

  const live =
    sim.bodies.find((b) => b.isLive && b.alive) ??
    sim.bodies.find((b) => b.isLive) ??
    null;
  if (live !== null) {
    // 리스너는 **귀의 위치**이므로 AABB 좌상단이 아니라 중심이다.
    st.listenerX = live.x + BODY_HALF;
    st.listenerY = live.y + BODY_HALF;
  }

  const out: Cue[] = [];
  const c: EmitCtx = {
    st,
    sim,
    rects: crateRects(sim.crates).concat(closedGateRects(sim)),
    tuning,
    out,
  };

  // ── 경비 ────────────────────────────────────────────────────────────────
  let maxDetect = 0;
  for (const gd of sim.guards) {
    if (gd.detect > maxDetect) maxDetect = gd.detect;

    const src = srcOf(st, gd.id, gd.x, gd.y);
    const moved = Math.hypot(gd.x - src.x, gd.y - src.y);
    src.x = gd.x;
    src.y = gd.y;

    const cx = gd.x + gd.sizeSub / 2;
    const cy = gd.y + gd.sizeSub / 2;

    // 발소리 — 실제 이동량에 맞춘다. 어지러운 경비는 움직이지 않으니 저절로 멈춘다.
    const foot = footKindOf(gd.kind);
    if (foot !== null && advanceStride(src, moved, strideOf(gd.kind, tuning))) {
      emit(c, foot, gd.id, cx, cy, 1);
    }

    // 시간 기반 소리 — 서 있어도 난다.
    if (gd.kind === 'HOUND') {
      if (gd.dazed === 0 && ++src.phase >= SNIFF_TICKS) {
        src.phase = 0;
        emit(c, 'SNIFF', gd.id, cx, cy, 1);
      }
    } else if (gd.kind === 'WATCHER') {
      // 렌즈는 어지러운 동안에도 돈다(경보만 못 울린다) — 모터음은 계속이다.
      if (++src.phase >= MOTOR_TICKS) {
        src.phase = 0;
        emit(c, 'MOTOR', gd.id, cx, cy, 1);
      }
    }

    // 상태 전이 목소리. 첫 관측(state === null)은 전이가 아니다.
    if (src.state !== null && src.state !== gd.state) {
      if (gd.state === 'SUSPICIOUS') emit(c, 'GASP', gd.id, cx, cy, 1);
      else if (gd.state === 'INVESTIGATE') emit(c, 'RADIO', gd.id, cx, cy, 1);
      else if (gd.state === 'CHASE') emit(c, 'SHOUT', gd.id, cx, cy, 1);
    }
    src.state = gd.state;

    // 경보는 쿨다운이 0 → 양수로 튀는 그 틱에 딱 한 번 울렸다는 뜻이다.
    if (src.alarm === 0 && gd.alarmCooldown > 0) emit(c, 'SIREN', gd.id, cx, cy, 1);
    src.alarm = gd.alarmCooldown;

    // 눈뽕에 당한 신음도 같은 방식으로 상승 엣지에서만.
    if (src.dazed === 0 && gd.dazed > 0) emit(c, 'GROAN', gd.id, cx, cy, 1);
    src.dazed = gd.dazed;
  }

  // ── 잔상 ────────────────────────────────────────────────────────────────
  for (const b of sim.bodies) {
    if (b.isLive) continue;
    const src = srcOf(st, b.id, b.x, b.y);
    const moved = Math.hypot(b.x - src.x, b.y - src.y);
    src.x = b.x;
    src.y = b.y;
    // 시체는 소리를 내지 않는다. 정지한 잔상도 마찬가지(움직이지 않으니 누적이 없다).
    if (!b.alive || b.frozen) {
      src.stride = 0;
      continue;
    }
    if (advanceStride(src, moved, GHOST_STRIDE_SUB * tuning.strideScale)) {
      emit(c, 'GHOST_FOOT', b.id, b.x + BODY_HALF, b.y + BODY_HALF, 1);
    }
  }

  // ── 주인공의 숨 ─────────────────────────────────────────────────────────
  // 감지 게이지가 오를수록 가빠진다. 어느 경비에게든 가장 높은 값이 기준이다 —
  // "누가" 보고 있는지는 몰라도 "지금 보이고 있다"는 사실은 알아야 한다.
  if (live !== null && live.alive) {
    const intensity = clamp01(maxDetect / DETECT_MAX);
    const running = (live.lastInput & IN_RUN) !== 0;
    if (++st.breathPhase >= breathPeriod(intensity, running)) {
      st.breathPhase = 0;
      const gain = breathGain(intensity, running, tuning);
      if (gain > GAIN_EPSILON) {
        out.push({
          kind: 'BREATH',
          srcId: live.id,
          pan: 0,
          gain,
          cutoffHz: null,
          // 내 몸에서 나는 소리다. 거리 −1 이라 상한에서 항상 살아남는다.
          dist: -1,
          intensity,
        });
      }
    }
  } else {
    st.breathPhase = 0;
  }

  return limitCues(out);
}
