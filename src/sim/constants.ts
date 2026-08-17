/**
 * I.MY.ME.MINE — 시뮬레이션 상수.
 *
 * 시뮬레이션 내부의 모든 좌표/속도/거리는 정수 "서브픽셀" 단위다.
 * 부동소수점을 쓰지 않는 이유는 리플레이 결정론(divergence = 0) 때문이다.
 * 이 파일 밖에서 매직넘버를 쓰지 말 것.
 */

// ── 시간 ───────────────────────────────────────────────────────────────────
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
/** 루프 최대 길이 = 60초. 최대치일 뿐이며 플레이어는 언제든 조기 확정할 수 있다. */
export const MAX_TICKS = 3600;
export const MAX_STEPS_PER_FRAME = 5;

// ── 공간 ───────────────────────────────────────────────────────────────────
/** 1픽셀 = 256 서브픽셀. 시뮬 좌표는 전부 이 단위의 정수. */
export const SUBPIXEL = 256;
export const TILE = 32;
export const TILE_SUB = TILE * SUBPIXEL; // 8192

export const BODY_SIZE = 24;
export const BODY_SUB = BODY_SIZE * SUBPIXEL; // 6144
export const CRATE_SIZE = 32;
export const CRATE_SUB = CRATE_SIZE * SUBPIXEL; // 8192
export const GUARD_SIZE = 26;
export const GUARD_SUB = GUARD_SIZE * SUBPIXEL;

export const CANVAS_W = 960;
export const CANVAS_H = 600;

// ── 몸 슬롯 = 제목 ─────────────────────────────────────────────────────────
/** 총 4바디(생존 1 + 잔상 3). 이 상한이 곧 게임 제목이다. */
export const MAX_AFTERIMAGES = 3;
export const MAX_BODIES = MAX_AFTERIMAGES + 1;
export const SLOT_NAMES = ['I', 'MY', 'ME', 'MINE'] as const;

// ── 이동 (서브픽셀 / 틱) ───────────────────────────────────────────────────
export const WALK_SPEED = 512; // 2.0 px/tick
export const RUN_SPEED = 832; // 3.25 px/tick
/** floor(speed / sqrt(2)) 를 상수로 고정 — 런타임 sqrt 금지. */
export const WALK_DIAG = 362;
export const RUN_DIAG = 588;

// ── 코너 어시스트 ──────────────────────────────────────────────────────────
/**
 * 1타일 통로(32px)에 24px 바디가 들어가면 좌우 여유가 각 4px뿐이다. 그 4px 안으로
 * 정렬하지 못하면 모서리에 걸려 축분리 충돌이 그 축을 0으로 만들고, 플레이어는
 * "사각형에 맞춰 지나는" 느낌을 받는다. 그래서 **막혔을 때만** 수직축을 미세하게
 * 밀어 모서리를 돌게 해 준다 (physics.ts `moveBody`).
 *
 * 속도 상수(WALK/RUN/DIAG)는 손대지 않는다 — "걷기 1타일 = 정확히 16틱" 은
 * 정답 테이프의 전제이자 이 게임의 검산 단위다. 어시스트는 가속도가 아니라
 * 막힘 해소이므로 직선 주행에는 한 틱도 영향을 주지 않는다.
 */
/** 이 값 이하로 걸쳐 있을 때만 어시스트한다. 넘으면 벽을 정면으로 미는 상황이다. */
export const CORNER_ASSIST_MAX = 8 * SUBPIXEL; // 2048 = 8px
/** 어시스트 1틱당 수직축 이동량. 0.75px — 눈에 띄지 않게 스르륵 들어간다. */
export const CORNER_ASSIST_SPEED = 192;

// ── 소음 ───────────────────────────────────────────────────────────────────
/** 달릴 때만 소음이 난다. 걷기는 무음 — 잔상을 미끼로 쓸지 말지가 선택이 된다. */
export const NOISE_INTERVAL = 12;
export const NOISE_RADIUS = 160 * SUBPIXEL;

/**
 * 소음 바닥(grate). 금속 격자 위에서는 **움직이기만 하면** 소리가 난다 —
 * 걷기도 무음이 아니다. 서 있으면 무음이므로 "빠른 길은 시끄럽다"가 성립하고,
 * 경로 선택 자체가 결정이 된다.
 *
 * 달리기보다 잦지만(10 < 12) 반경은 작다(128 < 160). 한 몸은 여전히 한 틱에
 * 소음 하나만 낸다 — 겹치면 간격은 짧은 쪽, 반경은 큰 쪽을 쓴다 (world.ts 4단계).
 */
export const GRATE_NOISE_INTERVAL = 10;
export const GRATE_NOISE_RADIUS = 128 * SUBPIXEL;

// ── 방향 테이블 ────────────────────────────────────────────────────────────
/** 방향 해상도. facing 은 0..DIR_STEPS-1 정수 인덱스. 0 = +X(오른쪽), 시계방향. */
export const DIR_STEPS = 64;
/** 고정소수점 스케일 (Q12). */
export const DIR_Q = 4096;

function buildDirTable(fn: (a: number) => number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < DIR_STEPS; i++) {
    // Math.round 로 Q12 정수에 양자화하므로, 엔진별 부동소수 오차(~1e-16)는
    // 양자 간격(1/4096 ≈ 2.4e-4)에 비해 무시 가능하다. 즉 테이블은 어디서 생성해도 동일하다.
    out.push(Math.round(fn((i * 2 * Math.PI) / DIR_STEPS) * DIR_Q));
  }
  return Object.freeze(out);
}
export const DIR_COS: readonly number[] = buildDirTable(Math.cos);
export const DIR_SIN: readonly number[] = buildDirTable(Math.sin);

// ── 경비 ───────────────────────────────────────────────────────────────────
export const GUARD_PATROL_SPEED = 384;
export const GUARD_INVESTIGATE_SPEED = 448;
export const GUARD_CHASE_SPEED = 512;
export const GUARD_VIEW_RANGE = 224 * SUBPIXEL; // 7 타일
/**
 * 시야 반각 50°의 탄젠트를 1000배 정수로 고정.
 * 원뿔 판정: |perp| * TAN_SCALE <= GUARD_FOV_TAN * forward  (forward > 0)
 * → sqrt / atan2 없이 완전 정수 판정.
 */
export const TAN_SCALE = 1000;
export const GUARD_FOV_TAN = 1192; // tan(50°) ≈ 1.1918
export const CCTV_FOV_TAN = 700; // tan(35°) ≈ 0.7002

export const DETECT_MAX = 100;
export const DETECT_GAIN = 3;
export const DETECT_GAIN_RUN = 6;
export const DETECT_DECAY = 2;
export const DETECT_SUSPICIOUS = 40;
export const INVESTIGATE_TICKS = 120;
export const GUARD_TURN_RATE = 2; // facing 인덱스 / 틱

// ── CCTV ───────────────────────────────────────────────────────────────────
export const CCTV_RANGE = 192 * SUBPIXEL;
export const CCTV_LOCK_TICKS = 45;

// ── 상호작용 ───────────────────────────────────────────────────────────────
export const INTERACT_RANGE = 40 * SUBPIXEL;
export const LOOT_PICKUP_RANGE = 20 * SUBPIXEL;
/** 같은 레버가 한 틱에 여러 몸에 의해 연타되지 않도록 하는 잠금. */
export const LEVER_COOLDOWN_TICKS = 10;

// ── 세션 (시뮬 외부지만 틱 단위) ───────────────────────────────────────────
/** BACKSPACE 를 2초 홀드해야 전체 초기화. 실수로 눌리지 않게. */
export const RESET_HOLD_TICKS = 120;
export const LOOP_TRANSITION_TICKS = 90; // 1.5초 — PRD의 "전환 < 2초" 준수
/** 덮어쓰기는 스테이지당 정확히 1회. */
export const OVERWRITE_PER_STAGE = 1;

// ── 입력 비트마스크 ────────────────────────────────────────────────────────
export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_INTERACT = 16;
export const IN_RUN = 32;

// ── 마이크 (LISTEN 모드) ───────────────────────────────────────────────────
/**
 * 마이크 레벨(0~3)은 입력 바이트의 **비트 6~7** 에 실린다.
 *
 * 핵심: 시뮬레이션은 실시간 마이크를 **절대** 읽지 않는다. 조작 중인 몸(I)의
 * 마이크 레벨을 매 틱 입력 마스크에 OR 해서 **테이프에 녹화**하고, 잔상은 그
 * 녹화된 비트를 그대로 재생한다. 실시간 소리가 잔상에 닿는 경로는 없다.
 * 그래서 재생 오차는 마이크를 켜도 여전히 정확히 0 이다 (SPEC §4).
 *
 * 이 설계가 컨셉이기도 하다 — **과거의 나의 숨소리가 지금의 나를 배신한다.**
 * 3루프에서 기침한 순간은 영원히 그 자리에 남아 매 루프 간수를 부른다.
 * "지울 수 없는 부채"(SPEC §3-2)가 소리로도 성립한다.
 *
 * 기존 이동/상호작용 비트(1·2·4·8·16·32)는 절대 건드리지 않는다.
 * EASY 모드에서는 이 비트가 항상 0 이라 기존 동작과 완전히 동일하다.
 */
export const IN_MIC_SHIFT = 6;
export const IN_MIC_MASK = 192; // 0b1100_0000

/** 마이크 레벨별 소음 반경 (서브픽셀). 인덱스 = 레벨 0..3. 0 = 무음. */
export const MIC_NOISE_RADIUS: readonly number[] = [
  0,
  96 * SUBPIXEL, // 1 — 숨소리 / 옷 스치는 소리
  176 * SUBPIXEL, // 2 — 말소리 (달리기 소음 160px 보다 조금 크다)
  272 * SUBPIXEL, // 3 — 기침 / 외침
];

/** 입력 마스크에서 마이크 레벨(0..3)을 뽑는다. */
export function micLevelOf(mask: number): number {
  return (mask >> IN_MIC_SHIFT) & 3;
}
