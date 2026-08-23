/**
 * I.MY.ME.MINE — 사람 그리기 전용 모듈.
 *
 * 이전 인트로의 인물이 로봇으로 보인 이유는 **좌우가 대칭**이고 **팔다리가 곧은 막대**이고
 * **어깨선이 수평**이었기 때문이다. 이 모듈은 그 세 가지를 구조적으로 불가능하게 만든다:
 *
 * 1. 포즈는 좌/우를 **각각** 받는다(`armL`/`armR`, `legL`/`legR`). 대칭을 쓰려면 일부러 같은
 *    숫자를 두 번 적어야 한다 — POSES 는 어느 항목에서도 그러지 않는다.
 * 2. 팔다리는 관절 2개 체인(상완→전완, 대퇴→정강이)이라 항상 꺾인다. 굵기도 끝으로 갈수록 준다.
 * 3. 어깨축은 `shoulderTilt` 만큼 기울고, 골반은 그 **반대로** 돌아간다(콘트라포스토).
 * 4. 머리는 원이 아니라 **기울어진 타원** + 비대칭 머리 덩어리.
 * 5. 선은 `inkSeed` 기반 결정론적 지터라 손으로 그은 듯 흔들리되 **프레임마다 떨리지 않는다**.
 *
 * 좌표계: 단위 공간에서 골반이 원점, y 가 위쪽 양수, 전신 키 1.0. 그리는 순간
 * `height`(px)를 곱하고, 포즈에서 계산된 최저점이 `y`(바닥)에 놓이도록 평행이동한다.
 * 그래서 서 있든 앉아 있든 누워 있든 호출부는 언제나 "발이 닿는 점"만 주면 된다.
 *
 * 렌더 전용이다. `sim/` 을 import 하지 않고 SimState 를 읽지도 쓰지도 않는다.
 */

type V2 = [number, number];

/**
 * 한 사람의 자세.
 *
 * 팔·다리 각도는 **아래(0,-1) 방향 기준 라디안**이고 양수가 +x 쪽이다.
 * 두 번째 성분은 첫 관절에 **상대적인** 꺾임이라, 0 이면 곧은 막대가 된다 — POSES 는 쓰지 않는다.
 */
export interface Pose {
  /** 목 위에서 머리를 더 꺾는 각. 0 이면 인형이 된다 — POSES 는 전부 0 이 아니다. */
  headTilt: number;
  /** 어깨선 기울기. 0 이면 수평 어깨가 되므로 항상 준다. */
  shoulderTilt: number;
  /** 몸통 기울기(양수 = +x 로 기욺). 누운 자세는 여기서 1.45 까지 간다. */
  lean: number;
  /** 먼 쪽 팔 [상완, 전완]. */
  armL: [number, number];
  /** 가까운 쪽 팔 [상완, 전완]. `armL` 과 같으면 안 된다. */
  armR: [number, number];
  /** 먼 쪽 다리 [대퇴, 정강이]. */
  legL: [number, number];
  /** 가까운 쪽 다리 [대퇴, 정강이]. `legL` 과 달라야 한쪽에 체중이 실린다. */
  legR: [number, number];
  /** 머리 실루엣에 붙는 비대칭 덩어리(머리카락/후드)의 양. 0..1. */
  hairMass: number;
  /**
   * 어깨 반폭 배율(기본 1). 두 용도가 있다:
   * 체격(경비는 1 보다 크다)과 **몸을 튼 정도**(측면을 보면 어깨가 겹쳐 좁아진다).
   * 생략하면 1 이라 기존 `POSES` 는 그대로다.
   */
  shoulderScale?: number;
  /** 골반 반폭 배율(기본 1). 생략하면 1. */
  hipScale?: number;
}

export interface FigureOpts {
  color: string;
  alpha?: number;
  /** 실루엣 위에 얹는 손그림 림라이트 색. 없으면 안 그린다. */
  outline?: string;
  /** 결정론적 지터 시드. 같은 시드 = 매 프레임 같은 흔들림. */
  inkSeed: number;
  /** 좌우 반전(뒷모습·반대편을 볼 때). */
  flip?: boolean;
  /**
   * 칠하는 방식.
   *
   * `'anatomy'`(기본) 은 부위를 하나씩 칠한다. 불투명할 땐 차이가 없지만 **알파가 1 미만이면**
   * 마디가 겹치는 자리마다 색이 두 번 얹혀 관절 원·분절 경계가 드러난다 — 반투명 잔상이
   * 사람이 아니라 인체 해부 모형으로 보이는 원인이 정확히 그것이다.
   *
   * `'silhouette'` 은 불투명한 전신을 따로 한 번 그린 뒤 **통째로** 알파를 먹인다. 안쪽
   * 경계가 원리적으로 생길 수 없고, 몸을 가로지르는 어깨 림라이트도 빠진다. 반투명 잔상은
   * 이쪽을 쓴다.
   */
  style?: 'anatomy' | 'silhouette';
  /**
   * 팔다리 굵기 배율(기본 1). 경비처럼 **체격 자체가 다른** 인물에만 쓴다.
   * 키만 키우면 큰 사람이 아니라 멀리 있는 사람으로 읽힌다.
   */
  bulk?: number;
  /**
   * 얼굴 반점의 진하기 0..1(기본 0 = 안 그림). 머리 앞쪽(=몸이 향한 쪽)에 작은
   * 어두운 덩어리를 얹어 **정면과 후면을 가른다**. 실루엣만으로는 앞뒤가 같아 보인다.
   */
  faceShade?: number;
  /** 얼굴 반점 색. `faceShade > 0` 일 때만 쓴다. */
  faceColor?: string;
}

const TAU = Math.PI * 2;

// ── 인체 비례 (전신 키 1.0, 머리 1/7.5) ────────────────────────────────────

/** 머리 세로 반지름. 머리 높이 = 2×이 값 = 1/7.5. */
const HEAD_RY = 1 / 15;
/** 머리 가로 반지름. 사람 머리는 정면에서 폭:높이 ≈ 0.72. */
const HEAD_RX = HEAD_RY * 0.72;
/** 어깨 반폭 = 머리폭(2·HEAD_RX) × 2.2 ÷ 2. */
const SH_HALF = HEAD_RX * 2.2;
const PELVIS_HALF = 0.052;
const TORSO = 0.3;
const NECK_TO_HEAD = 0.12;
const UPPER_ARM = 0.175;
const FOREARM = 0.165;
const THIGH = 0.26;
const SHIN = 0.25;

// ── 결정론적 지터 ──────────────────────────────────────────────────────────

/** 32bit 정수 해시 → [0,1). 시드와 인덱스가 같으면 값도 같다. */
function hash01(seed: number, i: number): number {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(i | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** [-amp, +amp] 결정론적 흔들림. */
function jit(seed: number, i: number, amp: number): number {
  return (hash01(seed, i) - 0.5) * 2 * amp;
}

// ── 포즈 카탈로그 ──────────────────────────────────────────────────────────
// 어느 항목에서도 armL !== armR, legL !== legR, headTilt !== 0 이다.
// 이 세 조건이 깨지면 즉시 마네킹처럼 보인다.

export const POSES: Record<
  'lying' | 'sitting' | 'standing' | 'reaching' | 'walking' | 'slumped' | 'turning',
  Pose
> = {
  /** 바닥에 널브러짐. 몸통을 1.45 rad 눕혀 머리가 +x 로 간다. */
  lying: {
    headTilt: 0.16,
    shoulderTilt: 0.22,
    lean: 1.45,
    armL: [-1.75, 0.3],
    armR: [1.62, -0.45],
    legL: [-1.42, -0.22],
    legR: [-1.58, 0.3],
    hairMass: 0.75,
  },
  /** 상체를 일으켜 앉음. 한 팔로 뒤를 짚고, 한쪽 무릎만 세웠다. */
  sitting: {
    headTilt: 0.14,
    shoulderTilt: -0.1,
    lean: -0.22,
    armL: [-0.55, -0.18],
    armR: [0.95, 0.7],
    legL: [1.45, 0.08],
    legR: [2.35, -1.92],
    hairMass: 0.6,
  },
  /** 콘트라포스토. 왼다리에 체중이 실리고 오른다리는 무릎이 풀려 있다. */
  standing: {
    headTilt: -0.06,
    shoulderTilt: 0.05,
    lean: -0.03,
    armL: [0.13, 0.22],
    armR: [-0.09, -0.3],
    legL: [0.02, 0.03],
    legR: [0.1, -0.34],
    hairMass: 0.55,
  },
  /** 오른팔을 앞으로 뻗음. 무게가 앞발로 넘어가 뒷발 뒤꿈치가 살짝 뜬다. */
  reaching: {
    headTilt: -0.13,
    shoulderTilt: -0.13,
    lean: 0.1,
    armL: [-0.22, -0.42],
    armR: [1.35, 0.22],
    legL: [0.16, -0.22],
    legR: [-0.3, 0.34],
    hairMass: 0.5,
  },
  /** 보행 중간. 앞다리는 펴고 뒷다리는 무릎이 접혀 뒤꿈치가 든다. */
  walking: {
    headTilt: 0.07,
    shoulderTilt: 0.09,
    lean: 0.11,
    armL: [0.42, -0.3],
    armR: [-0.48, -0.55],
    legL: [0.4, -0.06],
    legR: [-0.34, -0.62],
    hairMass: 0.62,
  },
  /** 고개를 떨구고 등을 만 자세. 얼굴 없이 감정을 만드는 담당. */
  slumped: {
    headTilt: 0.3,
    shoulderTilt: -0.16,
    lean: 0.18,
    armL: [0.06, 0.3],
    armR: [-0.12, 0.55],
    legL: [0.05, -0.02],
    legR: [-0.11, 0.24],
    hairMass: 0.7,
  },
  /**
   * 몸을 반쯤 틀어 뒤를 보는 자세. 어깨가 크게 기울어 등이 비틀린다.
   * 한 팔은 등 뒤로 내리고 다른 팔은 앞으로 접는다 — 좌우로 벌리면 허수아비가 된다.
   */
  turning: {
    headTilt: -0.18,
    shoulderTilt: 0.2,
    lean: -0.07,
    armL: [-0.42, 0.3],
    armR: [0.3, 0.95],
    legL: [-0.06, 0.05],
    legR: [0.15, -0.36],
    hairMass: 0.58,
  },
};

// ── 스켈레톤 ───────────────────────────────────────────────────────────────

interface Joints {
  hip: V2;
  neck: V2;
  head: V2;
  headAng: number;
  shL: V2;
  shR: V2;
  hpL: V2;
  hpR: V2;
  elbL: V2;
  wriL: V2;
  elbR: V2;
  wriR: V2;
  kneeL: V2;
  ankL: V2;
  kneeR: V2;
  ankR: V2;
  /** 이 포즈에서 바닥에 닿는 y(로컬). 그리기 시점에 이 값이 `y` 로 간다. */
  ground: number;
}

/** 아래(0,-1)를 기준으로 `a` 만큼 돌린 단위벡터. 양수 = +x 쪽. */
function down(a: number): V2 {
  return [Math.sin(a), -Math.cos(a)];
}

/** 2관절 체인. 두 번째 각은 첫 마디에 상대적이라 반드시 꺾인다. */
function chain(base: V2, a0: number, a1: number, l0: number, l1: number): [V2, V2] {
  const d0 = down(a0);
  const mid: V2 = [base[0] + d0[0] * l0, base[1] + d0[1] * l0];
  const d1 = down(a0 + a1);
  return [mid, [mid[0] + d1[0] * l1, mid[1] + d1[1] * l1]];
}

function build(p: Pose): Joints {
  const hip: V2 = [0, 0];
  // 배율은 생략 가능하다 — 기존 POSES 는 전부 생략하므로 값이 1 로 떨어져 그림이 그대로다.
  const shHalf = SH_HALF * (p.shoulderScale ?? 1);
  const pelvisHalf = PELVIS_HALF * (p.hipScale ?? 1);

  // 몸통: lean 양수면 +x 로 기운다.
  const td: V2 = [Math.sin(p.lean), Math.cos(p.lean)];
  const neck: V2 = [td[0] * TORSO, td[1] * TORSO];

  // 어깨축은 몸통에 수직(=−lean)에서 shoulderTilt 만큼 더 기운다. 수평 어깨는 여기서 배제된다.
  const sa = -p.lean + p.shoulderTilt;
  const ax: V2 = [Math.cos(sa), Math.sin(sa)];
  const shR: V2 = [neck[0] + ax[0] * shHalf, neck[1] + ax[1] * shHalf];
  const shL: V2 = [neck[0] - ax[0] * shHalf, neck[1] - ax[1] * shHalf];

  // 골반은 어깨와 **반대로** 돈다 — 이 반대 회전이 콘트라포스토의 골격이다.
  const pa = -p.lean - p.shoulderTilt;
  const px: V2 = [Math.cos(pa), Math.sin(pa)];
  const hpR: V2 = [px[0] * pelvisHalf, px[1] * pelvisHalf];
  const hpL: V2 = [-px[0] * pelvisHalf, -px[1] * pelvisHalf];

  // 목/머리: 몸통 방향에서 headTilt 만큼 더 꺾는다.
  const hAng = p.lean + p.headTilt;
  const hd: V2 = [Math.sin(hAng), Math.cos(hAng)];
  const head: V2 = [neck[0] + hd[0] * NECK_TO_HEAD, neck[1] + hd[1] * NECK_TO_HEAD];

  const [elbL, wriL] = chain(shL, p.armL[0], p.armL[1], UPPER_ARM, FOREARM);
  const [elbR, wriR] = chain(shR, p.armR[0], p.armR[1], UPPER_ARM, FOREARM);
  const [kneeL, ankL] = chain(hpL, p.legL[0], p.legL[1], THIGH, SHIN);
  const [kneeR, ankR] = chain(hpR, p.legR[0], p.legR[1], THIGH, SHIN);

  // 바닥은 "가장 낮은 접지 후보". 서면 발, 누우면 등/어깨가 바닥을 만든다.
  const ground = Math.min(
    ankL[1],
    ankR[1],
    wriL[1],
    wriR[1],
    hip[1],
    head[1] - HEAD_RY,
    shL[1],
    shR[1],
  );

  return {
    hip,
    neck,
    head,
    headAng: hAng,
    shL,
    shR,
    hpL,
    hpR,
    elbL,
    wriL,
    elbR,
    wriR,
    kneeL,
    ankL,
    kneeR,
    ankR,
    ground,
  };
}

// ── 손그림 선 ──────────────────────────────────────────────────────────────

/**
 * 손으로 그은 듯 미세하게 흔들리는 선.
 *
 * 지터는 전적으로 `seed` 에서 나온다 — 시간을 섞지 않는다. 프레임마다 난수를 새로 뽑으면
 * 선이 지직거려서 만화가 아니라 노이즈가 된다.
 */
export function inkStroke(
  g: CanvasRenderingContext2D,
  pts: [number, number][],
  width: number,
  seed: number,
): void {
  if (pts.length < 2 || width <= 0) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  let k = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = -dy / len;
    const ny = dx / len;
    // 조각 길이·지터 폭을 굵기에 맞춰 키운다. 굵은 선을 짧게 쪼개면 둥근 캡이 겹쳐
    // 염주알처럼 우툴두툴해진다.
    const seg = Math.max(20, width * 5);
    const amp = Math.min(width, 4) * 0.5;
    const steps = Math.max(1, Math.min(12, Math.round(len / seg)));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      // 이번 조각의 끝 오프셋 = 다음 조각의 시작 오프셋 → 선이 끊기지 않는다.
      const o0 = jit(seed, k, 1) * amp;
      const o1 = jit(seed, k + 1, 1) * amp;
      g.lineWidth = width * (0.86 + hash01(seed, k + 4096) * 0.3);
      g.beginPath();
      g.moveTo(a[0] + dx * t0 + nx * o0, a[1] + dy * t0 + ny * o0);
      g.lineTo(a[0] + dx * t1 + nx * o1, a[1] + dy * t1 + ny * o1);
      g.stroke();
      k++;
    }
  }
  g.restore();
}

/**
 * 뼈 하나. 시작/끝 굵기가 다르고(말단으로 갈수록 가늘다) 중간이 살짝 휜다.
 * 곧은 직선 막대가 나오지 않는 이유가 이 함수다.
 */
function bone(
  g: CanvasRenderingContext2D,
  a: V2,
  b: V2,
  w0: number,
  w1: number,
  seed: number,
  i: number,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = jit(seed, i, 1) * len * 0.034;
  const cx = (a[0] + b[0]) / 2 + nx * bow;
  const cy = (a[1] + b[1]) / 2 + ny * bow;
  const wm = ((w0 + w1) / 2) * (1 + jit(seed, i + 311, 0.1));

  g.beginPath();
  g.moveTo(a[0] + nx * w0 * 0.5, a[1] + ny * w0 * 0.5);
  g.quadraticCurveTo(cx + nx * wm * 0.5, cy + ny * wm * 0.5, b[0] + nx * w1 * 0.5, b[1] + ny * w1 * 0.5);
  g.lineTo(b[0] - nx * w1 * 0.5, b[1] - ny * w1 * 0.5);
  g.quadraticCurveTo(cx - nx * wm * 0.5, cy - ny * wm * 0.5, a[0] - nx * w0 * 0.5, a[1] - ny * w0 * 0.5);
  g.closePath();
  g.fill();

  // 관절 캡 — 이게 없으면 마디마다 각진 틈이 보인다.
  g.beginPath();
  g.arc(a[0], a[1], w0 * 0.5, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(b[0], b[1], w1 * 0.5, 0, TAU);
  g.fill();
}

/** 손: 손목 끝에 붙는 작은 비대칭 덩어리. 팔이 막대로 끝나지 않게 한다. */
function hand(g: CanvasRenderingContext2D, el: V2, wr: V2, r: number, seed: number, i: number): void {
  const dx = wr[0] - el[0];
  const dy = wr[1] - el[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  g.save();
  g.translate(wr[0] + ux * r * 0.5, wr[1] + uy * r * 0.5);
  g.rotate(Math.atan2(uy, ux));
  g.beginPath();
  g.ellipse(0, 0, r * 0.95, r * (0.62 + hash01(seed, i) * 0.26), 0, 0, TAU);
  g.fill();
  g.restore();
}

/** 발: 발목에서 앞쪽으로 눕는 쐐기. 좌우 길이가 다르다. */
function foot(
  g: CanvasRenderingContext2D,
  ak: V2,
  len: number,
  dir: number,
  seed: number,
  i: number,
): void {
  const h = len * (0.34 + hash01(seed, i) * 0.1);
  const l = len * (0.9 + hash01(seed, i + 17) * 0.3) * dir;
  g.beginPath();
  g.moveTo(ak[0] - l * 0.3, ak[1] - h * 0.4);
  g.lineTo(ak[0] + l, ak[1] + h * 0.15);
  g.quadraticCurveTo(ak[0] + l * 0.9, ak[1] + h, ak[0] + l * 0.4, ak[1] + h);
  g.lineTo(ak[0] - l * 0.32, ak[1] + h);
  g.closePath();
  g.fill();
}

/** 몸통. 좌우 옆구리의 곡률을 다르게 줘서 실루엣이 대칭으로 닫히지 않게 한다. */
function torso(
  g: CanvasRenderingContext2D,
  shL: V2,
  shR: V2,
  hpR: V2,
  hpL: V2,
  seed: number,
): void {
  const bulgeR = 1 + jit(seed, 701, 0.35);
  const bulgeL = 1 + jit(seed, 702, 0.35);
  const midRX = (shR[0] + hpR[0]) / 2;
  const midRY = (shR[1] + hpR[1]) / 2;
  const midLX = (shL[0] + hpL[0]) / 2;
  const midLY = (shL[1] + hpL[1]) / 2;
  const cx = (shL[0] + shR[0] + hpL[0] + hpR[0]) / 4;
  const cy = (shL[1] + shR[1] + hpL[1] + hpR[1]) / 4;

  g.beginPath();
  g.moveTo(shL[0], shL[1]);
  g.lineTo(shR[0], shR[1]);
  // 오른쪽 옆구리 — 바깥으로 밀어 근육/옷의 부피를 만든다.
  g.quadraticCurveTo(midRX + (midRX - cx) * 0.42 * bulgeR, midRY + (midRY - cy) * 0.2, hpR[0], hpR[1]);
  g.lineTo(hpL[0], hpL[1]);
  // 왼쪽 옆구리 — 곡률이 다르다. 여기서 좌우 대칭이 깨진다.
  g.quadraticCurveTo(midLX + (midLX - cx) * 0.28 * bulgeL, midLY + (midLY - cy) * 0.34, shL[0], shL[1]);
  g.closePath();
  g.fill();
}

/** 머리 + 비대칭 머리 덩어리. 완벽한 원/윤곽선이 나오지 않도록 덩어리를 한쪽에 몰아 붙인다. */
function headShape(
  g: CanvasRenderingContext2D,
  c: V2,
  rx: number,
  ry: number,
  ang: number,
  hairMass: number,
  seed: number,
): void {
  g.save();
  g.translate(c[0], c[1]);
  g.rotate(ang);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, TAU);
  g.fill();

  if (hairMass > 0.01) {
    // 정수리 뒤쪽에 몰린 세 덩어리. 각도·크기가 전부 달라 실루엣이 한쪽으로 무겁다.
    const blobs: [number, number, number][] = [
      [-2.35, 0.86, 0.72],
      [-1.75, 0.95, 0.56],
      [-2.95, 0.7, 0.44],
    ];
    for (let i = 0; i < blobs.length; i++) {
      const [a, d, s] = blobs[i]!;
      const aa = a + jit(seed, i + 811, 0.22);
      const dd = d * (1 + jit(seed, i + 821, 0.14));
      const r = rx * s * (0.7 + hairMass * 0.9) * (1 + jit(seed, i + 831, 0.16));
      g.beginPath();
      g.ellipse(Math.cos(aa) * rx * dd, Math.sin(aa) * ry * dd, r, r * 0.86, aa, 0, TAU);
      g.fill();
    }
  }
  g.restore();
}

// ── 관절 좌표 조회 ─────────────────────────────────────────────────────────

export type FigurePart =
  | 'handL'
  | 'handR'
  | 'elbowL'
  | 'elbowR'
  | 'head'
  | 'hip'
  | 'neck'
  | 'footL'
  | 'footR';

/**
 * 포즈의 특정 부위가 `drawFigure(x, y, height, …)` 기준으로 어디에 찍히는지.
 * 반환값은 `height` 곱하기 전 화면 좌표 오프셋(y 는 위가 음수).
 *
 * 손 클로즈업처럼 **관절 하나를 화면 특정 지점에 맞춰야** 하는 컷에서 쓴다.
 */
export function figureAnchor(pose: Pose, part: FigurePart): V2 {
  const j = build(pose);
  const table: Record<FigurePart, V2> = {
    handL: j.wriL,
    handR: j.wriR,
    elbowL: j.elbL,
    elbowR: j.elbR,
    head: j.head,
    neck: j.neck,
    hip: j.hip,
    footL: j.ankL,
    footR: j.ankR,
  };
  const p = table[part];
  return [p[0], -(p[1] - j.ground)];
}

// ── 실루엣 합성용 스크래치 ─────────────────────────────────────────────────

/**
 * 실루엣 합성을 받아 줄 여벌 캔버스. 화면 캔버스와 **같은 크기**라 좌표를 그대로 쓸 수 있고,
 * 매번 새로 만들지 않고 재사용한다.
 *
 * 브라우저가 아니면(테스트·SSR) `null` 이다 — 그 경우 호출부는 부위별 칠하기로 되돌아간다.
 */
interface Scratch {
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

let scratch: Scratch | null = null;

function scratchFor(target: CanvasRenderingContext2D): Scratch | null {
  if (typeof document === 'undefined') return null;
  const w = target.canvas.width;
  const h = target.canvas.height;
  if (w <= 0 || h <= 0) return null;

  if (scratch === null) {
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    if (g === null) return null;
    scratch = { cv, g };
  }
  if (scratch.cv.width !== w || scratch.cv.height !== h) {
    scratch.cv.width = w;
    scratch.cv.height = h;
  }
  return scratch;
}

// ── 본체 ───────────────────────────────────────────────────────────────────

/**
 * 사람 1구를 그린다. `(x, y)` 는 **바닥에 닿는 점**, `height` 는 서 있을 때의 전신 키(px).
 * 앉거나 누운 포즈는 자동으로 더 낮고 넓게 그려진다.
 *
 * `opts.style === 'silhouette'` 이고 반투명이면 여벌 캔버스에 **불투명하게** 한 번 그린 뒤
 * 통째로 알파를 먹여 얹는다. 부위별로 칠하면 마디가 겹치는 자리마다 색이 두 번 얹혀
 * 관절·분절 경계가 드러나기 때문이다(= 해부 모형처럼 보이는 원인).
 */
export function drawFigure(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  pose: Pose,
  opts: FigureOpts,
): void {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.004 || height <= 0) return;

  // 불투명하면 겹쳐도 색이 달라지지 않는다 — 합성 비용을 들일 이유가 없다.
  if (opts.style === 'silhouette' && alpha < 0.995) {
    const s = scratchFor(g);
    if (s !== null) {
      // 어떤 포즈든 넉넉히 감싸는 상자. 누운 자세가 가로로 가장 넓고, 발 쐐기가 바닥 아래로 조금 나간다.
      const x0 = Math.max(0, Math.floor(x - height * 0.95));
      const y0 = Math.max(0, Math.floor(y - height * 1.3));
      const x1 = Math.min(s.cv.width, Math.ceil(x + height * 0.95));
      const y1 = Math.min(s.cv.height, Math.ceil(y + height * 0.25));
      if (x1 <= x0 || y1 <= y0) return;

      s.g.clearRect(x0, y0, x1 - x0, y1 - y0);
      paintFigure(s.g, x, y, height, pose, opts, 1);

      g.save();
      g.globalAlpha = alpha;
      // 원본/대상 사각형이 같아 확대·축소가 없다. 화면 컨텍스트의 평행이동(페이지 넘김)만 얹힌다.
      g.drawImage(s.cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      g.restore();
      return;
    }
  }

  paintFigure(g, x, y, height, pose, opts, alpha);
}

/** 부위를 순서대로 칠한다. 합성 전략은 `drawFigure` 가 정하고, 여기는 그림만 그린다. */
function paintFigure(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  pose: Pose,
  opts: FigureOpts,
  alpha: number,
): void {
  const j = build(pose);
  const f = opts.flip === true ? -1 : 1;
  const seed = opts.inkSeed | 0;
  const P = (v: V2): V2 => [x + v[0] * height * f, y - (v[1] - j.ground) * height];

  const nk = P(j.neck);
  const hd = P(j.head);
  const shL = P(j.shL);
  const shR = P(j.shR);
  const hpL = P(j.hpL);
  const hpR = P(j.hpR);
  const elL = P(j.elbL);
  const wrL = P(j.wriL);
  const elR = P(j.elbR);
  const wrR = P(j.wriR);
  const knL = P(j.kneeL);
  const akL = P(j.ankL);
  const knR = P(j.kneeR);
  const akR = P(j.ankR);

  const u = height;
  // 팔다리 굵기 배율. 생략하면 1 이라 기존 호출부의 그림은 한 픽셀도 달라지지 않는다.
  const bk = opts.bulk ?? 1;
  // 화면은 y 가 아래로 자라므로 로컬 회전이 뒤집힌다. 반전 시엔 한 번 더 뒤집혀 원래대로 온다.
  const ha = f === 1 ? -j.headAng : j.headAng;
  // 발끝 방향: 몸이 향한 쪽으로 눕힌다.
  const toeDir = f;

  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = opts.color;

  // 먼 쪽(L) 팔다리 → 몸통 → 가까운 쪽(R) 팔다리 순. 이 순서가 얕은 깊이감을 만든다.
  bone(g, hpL, knL, u * 0.082 * bk, u * 0.06 * bk, seed, 1);
  bone(g, knL, akL, u * 0.058 * bk, u * 0.034 * bk, seed, 2);
  foot(g, akL, u * 0.058 * bk, toeDir, seed, 3);
  bone(g, shL, elL, u * 0.056 * bk, u * 0.042 * bk, seed, 4);
  bone(g, elL, wrL, u * 0.042 * bk, u * 0.026 * bk, seed, 5);
  hand(g, elL, wrL, u * 0.026 * bk, seed, 6);

  torso(g, shL, shR, hpR, hpL, seed);

  // 승모근. 이게 없으면 머리가 막대기 목 위에 얹힌 것처럼 보인다.
  g.save();
  g.translate(nk[0], nk[1]);
  g.rotate(Math.atan2(shR[1] - shL[1], shR[0] - shL[0]));
  g.beginPath();
  g.ellipse(
    0,
    u * 0.012,
    u * SH_HALF * (pose.shoulderScale ?? 1) * 0.78,
    u * 0.046 * bk,
    0,
    0,
    TAU,
  );
  g.fill();
  g.restore();

  // 옷자락: 한쪽 골반에만 붙는 덩어리. 완벽한 윤곽선을 깨는 담당.
  // 골반 밖으로 크게 튀어나오면 옷이 아니라 혹으로 읽히므로, 반지름을 골반 반폭 수준으로
  // 묶고 위치도 안쪽으로 당겨 엉덩이 라인에 얹히게 한다.
  const flare = u * 0.042 * (0.78 + hash01(seed, 903) * 0.44);
  g.beginPath();
  g.ellipse(
    hpR[0] + (hpR[0] - hpL[0]) * 0.16,
    hpR[1] + flare * 0.4,
    flare,
    flare * 0.72,
    jit(seed, 904, 0.6),
    0,
    TAU,
  );
  g.fill();

  bone(g, hpR, knR, u * 0.088 * bk, u * 0.064 * bk, seed, 7);
  bone(g, knR, akR, u * 0.062 * bk, u * 0.036 * bk, seed, 8);
  foot(g, akR, u * 0.062 * bk, toeDir, seed, 9);
  bone(g, shR, elR, u * 0.06 * bk, u * 0.045 * bk, seed, 10);
  bone(g, elR, wrR, u * 0.045 * bk, u * 0.028 * bk, seed, 11);
  hand(g, elR, wrR, u * 0.028 * bk, seed, 12);

  bone(g, nk, hd, u * 0.05 * bk, u * 0.046 * bk, seed, 13);
  headShape(g, hd, u * HEAD_RX, u * HEAD_RY, ha, pose.hairMass, seed);

  // 얼굴. 실루엣은 앞뒤가 똑같이 생겼으므로, 향한 쪽 머리에 어두운 반점 하나로
  // "이쪽이 앞"을 못박는다. 뒤를 보는 인물은 이 값이 0 이라 뒤통수 덩어리만 남는다.
  const faceShade = opts.faceShade ?? 0;
  if (faceShade > 0.02 && opts.faceColor !== undefined) {
    g.save();
    g.globalAlpha = alpha * faceShade;
    g.fillStyle = opts.faceColor;
    g.translate(hd[0], hd[1]);
    g.rotate(ha);
    g.beginPath();
    // 앞(+x, 반전 시 −x)·아래(눈~입 높이)로 치우친 작은 타원.
    g.ellipse(u * HEAD_RX * 0.42 * f, u * HEAD_RY * 0.2, u * HEAD_RX * 0.5, u * HEAD_RY * 0.44, 0, 0, TAU);
    g.fill();
    g.restore();
    g.fillStyle = opts.color;
  }

  // 림라이트. 위에서 오는 빛만 받는다 — 몸을 가로지르는 선을 그으면 어깨띠로 읽힌다.
  if (opts.outline !== undefined) {
    g.globalAlpha = alpha * 0.55;
    g.strokeStyle = opts.outline;
    // 머리 타원에서 **화면 기준 위쪽 절반**만 훑는다. 로컬 각을 그냥 쓰면 누운 자세에서
    // 하이라이트가 옆구리로 돌아가 떠 있는 고리처럼 보인다.
    const rx = u * HEAD_RX * 1.05;
    const ry = u * HEAD_RY * 1.05;
    const psi = Math.atan2(ry * Math.cos(ha), rx * Math.sin(ha));
    const arc: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = psi + Math.PI / 2 + (Math.PI * i) / 10;
      const lx = Math.cos(a) * rx;
      const ly = Math.sin(a) * ry;
      arc.push([
        hd[0] + lx * Math.cos(ha) - ly * Math.sin(ha),
        hd[1] + lx * Math.sin(ha) + ly * Math.cos(ha),
      ]);
    }
    inkStroke(g, arc, Math.max(1, u * 0.009), seed + 5);
    // 어깨 윗면. 몸을 가로지르는 선을 그으면 해부학이 아니라 '어깨띠'로 읽힌다.
    // 실루엣 모드에서는 뺀다 — 어깨 위를 지나는 선은 실루엣 **안쪽**에 떨어져서
    // 쇄골처럼 읽히고, 그게 잔상을 해부 모형으로 보이게 하는 나머지 절반이다.
    if (opts.style !== 'silhouette') {
      // 끝에서 끝까지 그으면 가슴을 가로지르는 밝은 막대가 되므로 목에서 70% 만 나간다.
      const k = 0.7;
      g.globalAlpha = alpha * 0.42;
      inkStroke(
        g,
        [
          [nk[0] + (shL[0] - nk[0]) * k, nk[1] + (shL[1] - nk[1]) * k],
          [nk[0], nk[1]],
          [nk[0] + (shR[0] - nk[0]) * k, nk[1] + (shR[1] - nk[1]) * k],
        ],
        Math.max(1, u * 0.008),
        seed + 6,
      );
    }
  }

  g.restore();
}

// ── 인게임 보행 ────────────────────────────────────────────────────────────
//
// 인트로는 손으로 고른 `POSES` 를 쓴다. 게임 본편은 매 프레임 자세가 달라져야 하므로
// 여기서 **계산해서** 만든다. 위 코드는 하나도 건드리지 않는다 — 아래는 전부 추가분이다.

/**
 * 다리가 한 번 교차하는 데 필요한 이동 거리(px).
 *
 * 위상을 프레임이 아니라 **이동 거리**로 재는 이유: 프레임 기반이면 멈춰 선 몸의
 * 다리가 계속 움직이고, 속도가 바뀌어도 보폭이 그대로라 발이 바닥에서 미끄러진다.
 */
export const STRIDE_PX = 14;

export interface GaitOpts {
  /** 이동 거리로 누적된 위상(라디안). `STRIDE_PX` 마다 π 씩 자란다. */
  phase: number;
  /** 0 = 걷기, 1 = 달리기. 보폭·기울기·팔 스윙이 함께 커진다. */
  run: number;
  /** 0 = 정지(선 자세), 1 = 전속. 정지하면 자세가 선 자세로 되돌아간다. */
  motion: number;
  /** 0 = 정면/후면(어깨가 다 보임), 1 = 완전 측면(어깨가 겹쳐 좁다). */
  turn: number;
  /** 뒤통수 덩어리. 뒤를 보는 인물일수록 크다. 생략하면 체형 기본값. */
  hairMass?: number;
  /** 경비 체형: 어깨가 넓고 골반이 두껍고 등이 곧다. */
  warden?: boolean;
}

/** 정지 상태의 플레이어. 한쪽 다리에 체중이 실린 콘트라포스토. */
const IDLE_PLAYER: Pose = {
  headTilt: -0.05,
  shoulderTilt: 0.06,
  lean: -0.02,
  armL: [0.12, 0.24],
  armR: [-0.1, -0.32],
  legL: [0.03, -0.04],
  legR: [0.11, -0.33],
  hairMass: 0.6,
};

/**
 * 정지 상태의 경비. 플레이어와 **체형과 태도가 모두** 달라야 한다:
 * 등이 뒤로 젖혀져 곧고, 다리를 벌려 버티고 섰고, 팔이 몸통에서 떨어져 있다.
 */
const IDLE_WARDEN: Pose = {
  headTilt: -0.09,
  shoulderTilt: 0.04,
  lean: -0.09,
  armL: [0.3, 0.32],
  armR: [-0.28, -0.42],
  // 다리를 벌려 버티고 선다. 좁게 세우면 굵은 허벅지가 겹쳐 한 덩어리로 뭉친다.
  legL: [0.25, -0.06],
  legR: [-0.27, -0.1],
  hairMass: 0.24,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix2(a: [number, number], b: [number, number], t: number): [number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    headTilt: lerp(a.headTilt, b.headTilt, t),
    shoulderTilt: lerp(a.shoulderTilt, b.shoulderTilt, t),
    lean: lerp(a.lean, b.lean, t),
    armL: mix2(a.armL, b.armL, t),
    armR: mix2(a.armR, b.armR, t),
    legL: mix2(a.legL, b.legL, t),
    legR: mix2(a.legR, b.legR, t),
    hairMass: lerp(a.hairMass, b.hairMass, t),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 무릎 굽힘. **앞으로 뻗은 다리는 거의 펴지고, 뒤로 간 다리는 무릎이 접혀 뒤꿈치가 든다.**
 * 이 비대칭이 없으면 다리가 컴퍼스처럼 벌어졌다 닫히기만 해서 사람이 아니라 가위로 보인다.
 */
function shinOf(thigh: number, run: number): number {
  return -Math.max(0.04, 0.36 + run * 0.2 - 0.85 * thigh);
}

/**
 * 한 프레임의 보행 자세.
 *
 * 좌우 다리는 위상이 π 어긋나지만 진폭·바이어스가 미세하게 달라 **어느 프레임에서도
 * 좌우가 같은 값이 되지 않는다** (모듈 서두의 대칭 금지 조건).
 */
export function gaitPose(o: GaitOpts): Pose {
  const warden = o.warden === true;
  const m = clamp01(o.motion);
  const run = clamp01(o.run);
  const idle = warden ? IDLE_WARDEN : IDLE_PLAYER;

  const s = Math.sin(o.phase);
  /**
   * 정면·후면에서는 보폭이 화면의 좌우가 아니라 **깊이 방향**으로 간다. 측면과 같은
   * 각도로 벌리면 다리를 찢고 걷는 것처럼 보이므로, 측면일수록 크게 흔든다.
   */
  const swing = 0.45 + 0.55 * clamp01(o.turn);
  // 달리면 보폭이 두 배 가까이 커진다 — 걷기와 눈에 띄게 달라야 하는 첫 번째 신호.
  const amp = ((warden ? 0.34 : 0.4) + run * 0.42) * swing;
  const thighL = amp * s;
  const thighR = -amp * s * 1.07 - 0.04;

  const walk: Pose = {
    headTilt: (warden ? -0.08 : 0.05) - 0.04 * s - run * 0.06,
    shoulderTilt: 0.08 - 0.13 * s,
    // 앞으로 기우는 정도. 달릴 때 크게 기우는 것이 두 번째 신호다.
    lean: (warden ? 0.03 : 0.09) + run * 0.3,
    // 팔은 같은 쪽 다리와 **반대로** 흔든다.
    armL: [-0.72 * thighL - 0.03, -0.34 - 0.3 * run],
    armR: [-0.7 * thighR + 0.05, -0.5 - 0.34 * run],
    legL: [thighL, shinOf(thighL, run)],
    legR: [thighR, shinOf(thighR, run)],
    hairMass: idle.hairMass,
  };

  const p = mixPose(idle, walk, m);
  p.hairMass = o.hairMass ?? idle.hairMass;
  // 측면을 보면 어깨가 겹쳐 좁아진다. 이 한 값이 4방향 구분의 절반을 담당한다.
  p.shoulderScale = (warden ? 1.34 : 1) * (1 - 0.48 * clamp01(o.turn));
  // 골반이 넓어야 굵은 두 다리 사이에 틈이 남는다. 좁으면 실루엣이 하나로 뭉쳐
  // 사람이 아니라 기둥이 된다.
  p.hipScale = warden ? 1.45 : 1;
  return p;
}

// ── 탑다운 인물 ────────────────────────────────────────────────────────────
//
// 위 코드는 전부 **입면도**(옆/앞에서 본 사람)다. 인트로 만화는 그게 맞다.
// 게임 본편은 **탑다운**이라 같은 그림을 쓰면 서 있는 사람을 바닥에 눕혀 붙인 꼴이 되고,
// 그래서 인물이 바닥에서 붕 떠 보인다. 아래는 그 시점 불일치를 없애는 별도 렌더다.
// 위 코드는 한 줄도 건드리지 않는다 — `POSES`·`drawFigure`·`figureAnchor` 는 그대로다.
//
// 작도법(아래에서 위로 겹쳐 그린다). 기준 단위 `size` = 몸통 긴 축(어깨 폭) 22px:
//   ① 그림자(렌더러가 먼저 깐다) → ② 다리 타원 2개(9×6) → ③ 몸통 타원(긴 축 22 = **옆**
//   방향, 짧은 축 15, 어두운 외곽선 1.5) → ④ 팔 원 2개(지름 7, 몸통 긴 축 양 끝, 반대 위상)
//   → ⑤ 머리 원(지름 13, 앞으로 3px, 몸통보다 밝게) → ⑥ 머리카락(머리 뒤쪽 절반, 어둡게)
//   → ⑦ 코(앞쪽 가장자리의 작은 돌출).
//
// 이 그림이 사람으로 읽히는 조건은 **크기 위계 하나**다: 머리 13 < 몸통 짧은 축 15 <
// 몸통 긴 축 22. 머리가 몸통보다 작고 몸통 위에 겹쳐야 하고, 어깨는 진행 방향에
// **수직으로** 넓어야 한다. 그 비례가 무너지면 즉시 해파리·달팽이 덩어리가 된다.
// 얼굴은 그리지 않는다. 방향은 **어깨축 + 머리 오프셋 + 머리카락 + 코**가 말한다.
//
// 좌표계: `(x, y)` 는 인물이 딛고 선 바닥의 중심. 캔버스를 `angle` 만큼 돌린 뒤
// **로컬 +x 가 인물이 향한 방향**이 된다. 그래서 방향 전환은 좌우 반전이 아니라
// 진짜 회전이고, 64단계 facing 이 전부 다른 그림이 된다.

/** 탑다운 인물 한 구의 자세. 전부 렌더 전용 값이라 시뮬과 무관하다. */
export interface TopPose {
  /** 어깨축 회전(rad). 위에서 본 걷기의 **주된** 움직임이 이거다. */
  shoulderTwist: number;
  /** 골반 회전(rad). 어깨와 반대로 돈다(콘트라포스토의 탑다운 판). */
  hipTwist: number;
  /** 왼팔이 앞으로 나간 정도(-1..1). 진폭이 달라 `armR` 과 같은 값이 되지 않는다. */
  armL: number;
  armR: number;
  /**
   * 진행 방향 쏠림(-1..1, 양수 = 앞). 상체와 머리만 밀리고 **그림자는 따라가지 않는다** —
   * 그 어긋남이 관성으로 읽혀서, 즉시 서고 즉시 출발하는 시뮬 위에서도 로봇으로 안 보인다.
   */
  lean: number;
  /** 발끝이 앞뒤로 나온 정도(-1..1). 좌우가 반대다. */
  footL: number;
  footR: number;
  /** 머리 덩어리 0..1. 클수록 뒤통수가 무거워진다. */
  hairMass: number;
  /** 몸통 긴 축(어깨) 배율(기본 1). 체형표는 `TOP_BUILD`. */
  shoulderScale?: number;
  /**
   * 머리 지름 배율(기본 1). 몸통과 **따로** 두는 이유: 머리가 몸통에 비례해 커지면
   * 큰 사람이 아니라 가까이 있는 사람이 된다. SENTRY 는 몸통 1.27배에 머리 1.08배다.
   */
  headScale?: number;
  /**
   * 몸통 **짧은 축**(앞뒤 두께) 배율(기본 1). 긴 축과 따로 두는 것이 탑다운에서
   * 체형을 가르는 가장 큰 손잡이다: 이 값이 1 을 크게 넘으면 몸통 타원의 장축이
   * **진행 방향으로 돌아누워** 다트(빠른 인상)가 되고, 1 밑으로 내리면 진행 방향에
   * 수직인 납작한 판(벽 같은 인상)이 된다.
   */
  girthScale?: number;
  /** 머리가 앞으로 나가는 거리 배율(기본 1). 크면 목이 뻗은 인상, 작으면 어깨에 파묻힌 인상. */
  headFwdScale?: number;
  /** 다리 타원 크기 배율(기본 1). 0.02 이하면 다리를 아예 그리지 않는다. */
  legMass?: number;
  /**
   * 거치대(삼각대) 강도 0..1. 0 초과면 다리 대신 몸통 밑에 **세 갈래 지지대**를 깐다.
   * 걷는 다리가 사라지고 고정 구조물이 남으므로, 멀리서도 "저건 이동하지 않는다"가
   * 실루엣만으로 읽힌다.
   */
  mount?: number;
  /**
   * 널브러진 정도 0..1. 1 이면 머리 원이 몸통 타원 **옆으로** 빠지고 다리가 벌어진다 —
   * 위에서 본 사람이 서 있지 않다는 것을 그 배치 하나로 말한다(시체 전용).
   */
  sprawl?: number;
  /**
   * 참이면 사람이 아니라 **네발짐승**으로 그린다. 위 필드들의 뜻이 그대로 바뀐다 —
   * `armL`/`armR` 은 앞다리, `footL`/`footR` 은 뒷다리, `shoulderScale` 은 몸통 **폭**,
   * `girthScale` 은 폭 대비 **길이 비**다. 자세한 것은 `TopBuild.quad`.
   */
  quad?: boolean;
  /** 꼬리 좌우 흔들림(-1..1). `quad` 전용. 정지하면 0 으로 잦아든다. */
  tail?: number;
  /** 갤럽 신축(-1..1, 양수 = 앞뒤로 늘어남). `quad` 전용. */
  stretch?: number;
}

// ── 체형표 ─────────────────────────────────────────────────────────────────
//
// **유형 구분은 형태로만 한다.** 색은 상태(PATROL/SUSPICIOUS/CHASE)가 이미 쓰고 있어서,
// 유형까지 색으로 나누면 "지금 위험한가"라는 더 급한 정보가 뭉개진다. 그래서 아래 표는
// 전부 **치수**다 — 어깨 폭, 앞뒤 두께, 기울기, 다리 유무.
//
// 탑다운에서 한눈에 갈리는 축은 두 개뿐이다:
//   ① 몸통 타원의 **장축이 어디를 향하는가** (옆 = 어깨형 / 앞 = 다트형)
//   ② 그 타원이 **얼마나 큰가**
// 그래서 `shoulder`(옆)와 `girth`(앞뒤)를 따로 두고, 유형마다 둘의 대소를 뒤집는다.

/** 한 유형의 체형 상수. 전부 기준 단위 `size` 에 곱해지는 배율이거나 진폭이다. */
export interface TopBuild {
  /** 몸통 긴 축(어깨, 진행 방향에 **수직**) 배율. */
  shoulder: number;
  /** 머리 지름 배율. */
  head: number;
  /** 몸통 짧은 축(앞뒤 두께) 배율. `shoulder` 를 넘어서면 장축이 진행 방향으로 돌아눕는다. */
  girth: number;
  /** 머리 전방 오프셋 배율. */
  headFwd: number;
  /** 걷기 상체 회전 진폭(rad). 크면 경쾌하고 작으면 육중하다. */
  twistAmp: number;
  /** 달릴 때 상체 회전에 더해지는 진폭(rad). */
  runTwist: number;
  /** 팔·발 스윙 진폭 배율. */
  swing: number;
  /** 이동 중 전경(前傾) 계수. `motion` 에 비례해 걸린다. */
  leanRun: number;
  /** **상시** 전경. 서 있어도 기울어 있는 정도 — 정지 중에도 "빠른 놈"으로 읽히게 한다. */
  leanBias: number;
  /** 다리 크기 배율. */
  legs: number;
  /** 거치대 강도 0..1. 0 초과면 다리 대신 세 갈래 지지대를 그린다. */
  mount: number;
  /** 머리카락/후두부 덩어리 기본값. */
  hair: number;
  /**
   * 참이면 **네발짐승 작도법**으로 그린다(사람 작도법과 코드 경로가 아예 갈린다).
   *
   * 위에서 내려다볼 때 사람과 짐승을 가르는 것은 색도 크기도 아니고 **몸통 타원의
   * 장축 방향** 하나다: 사람은 어깨가 진행 방향에 **수직**이고(장축 = θ+90°),
   * 짐승은 몸이 진행 방향과 **평행**하다(장축 = θ). 그래서 이 플래그가 켜지면
   * 아래 두 필드의 뜻도 함께 바뀐다 — 안 그러면 "어깨 폭"이라는 이름으로 몸 길이를
   * 재게 되어 표를 읽는 사람이 반드시 틀린다:
   *   `shoulder` → 몸통 **폭**(진행 방향에 수직) 배율
   *   `girth`    → 폭 대비 **길이** 비(2 면 몸통이 폭의 두 배로 길다)
   * `head` 는 그대로 머리 지름 배율(기준 13px), `headFwd` 는 쓰지 않는다 — 머리는
   * 몸통 앞 끝에 붙는 것이 작도법에 박혀 있다.
   */
  quad?: boolean;
}

/**
 * 유형별 체형. 키는 렌더 전용 문자열이며 시뮬 타입을 import 하지 않는다 —
 * 이 파일은 그리는 법만 알고 게임 규칙은 모른다. 매핑은 렌더러가 한다.
 *
 * `SENTRY` 는 **기준선이라 예전 경비 값(어깨 1.27 / 머리 1.08 / 회전 0.13)과 정확히
 * 같다.** 여기를 건드리면 "SENTRY 는 현재 모습 유지"라는 전제가 깨진다.
 */
export const TOP_BUILD: Record<
  'PLAYER' | 'SENTRY' | 'HOUND' | 'BRUTE' | 'WATCHER',
  TopBuild
> = {
  // 플레이어·잔상. 기준 작도법 그대로(몸통 22×15, 머리 13).
  PLAYER: {
    shoulder: 1,
    head: 1,
    girth: 1,
    headFwd: 1,
    twistAmp: 0.17,
    runTwist: 0.16,
    swing: 1,
    leanRun: 0.12,
    leanBias: 0,
    legs: 1,
    mount: 0,
    hair: 0.6,
  },
  // 기준 경비. 어깨가 넓고 상체가 덜 흔들린다.
  SENTRY: {
    shoulder: 1.27,
    head: 1.08,
    girth: 1,
    headFwd: 1,
    twistAmp: 0.13,
    runTwist: 0,
    swing: 1,
    leanRun: 0.06,
    leanBias: 0,
    legs: 1,
    mount: 0,
    hair: 0.28,
  },
  // 사냥개. **유일한 네발 유형**이다(`quad`). 사람 셋(SENTRY/BRUTE/WATCHER)은 전부
  // 어깨가 진행 방향에 수직인데 이놈만 몸이 진행 방향과 나란해서, 실루엣만 봐도 —
  // 색도 라벨도 없이 — 한눈에 갈린다. 다트형 사람으로 흉내내던 예전 값(girth 2.15,
  // headFwd 3.8)은 어차피 "앞뒤로 두꺼운 사람"이 한계였다.
  //
  // 몸통 폭 14 × 길이 28(= 폭의 2배). 사람 기준(어깨 22 × 앞뒤 15)과 **장단이 반대**다.
  HOUND: {
    quad: true,
    // 몸통 **폭** 14px = u × (14/22). 사람의 "어깨 폭"과 같은 자리를 쓰지만 뜻이 다르다.
    shoulder: 14 / 22,
    // 폭 대비 **길이** 2배 → 몸통 28×14. 1.5 밑으로 내리면 다시 통통한 사람이 된다.
    girth: 2,
    // 머리 지름 11px(= 13 × 11/13). 몸통 폭 14 보다 **작아야** 몸 위에 얹힌 머리로 읽힌다.
    head: 11 / 13,
    // 네발 작도법은 머리를 몸통 앞 끝에 붙이므로 이 값을 쓰지 않는다(1 로 둔다).
    headFwd: 1,
    // 개는 사람처럼 상체가 비틀리지 않는다 — 대신 몸 전체가 좌우로 살짝 물결친다.
    twistAmp: 0.1,
    runTwist: 0.09,
    swing: 1.3,
    leanRun: 0.18,
    leanBias: 0.28,
    legs: 1,
    mount: 0,
    hair: 0.34,
  },
  // 중장비. 어깨 1.52 에 앞뒤는 오히려 **줄여**(0.86) 진행 방향에 수직인 납작한 판을
  // 만든다. 폭은 압도적인데 두께는 얇아서, "옆으로는 못 지나가지만 좁은 길엔 못 들어온다"가
  // 실루엣 하나로 읽힌다. 회전(0.06)과 스윙(0.7)을 죽여 무겁게 걷는다.
  BRUTE: {
    shoulder: 1.52,
    head: 1.02,
    girth: 0.86,
    headFwd: 0.55,
    twistAmp: 0.06,
    runTwist: 0,
    swing: 0.7,
    leanRun: 0.04,
    leanBias: 0,
    legs: 1.15,
    mount: 0,
    hair: 0.22,
  },
  // 감시탑. **다리를 지우고 삼각 거치대를 깐다** — 걷는 다리가 없다는 것이 이 유형의
  // 정보 전부다(이 자리에서 움직이지 않는다). 대신 머리(센서)를 키워 시선을 그리로 보낸다.
  WATCHER: {
    shoulder: 1.05,
    head: 1.16,
    girth: 0.95,
    headFwd: 1.15,
    twistAmp: 0.015,
    runTwist: 0,
    swing: 0.14,
    leanRun: 0.02,
    leanBias: 0,
    // 다리를 **0 으로 지운다.** 작게 남기면 거치대와 겹쳐 실루엣이 지저분해지고,
    // "안 움직인다"는 정보가 절반만 전달된다.
    legs: 0,
    mount: 1,
    hair: 0.2,
  },
};

/** `TOP_BUILD` 의 키. */
export type TopBuildName = keyof typeof TOP_BUILD;

export interface TopGaitOpts {
  /** 이동 거리로 누적된 위상(라디안). `STRIDE_PX` 마다 π 씩 자란다. */
  phase: number;
  /** 0 = 걷기, 1 = 달리기. */
  run: number;
  /** 0 = 정지, 1 = 전속. */
  motion: number;
  /** 가감속 쏠림(-1..1). 렌더러가 `motion` 의 지연 사본과의 차이로 만든다. */
  lean: number;
  hairMass?: number;
  /** 체형(기본 `PLAYER`). */
  build?: TopBuildName;
}

/**
 * 한 프레임의 탑다운 자세.
 *
 * 좌우 팔·발은 위상이 π 어긋나는 데다 진폭·바이어스가 미세하게 달라 **어느 프레임에서도
 * 좌우가 같은 값이 되지 않는다** — 모듈 서두의 대칭 금지 조건은 탑다운에서도 그대로다.
 */
export function topPose(o: TopGaitOpts): TopPose {
  const b = TOP_BUILD[o.build ?? 'PLAYER'];
  const m = clamp01(o.motion);
  const run = clamp01(o.run);
  const s = Math.sin(o.phase);
  // 덩치가 클수록 상체가 덜 흔들린다(BRUTE 0.06). 가벼운 쪽은 달릴수록 크게 돈다.
  const twist = (b.twistAmp + run * b.runTwist) * m * s;
  const sw = b.swing;

  const p: TopPose = {
    shoulderTwist: twist,
    hipTwist: -twist * 0.6,
    // 좌우 진폭·바이어스가 다른 것은 체형과 무관한 **대칭 금지** 규칙이라 그대로 둔다.
    armL: (0.52 + run * 0.5) * m * s * sw + 0.07,
    armR: -(0.56 + run * 0.55) * m * s * sw - 0.05,
    // 가감속 쏠림 + 이동 중 전경 + **상시 전경**. 마지막 항만 `m` 이 안 걸려서,
    // HOUND 는 멈춰 서 있어도 앞으로 기울어 있다.
    lean: o.lean + (b.leanRun + run * 0.26 * sw) * m + b.leanBias,
    footL: (0.55 + run * 0.45) * m * s * sw,
    footR: -(0.58 + run * 0.45) * m * s * sw,
    hairMass: o.hairMass ?? b.hair,
    shoulderScale: b.shoulder,
    headScale: b.head,
    girthScale: b.girth,
    headFwdScale: b.headFwd,
    legMass: b.legs,
    mount: b.mount,
  };

  if (b.quad === true) {
    p.quad = true;
    // **트롯**(대각선 짝). 뒷다리의 부호만 뒤집으면 앞-좌(armL, +)와 뒤-우(footR, +)가
    // 함께 나가고 그 반대짝이 뒤로 간다 — 네발짐승이 실제로 걷는 순서이고, 같은 쪽
    // 앞뒤가 같이 나가면(패이스) 낙타가 되어 개로 안 보인다.
    p.footL = -p.footL;
    p.footR = -p.footR;
    // 꼬리는 보폭의 **두 배** 주기로 흔든다. 다리와 같은 주기면 꼬리가 다리의 연장으로
    // 읽히고, 그 순간 "뒤에 달린 별개의 것"이라는 신호가 사라진다.
    // 0.12 는 멈춰 있을 때도 남는 휨 — 완전히 곧은 꼬리는 막대기다.
    p.tail = Math.sin(o.phase * 2 + 0.7) * m * (0.55 + run * 0.45) + 0.12;
    // 갤럽 신축. 다리가 모이는 순간 줄고 뻗는 순간 늘어난다 → 꼬리와 같은 2배 주기.
    p.stretch = Math.cos(o.phase * 2) * m * (0.4 + run * 0.6);
  }

  return p;
}

export interface TopFigureOpts {
  color: string;
  alpha?: number;
  /** 코(앞쪽 돌출) 색. 방향을 못 박는 유일한 밝은 점이다. 없으면 몸 색을 쓴다. */
  outline?: string;
  /**
   * 실루엣 외곽선 색. **덩어리로 보이느냐 사람으로 보이느냐가 여기서 갈린다** —
   * 머리 원과 몸통 타원의 경계는 이 선이 있어야 24px 로 줄여도 살아남는다.
   * 없으면 몸 색을 크게 어둡게 한 값을 쓴다.
   */
  shade?: string;
  /** 결정론적 지터 시드. 같은 시드 = 매 프레임 같은 흔들림. */
  inkSeed: number;
  /**
   * 팔·다리 굵기 배율(기본 1). **머리·몸통에는 걸리지 않는다** — 그 셋의 비례가
   * 작도법 그 자체라 굵기 취향으로 흔들면 안 된다. 체격은 `shoulderScale`/`headScale` 담당.
   */
  bulk?: number;
  /**
   * `drawFigure` 와 같은 이유로 있다. 알파가 1 미만일 때 부위별로 칠하면 겹치는 자리마다
   * 색이 두 번 얹혀 경계가 드러난다. `'silhouette'` 은 불투명하게 한 번 그린 뒤
   * **통째로** 알파를 먹인다.
   */
  style?: 'anatomy' | 'silhouette';
}

/**
 * 위에서 내려다본 사람 1구.
 *
 * `(x, y)` = 바닥에 딛고 선 중심(= 충돌 AABB 의 중심), `size` = **몸통 긴 축(어깨 폭) px**
 * — 22 를 주면 위 작도법의 기준 치수(몸통 22×15, 머리 13, 팔 7)가 그대로 나온다.
 * `angle` = 인물이 향한 각(rad, 0 = +x, 시계방향). 그림자는 호출부가 먼저 깐다 —
 * 쏠림에 **따라가지 않아야** 하므로 이 함수 밖에 있어야 한다.
 */
export function drawTopFigure(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  pose: TopPose,
  opts: TopFigureOpts,
): void {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.004 || size <= 0) return;

  if (opts.style === 'silhouette' && alpha < 0.995) {
    const s = scratchFor(g);
    if (s !== null) {
      // 어깨 반폭 최대(1.28×0.5) + 팔 + 지터를 다 덮는 여유 반경.
      const r = size * 1.5;
      const x0 = Math.max(0, Math.floor(x - r));
      const y0 = Math.max(0, Math.floor(y - r));
      const x1 = Math.min(s.cv.width, Math.ceil(x + r));
      const y1 = Math.min(s.cv.height, Math.ceil(y + r));
      if (x1 <= x0 || y1 <= y0) return;

      s.g.clearRect(x0, y0, x1 - x0, y1 - y0);
      paintTopFigure(s.g, x, y, size, angle, pose, opts, 1);

      g.save();
      g.globalAlpha = alpha;
      // 원본/대상 사각형이 같아 확대·축소가 없다. 화면 컨텍스트의 평행이동(카메라)만 얹힌다.
      g.drawImage(s.cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      g.restore();
      return;
    }
  }

  paintTopFigure(g, x, y, size, angle, pose, opts, alpha);
}

/**
 * `#rrggbb` 를 `t`(0..1) 만큼 검정 쪽으로 민다. hex 가 아니면 그대로 돌려준다.
 *
 * 명도 위계를 **몸 색에서 파생**시키는 이유: 잔상 4색·경비 붉은색·시체 회색이 전부
 * 다른 색인데 호출부마다 밝기 단계를 손으로 적으면 어느 하나는 반드시 어긋난다.
 * 여기서 뽑으면 어떤 색을 넣어도 "머리 > 팔 > 몸통 > 다리 > 머리카락" 순서가 유지된다.
 */
function darken(hex: string, t: number): string {
  if (hex.charCodeAt(0) !== 35 || hex.length < 7) return hex;
  const k = 1 - t;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * k);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * k);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * k);
  return `rgb(${r},${g},${b})`;
}

/** `#rrggbb` 를 `t`(0..1) 만큼 흰색 쪽으로 민다. 코끝 하이라이트 전용. */
function lighten(hex: string, t: number): string {
  if (hex.charCodeAt(0) !== 35 || hex.length < 7) return hex;
  const up = (v: number): number => Math.round(v + (255 - v) * t);
  return `rgb(${up(parseInt(hex.slice(1, 3), 16))},${up(parseInt(hex.slice(3, 5), 16))},${up(
    parseInt(hex.slice(5, 7), 16),
  )})`;
}

/** 네발 유형의 치수. `u = 22` 에서 아래 주석의 px 값이 그대로 나온다. */
interface QuadDims {
  /** 몸통 짧은 축(좌우) 반경 → 폭 14. */
  halfW: number;
  /** 몸통 긴 축(**진행 방향**) 반경 → 길이 28. 사람과 90° 다른 축이 이것이다. */
  halfL: number;
  /** 머리 반지름 → 지름 11. */
  headR: number;
  /**
   * 머리 중심의 전방 거리 → 13.5. 몸통 앞 끝(14)보다 **안쪽**이라 머리가 몸에 얹힌다.
   * 앞으로 더 빼면(15) 머리가 몸에서 떨어져 나와 "몸통에 공을 붙인 것"으로 보인다 —
   * 개는 목이 짧아서 위에서 보면 머리가 어깨 위에 파묻혀 있다.
   */
  headCx: number;
  /** 주둥이가 머리 **가장자리 밖으로** 더 나가는 길이 → 6. */
  muzzle: number;
  /** 몸통 뒤 끝에서 꼬리 끝까지 → 12. */
  tailLen: number;
}

/**
 * 네발 치수를 한 곳에서만 정한다. 그리는 쪽(`paintTopDog`)과 피하는 쪽(렌더러의
 * 라벨·꺾쇠 반경)이 같은 수를 써야 하므로, 둘 다 이 함수를 통과한다.
 */
export function quadDims(u: number, shoulder: number, girth: number, head: number): QuadDims {
  const halfW = u * 0.5 * shoulder;
  const halfL = halfW * girth;
  return {
    halfW,
    halfL,
    headR: u * (13 / 22) * 0.5 * head,
    headCx: halfL - u * (0.5 / 22),
    muzzle: u * (6 / 22),
    tailLen: u * (12 / 22),
  };
}

/**
 * 네발 실루엣의 최대 반경(px) = 코 끝과 꼬리 끝 중 먼 쪽.
 * 라벨·꺾쇠가 몸에 깔리지 않으려면 렌더러가 이 값을 알아야 한다.
 */
export function topQuadReach(u: number, b: TopBuild): number {
  const d = quadDims(u, b.shoulder, b.girth, b.head);
  // 마지막 항은 관성 쏠림(`bodyX`, 최대 0.06u)이 몸 전체를 앞으로 미는 양이다.
  // 빼먹으면 출발 순간에만 라벨이 코에 닿는다 — 잡기 어려운 종류의 어긋남이라 여기서 더한다.
  return Math.max(d.headCx + d.headR + d.muzzle, d.halfL + d.tailLen) + u * 0.06;
}

function paintTopFigure(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  pose: TopPose,
  opts: TopFigureOpts,
  alpha: number,
): void {
  // 네발은 작도법 자체가 다르다. 사람 코드에 분기를 심어 늘리면 두 그림 다 망가지므로
  // 여기서 통째로 갈라진다 — 아래 사람 경로는 한 픽셀도 달라지지 않는다.
  if (pose.quad === true) {
    paintTopDog(g, x, y, size, angle, pose, opts, alpha);
    return;
  }

  const u = size;
  const seed = opts.inkSeed | 0;
  const bk = opts.bulk ?? 1;
  const sc = pose.shoulderScale ?? 1;
  const sprawl = clamp01(pose.sprawl ?? 0);
  const lean = pose.lean < -1 ? -1 : pose.lean > 1 ? 1 : pose.lean;

  // ── 크기 위계 ──
  // `u = 22` 에서 머리 지름 13 < 몸통 짧은 축 15 < 몸통 긴 축 22 가 정확히 나온다.
  // 이 세 수의 대소 관계가 "사람"의 전부다. 굵기 배율(`bulk`)은 여기 걸리지 않는다.
  /** 몸통 긴 축 반지름 → 지름 22 (경비 28). 긴 축은 **옆**(θ+90°) 방향이다. */
  const torsoLongR = u * 0.5 * sc;
  /**
   * 몸통 짧은 축 반지름 → 지름 15 (SENTRY 19). 짧은 축이 진행 방향이다.
   * `girthScale` 이 이 축만 늘리므로, 1.47(=22/15) 을 넘기는 순간 타원의 장축이
   * 옆에서 **앞으로** 돌아눕는다 — HOUND(1.8)가 다트로 읽히는 원리가 이것 하나다.
   */
  const torsoShortR = u * (15 / 22) * 0.5 * sc * (pose.girthScale ?? 1);
  /** 머리 반지름 → 지름 13 (경비 14). 몸통 짧은 축보다 **작아야** 위계가 선다. */
  const headR = u * (13 / 22) * 0.5 * (pose.headScale ?? 1);
  // 굵기 배율은 **절반만** 먹인다. 팔 원이 커질수록 어깨 양 끝의 두 덩어리가 머리보다
  // 눈에 띄어, 인물이 사람이 아니라 얼굴 무늬(눈 두 개)처럼 읽히기 시작한다.
  const lb = 1 + (bk - 1) * 0.5;
  /** 팔 반지름 → 지름 7. */
  const armR = u * (7 / 22) * 0.5 * lb;
  /** 다리 타원: 앞뒤 9 × 좌우 6. */
  const legM = pose.legMass ?? 1;
  const legRx = u * (9 / 22) * 0.5 * lb * legM;
  const legRy = u * (6 / 22) * 0.5 * lb * legM;
  /** 머리가 몸통 중심에서 앞(θ)으로 나가는 거리 = 3px. */
  const headFwd = u * (3 / 22) * (pose.headFwdScale ?? 1);
  /** 거치대 강도. 0 초과면 다리 대신 세 갈래 지지대를 깐다. */
  const mount = clamp01(pose.mount ?? 0);
  /** 팔 앞뒤 스윙 진폭 = ±3px. */
  const swing = u * (3 / 22);
  /** 외곽선 굵기 = 1.5px. 배경과 실루엣을 끊는 유일한 장치라 1px 밑으로 못 내려간다. */
  const lw = Math.max(1, u * (1.5 / 22));

  // 명도 위계. 머리가 가장 밝고 아래로 갈수록 어둡다 — 그래야 머리가 몸통 **위에**
  // 얹힌 것으로 읽힌다. 몸 색을 그대로 쓰는 곳은 머리 하나뿐이다.
  const ink = opts.shade ?? darken(opts.color, 0.8);
  /** 머리는 몸 색보다 **더 밝다.** 흰 몸(I)은 이미 상한이라 그대로지만, 붉은 경비처럼
   * 중간 명도의 색은 이 한 단계가 있어야 머리 원이 몸통에서 떨어져 나온다. */
  const headFill = lighten(opts.color, 0.2);
  const torsoFill = darken(opts.color, 0.28);
  // 팔은 몸통보다 **어둡다**. 밝게 두면 어깨 양 끝의 원 두 개가 머리보다 눈에 띄어
  // 인물이 "덩어리에 붙은 흰 공 두 개"로 읽힌다 — 명도 위계가 뒤집히는 순간 사람이 사라진다.
  const armFill = darken(opts.color, 0.5);
  const legFill = darken(opts.color, 0.62);
  const hairFill = darken(opts.color, 0.56);

  /** 진행 방향 쏠림(렌더 전용 관성). 그림자는 이걸 따라가지 않는다. */
  const bodyX = lean * u * 0.12;

  const ct = Math.cos(pose.shoulderTwist);
  const stw = Math.sin(pose.shoulderTwist);
  /** 어깨 프레임 좌표 → 로컬 좌표. 어깨 회전은 몸통 중심을 축으로 돈다. */
  const tw = (px: number, py: number): V2 => [
    bodyX + px * ct - py * stw,
    px * stw + py * ct,
  ];

  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(angle);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = ink;
  g.lineWidth = lw;

  // ── ②a 거치대(WATCHER 전용) ──
  // 다리 대신 몸통 밑에 깔리는 **세 갈래 지지대**. 뒤로 하나, 앞 좌우로 둘 — 앞이
  // 벌어져 있어 시선 방향이 지지대 배치로도 한 번 더 읽힌다. 걷기 위상을 전혀 쓰지
  // 않으므로 이 다리는 **어느 프레임에서도 움직이지 않는다**: 그게 이 유형의 정보다.
  if (mount > 0.01) {
    // 2.2 배. 1.42 배로는 지지대가 몸통 타원 **밑에 깔려** 발 세 점만 떠 보였다 —
    // 다리가 몸 밖으로 확실히 뻗어야 삼각대라는 구조로 읽힌다.
    const legLen = torsoLongR * 2.2;
    g.save();
    // **회전을 되돌린다.** 삼각대는 월드에 고정이고 그 위의 상반신만 돌아간다 —
    // 다리까지 같이 돌면 "제자리에서 두리번거리는 기둥"이 아니라 "빙글 도는 사람"이 된다.
    g.rotate(-angle);
    g.strokeStyle = legFill;
    g.lineWidth = Math.max(1.5, u * (5.2 / 22));
    g.lineCap = 'round';
    for (const a of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * legLen * mount, Math.sin(a) * legLen * mount);
      g.stroke();
    }
    // 지지대 끝의 접지 발. 여기가 없으면 세 선이 별 무늬로 읽힌다.
    g.fillStyle = ink;
    for (const a of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
      g.beginPath();
      g.arc(
        Math.cos(a) * legLen * mount,
        Math.sin(a) * legLen * mount,
        Math.max(1, u * (2.6 / 22)),
        0,
        TAU,
      );
      g.fill();
    }
    g.restore();
  }

  // ── ② 다리 ──
  // 몸통 뒤쪽에 붙어 걷기 위상만큼 앞뒤로 교차한다. 대부분 몸통에 가려지고 앞뒤 끝만
  // 삐져나온다 — 위에서 본 다리는 그게 전부다. 길게 그리는 순간 입면도가 된다.
  // `legMass` 가 0 에 가까우면 아예 그리지 않는다(거치대가 그 자리를 대신한다).
  if (legM > 0.02) {
    g.save();
    g.rotate(pose.hipTwist);
    g.fillStyle = legFill;
    // 널브러지면 다리가 벌어진다. 서 있을 땐 몸통 폭 안이라 실루엣이 하나로 읽힌다.
    const splay = 1 + sprawl * 1.6;
    for (const [sd, st] of [
      [-1, pose.footL],
      [1, pose.footR],
    ] as const) {
      g.save();
      g.translate(
        bodyX - torsoShortR * 0.42 + st * u * 0.16,
        sd * torsoLongR * 0.34 * splay,
      );
      g.rotate(sd * (0.16 + sprawl * 0.55) + st * 0.2);
      g.beginPath();
      g.ellipse(0, 0, legRx, legRy, 0, 0, TAU);
      g.fill();
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  // ── ③ 몸통(어깨) ──
  // **긴 축이 옆(θ+90°) 방향이다.** 위에서 본 사람은 어깨가 진행 방향에 수직으로 넓고,
  // 그 방향성이 곧 "어디를 보고 있는가"의 가장 큰 단서다. 앞뒤로 두꺼워지는 순간
  // 방향이 사라지고 덩어리가 된다.
  g.save();
  g.translate(bodyX, 0);
  g.rotate(pose.shoulderTwist);
  g.fillStyle = torsoFill;
  g.beginPath();
  g.ellipse(0, 0, torsoShortR, torsoLongR, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.restore();

  // ── ④ 팔 ──
  // 몸통 긴 축 양 끝에 붙는 작은 원. 좌우가 **반대 위상**이라 같이 움직이지 않는다
  // (`pose.armL` / `pose.armR` 은 부호가 반대다 — 같이 흔들리면 즉시 로봇으로 읽힌다).
  g.fillStyle = armFill;
  for (const [sd, sw] of [
    [-1, pose.armL],
    [1, pose.armR],
  ] as const) {
    const p = tw(sw * swing, sd * torsoLongR);
    g.beginPath();
    g.arc(p[0], p[1], armR, 0, TAU);
    g.fill();
    g.stroke();
  }

  // ── ⑤ 머리 ──
  // 몸통 중심에서 앞으로 3px. 몸통보다 **작고 밝다** — 이 두 가지가 "몸통 위에 얹힌
  // 머리"를 만든다. 널브러지면(`sprawl`) 앞이 아니라 몸통 긴 축 바깥, 즉 **옆**으로 빠진다.
  const hDir = sprawl * 1.25;
  const hLen = headFwd + sprawl * (torsoLongR + headR * 0.55 - headFwd);
  const hx = bodyX + Math.cos(hDir) * hLen + lean * u * 0.05;
  const hy = Math.sin(hDir) * hLen + pose.shoulderTwist * u * 0.12;
  const hAng = pose.shoulderTwist * -0.25 + hDir;

  g.fillStyle = headFill;
  g.beginPath();
  g.arc(hx, hy, headR, 0, TAU);
  g.fill();
  g.stroke();

  // ── ⑥ 머리카락 ──
  // 머리 원의 **뒤쪽 절반**에 덮이는 비대칭 덩어리. 머리 원으로 클립하므로 실루엣이
  // 커지지 않는다 — 밖으로 번지면 정수리가 부어 다시 덩어리가 된다.
  if (pose.hairMass > 0.01) {
    g.save();
    g.beginPath();
    g.arc(hx, hy, headR, 0, TAU);
    g.clip();
    g.translate(hx, hy);
    g.rotate(hAng);
    g.fillStyle = hairFill;
    // **뒤쪽 절반까지만.** 앞쪽 경계가 머리 중심을 넘어오면 정수리가 통째로 어두워져
    // 머리가 몸통보다 어두운 원이 되고, 그 순간 명도 위계가 뒤집혀 사람이 사라진다.
    const m = clamp01(pose.hairMass);
    g.beginPath();
    g.ellipse(
      -headR * (0.6 + m * 0.04),
      headR * (0.12 + jit(seed, 951, 0.2)),
      headR * (0.48 + m * 0.1),
      headR * (0.66 + m * 0.24),
      jit(seed, 952, 0.5),
      0,
      TAU,
    );
    g.fill();
    g.restore();
  }

  // ── ⑦ 코 ──
  // 머리 앞쪽 가장자리에 반쯤 걸치는 아주 작은 돌출. 실루엣이 1~2px 튀어나오는 것이
  // 요점이고, 크게 키우면 부리가 되므로 여기서 더 늘리지 말 것.
  g.save();
  g.translate(hx, hy);
  g.rotate(hAng);
  g.fillStyle = opts.outline ?? lighten(opts.color, 0.5);
  g.lineWidth = lw * 0.7;
  g.beginPath();
  g.ellipse(headR * 0.86, 0, headR * 0.3, headR * 0.24, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.restore();

  g.restore();
}

// ── 탑다운 네발짐승 ─────────────────────────────────────────────────────────
//
// 위에서 내려다볼 때 **사람과 개를 가르는 결정적 차이는 몸의 방향**이다:
//   사람 — 어깨가 진행 방향에 **수직**으로 넓다(몸통 장축 = θ+90°, 22 × 15)
//   개   — 몸이 진행 방향과 **평행**하게 길다(몸통 장축 = θ, 28 × 14)
// 이 90° 하나가 절반이고, 나머지 절반이 주둥이(앞)·꼬리(뒤)·귀다.
//
// 작도 순서(뒤에서 앞으로 겹쳐 그린다). `u = 22` 기준 px:
//   ① 그림자(렌더러가 먼저 깐다. 긴 축이 θ) → ② 꼬리(길이 12, 이동 중 좌우로 흔들림)
//   → ③ 뒷다리 2개(7×5, 몸 뒤쪽 양옆) → ④ 몸통 타원(**28 × 14, 장축 = θ**, 외곽선 1.5)
//   → ⑤ 앞다리 2개(뒷다리와 반대 위상) → ⑥ 귀 2개(머리 뒤 양옆, 비대칭 삼각형)
//   → ⑦ 주둥이(머리 밖으로 +6 인 좁은 쐐기) → ⑧ 머리 원(지름 11, 몸통보다 밝게)
//   → ⑨ 코끝(가장 밝은 점 하나)
//
// 귀·주둥이를 머리 원 **앞에** 그리는 이유: 밑동이 머리에 덮여 실루엣 밖으로 나온
// 부분만 남는다. 뒤에 그리면 머리 안쪽을 가로지르는 외곽선이 드러나 얼굴 무늬가 된다.

/** -1..1 로 자른다. */
function clampPM1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function paintTopDog(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  pose: TopPose,
  opts: TopFigureOpts,
  alpha: number,
): void {
  const u = size;
  const seed = opts.inkSeed | 0;
  const bk = opts.bulk ?? 1;
  // 사람 경로와 같은 이유로 굵기 배율은 절반만 먹인다 — 다리 네 개가 커지면
  // 몸통보다 눈에 띄어 실루엣이 지네가 된다.
  const lb = 1 + (bk - 1) * 0.5;
  const d = quadDims(u, pose.shoulderScale ?? 1, pose.girthScale ?? 1, pose.headScale ?? 1);

  const lean = clampPM1(pose.lean);
  const stretch = clampPM1(pose.stretch ?? 0);
  const wag = clampPM1(pose.tail ?? 0);
  const legM = pose.legMass ?? 1;

  /** 다리 타원: 진행 방향 7 × 좌우 5. 다리도 앞뒤로 길다. */
  const legRx = u * (3.5 / 22) * lb * legM;
  const legRy = u * (2.5 / 22) * lb * legM;
  /** 다리가 앞뒤로 오가는 거리 ±3.4px. */
  const stride = u * (3.4 / 22);
  /** 외곽선 굵기 1.5px. 배경과 실루엣을 끊는 유일한 장치라 1px 밑으로 못 내려간다. */
  const lw = Math.max(1, u * (1.5 / 22));

  // 명도 위계는 사람과 같다(머리 > 몸통 > 꼬리 > 다리). 유형은 형태가 가르고
  // 색은 상태(PATROL/SUSPICIOUS/CHASE)가 쓰므로, 여기서 건드리는 것은 밝기뿐이다.
  const ink = opts.shade ?? darken(opts.color, 0.8);
  const headFill = lighten(opts.color, 0.2);
  const bodyFill = darken(opts.color, 0.28);
  const legFill = darken(opts.color, 0.62);
  const tailFill = darken(opts.color, 0.44);
  const earFill = darken(opts.color, 0.5);

  /** 진행 방향 쏠림(렌더 전용 관성). 그림자는 이걸 따라가지 않는다. */
  const bodyX = lean * u * 0.06;
  /**
   * 갤럽 신축. 늘어난 만큼 납작해진다(부피 보존) — 길이만 늘리면 몸이 고무줄로 보인다.
   * 정지하면 `stretch` 가 0 이라 신축도 멈춘다.
   */
  const sxL = 1 + stretch * 0.09;
  const syW = 1 - stretch * 0.05;
  const yaw = pose.shoulderTwist;
  const hipYaw = pose.hipTwist;

  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  // 여기부터 **로컬 +x 가 개가 향한 방향(θ)** 이다. 아래 좌표는 전부 그 기준.
  g.rotate(angle);
  g.translate(bodyX, 0);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = ink;
  g.lineWidth = lw;

  /** 다리 한 짝. `along` 은 몸통 긴 축 위의 위치(-1..1), `sw` 는 걷기 위상. */
  const paw = (sd: number, sw: number, along: number, rot: number): void => {
    g.save();
    g.rotate(rot);
    g.translate(d.halfL * along * sxL + sw * stride, sd * d.halfW * 0.86 * syW);
    // 발끝이 앞으로 나갈수록 바깥으로 살짝 돌아간다. 좌우가 같은 각이면 즉시 로봇이 된다.
    g.rotate(sd * 0.14 + sw * 0.22);
    g.beginPath();
    g.ellipse(0, 0, legRx, legRy, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();
  };

  // ── ② 꼬리 ──
  // 위에서 볼 때 가장 강력한 "개" 신호다. 몸 뒤 끝에서 θ **반대**로 뻗고, 이동 중에는
  // 좌우로 흔들린다(`pose.tail`). 두 마디로 끊어 중간을 휘게 한다 — 곧게 뻗으면 안테나다.
  // 밑동은 몸통 안에서 시작해 ④ 가 덮으므로 이음매가 보이지 않는다.
  g.fillStyle = tailFill;
  const tailBase: V2 = [-d.halfL * 0.92 * sxL, 0];
  const tailMid: V2 = [tailBase[0] - d.tailLen * 0.5, wag * d.tailLen * 0.26];
  const tailTip: V2 = [
    tailBase[0] - d.tailLen * 0.98,
    wag * d.tailLen * 0.62 + d.tailLen * 0.06,
  ];
  g.save();
  g.rotate(hipYaw);
  bone(g, tailBase, tailMid, u * (3.4 / 22) * lb, u * (2.2 / 22) * lb, seed, 41);
  bone(g, tailMid, tailTip, u * (2.2 / 22) * lb, u * (0.9 / 22) * lb, seed, 42);
  g.restore();

  // ── ③ 뒷다리 ──
  // 몸통 뒤쪽 양옆. 대부분 몸통에 가려지고 바깥 끝만 삐져나온다 — 위에서 본 다리는
  // 그게 전부다. 길게 그리는 순간 입면도가 된다.
  if (legM > 0.02) {
    g.fillStyle = legFill;
    paw(-1, pose.footL, -0.52, hipYaw);
    paw(1, pose.footR, -0.52, hipYaw);
  }

  // ── ④ 몸통 ──
  // **긴 축이 θ(로컬 +x) 방향이다.** 사람 경로의 `ellipse(0, 0, torsoShortR, torsoLongR)`
  // 와 반지름의 자리가 정확히 뒤바뀌어 있다 — 이 한 줄이 이 유형의 전부다.
  g.save();
  g.rotate(yaw);
  g.fillStyle = bodyFill;
  g.beginPath();
  g.ellipse(0, 0, d.halfL * sxL, d.halfW * syW, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.restore();

  // ── ⑤ 앞다리 ──
  // 뒷다리와 **반대 위상**이다(`topPose` 가 뒷다리 부호를 뒤집는다). 같은 쪽 앞뒤가
  // 함께 나가면 낙타 걸음이 되어 개로 안 보인다.
  if (legM > 0.02) {
    g.fillStyle = legFill;
    paw(-1, pose.armL, 0.5, yaw);
    paw(1, pose.armR, 0.5, yaw);
  }

  // ── ⑥⑦⑧⑨ 머리 ──
  // 몸통 앞 끝에서 θ 방향으로 더 나간 자리(중심 15 = 몸통 앞 끝 14 + 1)라 4.5px 겹친다.
  // 머리는 몸통의 요동을 **절반만** 따라간다 — 개는 몸보다 머리가 먼저 방향을 잡는다.
  const hx = Math.cos(yaw) * d.headCx * sxL + lean * u * 0.03;
  const hy = Math.sin(yaw) * d.headCx * sxL;
  const hAng = yaw * 0.45;
  const mz = d.headR + d.muzzle;

  g.save();
  g.translate(hx, hy);
  g.rotate(hAng);

  // ⑥ 귀. 밑동은 머리 **뒤쪽** 양옆(base)에 두고 꼭짓점은 거의 **옆**(tip)으로 벌린다.
  // 밑동 각도 그대로 뒤로 뻗으면 꼭짓점이 몸통 타원 **안에** 떨어져 실루엣에서 사라진다 —
  // 머리가 몸통 앞 끝에 얹혀 있어서 뒤쪽은 전부 몸이다. 그래서 뒤(밑동)와 옆(꼭짓점)을
  // 따로 준다. 좌우는 각도·길이가 모두 달라 한 쌍이 같은 삼각형이 되지 않는다.
  g.fillStyle = earFill;
  const em = 0.85 + clamp01(pose.hairMass) * 0.5;
  const ears: [number, number, number, number][] = [
    [-2.42, -2.15, 1.72, 61],
    [2.3, 2.24, 1.54, 62],
  ];
  for (const [base, tip, len, ix] of ears) {
    const a = base + jit(seed, ix, 0.09);
    const t = tip + jit(seed, ix + 8, 0.07);
    g.beginPath();
    g.moveTo(Math.cos(a - 0.62) * d.headR * 0.9, Math.sin(a - 0.62) * d.headR * 0.9);
    g.lineTo(Math.cos(t) * d.headR * len * em, Math.sin(t) * d.headR * len * em);
    g.lineTo(Math.cos(a + 0.62) * d.headR * 0.9, Math.sin(a + 0.62) * d.headR * 0.9);
    g.closePath();
    g.fill();
    g.stroke();
  }

  // ⑦ 주둥이. 머리 가장자리 밖으로 6px 나가는 쐐기. **이것이 "앞"을 못 박는다** —
  // 없으면 머리 원은 앞뒤가 똑같이 생겨서 개가 어느 쪽을 보는지 알 수 없다.
  // 끝을 0.15R 까지 좁히면 바늘이 되어 주둥이가 아니라 부리로 읽힌다. 밑동 0.62R →
  // 끝 0.3R 로 **덜** 좁혀야 코가 달린 뭉툭한 주둥이가 된다.
  g.fillStyle = headFill;
  g.beginPath();
  g.moveTo(d.headR * 0.1, -d.headR * 0.62);
  g.quadraticCurveTo(d.headR * 0.9, -d.headR * 0.46, mz, -d.headR * 0.3);
  g.quadraticCurveTo(mz + d.headR * 0.22, 0, mz, d.headR * 0.3);
  g.quadraticCurveTo(d.headR * 0.9, d.headR * 0.46, d.headR * 0.1, d.headR * 0.62);
  g.closePath();
  g.fill();
  g.stroke();

  // ⑧ 머리. 몸통보다 **밝다** — 그래야 몸 위에 얹힌 것으로 읽힌다. 귀·주둥이의 밑동은
  // 이 원이 덮는다.
  g.beginPath();
  g.arc(0, 0, d.headR, 0, TAU);
  g.fill();
  g.stroke();

  // ⑨ 코끝. 실루엣 밖에서 반짝이는 유일한 밝은 점이라, 축소해도 방향이 살아남는다.
  g.fillStyle = opts.outline ?? lighten(opts.color, 0.5);
  g.lineWidth = lw * 0.7;
  g.beginPath();
  g.ellipse(mz - d.headR * 0.16, 0, d.headR * 0.28, d.headR * 0.24, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.restore();

  g.restore();
}
