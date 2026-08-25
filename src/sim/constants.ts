/**
 * I.MY.ME.MINE — 시뮬레이션 상수.
 *
 * 시뮬레이션 내부의 모든 좌표/속도/거리는 정수 "서브픽셀" 단위다.
 * 부동소수점을 쓰지 않는 이유는 리플레이 결정론(divergence = 0) 때문이다.
 * 이 파일 밖에서 매직넘버를 쓰지 말 것.
 */

import type { GuardKind } from './types';

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
/** SENTRY 의 몸 크기. 유형별 크기는 `GUARD_KINDS` 를 보라 (렌더 기본값이기도 하다). */
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
/** SENTRY 기준 속도. 유형별 값은 `GUARD_KINDS`. */
export const GUARD_PATROL_SPEED = 416;
export const GUARD_INVESTIGATE_SPEED = 480;
export const GUARD_CHASE_SPEED = 576;
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
/** 달리는 대상은 이득이 배가 된다. 유형별 기본 이득에 곱한다. */
export const DETECT_RUN_MULT = 2;
/**
 * 시야에서 벗어났을 때의 감쇠. 2 → 1.
 * 2 였을 때는 벽 뒤에 50틱만 숨으면 게이지가 완전히 리셋됐다 — 즉 "기억"이 없었다.
 * 1 이면 가득 찬 게이지가 식는 데 100틱(약 1.7초 × ...)이 걸려, 한 번 들킨 사실이
 * 잠깐 숨는 것으로 지워지지 않는다.
 */
export const DETECT_DECAY = 1;
export const DETECT_SUSPICIOUS = 40;
/**
 * 근접 가중 (SPEC §5.3 확장). 거리가 가까울수록 더 빨리 들킨다.
 * 판정은 **제곱거리 정수 비교**뿐이다 — sqrt 도 나눗셈 결과의 소수도 쓰지 않는다.
 * 시야 거리의 1/3 이내면 +2, 2/3 이내면 +1.
 */
export const DETECT_NEAR_BONUS = 2;
export const DETECT_MID_BONUS = 1;
/**
 * INVESTIGATE 총예산. 120 → 180.
 * 이제 이 예산은 "이동 + 주변 훑기" 전체를 덮으며 매 틱 소모된다(guard.ts).
 * 예전처럼 도착 후에만 줄어들면 먼 소음을 향해 영원히 걸어갈 수 있었다.
 */
export const INVESTIGATE_TICKS = 180;
export const GUARD_TURN_RATE = 2; // facing 인덱스 / 틱

/**
 * 경보 전파 반경. CHASE 에 진입한 경비와 경보를 울린 WATCHER 가
 * 이 반경 안의 다른 경비를 그 지점으로 INVESTIGATE 시킨다.
 * 경비끼리 소통이 없으면 한 명만 따돌리면 끝나는 게임이 된다.
 */
export const ALERT_RADIUS = 224 * SUBPIXEL;
/** WATCHER 가 같은 경보를 연타하지 않도록 하는 잠금. */
export const ALARM_COOLDOWN_TICKS = 120;
/**
 * 예측 추격(lead pursuit). 대상의 **마지막 이동 방향**으로 이만큼 앞을 노린다.
 * 대상이 가까우면(아래 값 이내) 예측을 끄고 몸 자체를 노린다 — 코앞에서 헛짚지 않게.
 */
export const CHASE_LEAD_TICKS = 12;
export const CHASE_LEAD_MIN_DIST = 2 * TILE_SUB;

// ── 냄새 추적 (HOUND) ──────────────────────────────────────────────────────
/**
 * 살아있는 몸은 `SCENT_INTERVAL` 틱마다 자기 중심 좌표를 링버퍼에 남긴다.
 * `SCENT_LEN` 개를 유지하므로 기억되는 과거는 8 × 40 = **320틱**이다.
 *
 * 이 궤적은 몸에 붙어 있고 잔상도 예외가 아니다 — 그래서 잔상이 지나간 길이
 * 그대로 개를 끄는 미끼가 된다. "지울 수 없는 부채"(SPEC §3-2)의 반대급부다.
 */
export const SCENT_INTERVAL = 8;
export const SCENT_LEN = 40;
/** 궤적점에 닿았다고 볼 여유 (서브픽셀). 좌우 흔들기 진폭보다 커야 한다. */
export const SCENT_ARRIVE_EPS = 1024;
/**
 * 한 궤적점에 매달릴 수 있는 최대 틱. 벽 모서리에 걸려 영원히 한 점만
 * 노리는 일이 없도록 강제로 다음 점으로 넘긴다.
 */
export const SCENT_STEP_TIMEOUT = 48;

/**
 * 런지(lunge). 추격 중 `LUNGE_PERIOD` 주기로 앞 `LUNGE_BURST` 틱은 빠르게,
 * 남은 틱은 느리게. 확 치고 나갔다 잠깐 숨을 고르는 리듬이 나온다.
 * 배수는 정수 분수(135/100, 60/100)로 고정한다 — 부동소수 금지.
 */
export const LUNGE_PERIOD = 48;
export const LUNGE_BURST = 30;
export const LUNGE_FAST_NUM = 135;
export const LUNGE_SLOW_NUM = 60;
export const LUNGE_DEN = 100;

/** 진행 방향에 수직으로 흔드는 폭(서브픽셀)과 주기(틱). 주기는 4의 배수. */
export const HOUND_WIGGLE_AMP = 768; // 3px
export const HOUND_WIGGLE_PERIOD = 24;
/** 냄새를 잃었을 때 좌우로 훑는 부채꼴 (facing 인덱스). 주기는 4의 배수. */
export const HOUND_FAN_ARC = 14;
export const HOUND_FAN_PERIOD = 64;
/** HOUND 전용 회전 속도. `GUARD_TURN_RATE`(2) 보다 커서 고개를 빨리 돌린다. */
export const HOUND_TURN_RATE = 6;

// ── 눈뽕 (flash) ───────────────────────────────────────────────────────────
/**
 * 1회용 섬광탄. **테이프에 녹화되므로 잔상도 자기가 주웠던 것을 그대로 터뜨린다** —
 * 과거의 내가 정확한 순간에 터뜨려 주고 지금의 내가 그 틈으로 지나가는 그림이
 * 이 아이템의 존재 이유다.
 */
export const FLASH_RADIUS = 160 * SUBPIXEL;
export const FLASH_TICKS = 150;
/** dazed 동안 facing 이 매 틱 도는 **고정** 증분. 난수가 아니다. */
export const DAZE_SPIN_STEP = 3;

/** 유형별 고정 수치. 경비의 "성격"은 전부 이 표 한 곳에서 나온다. */
export interface GuardKindSpec {
  /** 픽셀 단위 몸 크기 (렌더 참고용). */
  size: number;
  /** 서브픽셀 충돌 박스 한 변. */
  sizeSub: number;
  patrolSpeed: number;
  investigateSpeed: number;
  chaseSpeed: number;
  viewRange: number;
  fovTan: number;
  detectGain: number;
  /**
   * 순찰 대기 중 좌우로 흔드는 폭(facing 인덱스). **반드시 자기 시야 반각 이하여야 한다.**
   * 넘으면 스윕 극단에서 지정 방향이 원뿔 밖으로 나가, 경비가 자기가 지키라고
   * 지시받은 쪽을 주기적으로 못 보게 된다 — 감시를 넓히려던 기능이 사각을 만든다.
   * (64스텝 = 360° 이므로 1스텝 = 5.625°. 반각: SENTRY 50°=8.89 / HOUND 35°=6.22
   *  / BRUTE 65°=11.56 / WATCHER 40°=7.11 스텝.)
   */
  sweepArc: number;
  /** CHASE 진입 후 대상을 못 본 채 버티는 틱 수. */
  chasePersist: number;
  /** false 면 CHASE 에 들어가지 않는다 = 체포하지 않는다 (WATCHER). */
  canChase: boolean;
  /** true 면 게이지가 가득 찰 때 경보를 울린다 (WATCHER). */
  raisesAlarm: boolean;
  /**
   * **반응**할 때의 facing 회전 속도(인덱스/틱). HOUND 만 다르다.
   * 평온한 순찰·복귀는 네 유형 모두 `GUARD_TURN_RATE` 로 돈다 — 이 값은
   * "소리를 들었다 / 의심한다 / 물었다"에서만 쓰인다 (guard.ts).
   */
  turnRate: number;
  /**
   * true 면 대상의 **현재 위치로 직행하지 않고** 궤적(냄새)을 되짚는다.
   * 소음을 들으면 지연 없이 그쪽을 보고, 잃으면 부채꼴로 훑는다 (HOUND).
   * 이 파일 밖에 "HOUND 라면 …" 같은 유형 분기를 만들지 않기 위한 스위치다.
   */
  tracksScent: boolean;

  // ── 보스 스위치 (기존 4종은 전부 0 / false 다) ────────────────────────────
  /**
   * 잔상 한 개당 이동 속도 증가율(%). 0 이면 잔상 수와 무관하다.
   * 배율은 `(v * (100 + step * n)) / 100 | 0` — 정수 나눗셈뿐이다 (guard.ts).
   */
  ghostSpeedStep: number;
  /** 잔상 한 개당 시야 거리 증가율(%). 0 이면 잔상 수와 무관하다. */
  ghostViewStep: number;
  /**
   * true 면 자기가 문 궤적을 **같은 레벨의 모든 냄새 추적 유형**에게 넘긴다.
   * 경보(`ALERT_RADIUS`)와 달리 반경이 없다 — 무리는 거리로 끊기지 않는다.
   */
  sharesScent: boolean;
  /**
   * 살아있는 몸을 연속으로 이만큼 붙들면 한 번 **센다**. 0 이면 세지 않는다.
   * 세는 것은 잡는 것과 별개라 `canChase` 와 무관하게 동작한다.
   */
  countTicks: number;
  /** 같은 몸을 다시 세기까지의 잠금 틱. 매 틱 세지 않게 하는 값이다. */
  countCooldown: number;
}

/** `kindSpec` 의 꼬리 인자. 지정하지 않은 값은 전부 기존 4종의 기본값이다. */
interface KindExtra {
  ghostSpeedStep?: number;
  ghostViewStep?: number;
  sharesScent?: boolean;
  countTicks?: number;
  countCooldown?: number;
}

function kindSpec(
  size: number,
  patrolSpeed: number,
  investigateSpeed: number,
  chaseSpeed: number,
  viewRangePx: number,
  fovTan: number,
  detectGain: number,
  sweepArc: number,
  chasePersist: number,
  canChase: boolean,
  raisesAlarm: boolean,
  turnRate: number = GUARD_TURN_RATE,
  tracksScent = false,
  extra: KindExtra = {},
): GuardKindSpec {
  return {
    size,
    sizeSub: size * SUBPIXEL,
    patrolSpeed,
    investigateSpeed,
    chaseSpeed,
    viewRange: viewRangePx * SUBPIXEL,
    fovTan,
    detectGain,
    sweepArc,
    chasePersist,
    canChase,
    raisesAlarm,
    turnRate,
    tracksScent,
    ghostSpeedStep: extra.ghostSpeedStep ?? 0,
    ghostViewStep: extra.ghostViewStep ?? 0,
    sharesScent: extra.sharesScent ?? false,
    countTicks: extra.countTicks ?? 0,
    countCooldown: extra.countCooldown ?? 0,
  };
}

/**
 * 네 유형의 전부. 표를 읽으면 각자가 무엇으로 위협하는지 그대로 보인다.
 *
 * BRUTE 의 `size: 40` 에는 특수 규칙이 붙어 있지 않다. 40px 박스는 32px 통로에
 * 들어가지 않으므로 `sweepAxis` 가 통로 입구에서 클램프한다 — 좁은 길이 피난처가
 * 되는 건 AI 예외가 아니라 **충돌 판정의 결과**다.
 * (그래서 BRUTE 는 3타일 이상 열린 곳에 배치해야 한다. 1타일 통로에 스폰하면
 *  처음부터 벽에 낀 상태가 되고, 낀 몸은 탈출을 위해 이동이 허용된다 — physics.ts)
 */
export const GUARD_KINDS: Readonly<Record<GuardKind, GuardKindSpec>> =
  Object.freeze({
    //        size  patrol  invest  chase  range  fovTan  gain  arc  persist  chase  alarm  turn  scent
    SENTRY: kindSpec(26, 416, 480, 576, 224, 1192, 3, 8, 90, true, false),
    // 유일하게 냄새를 쫓고 고개를 빨리 돌리는 유형. 나머지 셋은 기본값 그대로다.
    HOUND: kindSpec(24, 480, 560, 704, 176, 700, 2, 6, 300, true, false, HOUND_TURN_RATE, true),
    BRUTE: kindSpec(40, 256, 288, 352, 192, 2144, 5, 11, 45, true, false),
    // 순찰 속도 0 = 제자리에 못박힌 감시자. 두리번거리기만 한다.
    WATCHER: kindSpec(28, 0, 0, 0, 320, 839, 6, 7, 0, false, true),

    // ── 보스 4종 ────────────────────────────────────────────────────────────
    // 위 네 줄은 한 글자도 바뀌지 않았다. 보스는 전부 이 아래 네 줄과
    // `KindExtra` 스위치만으로 성립한다 — guard.ts 에 "INSPECTOR 라면 …" 같은
    // 유형 분기는 없다.
    //
    // 1막. 두리번거리기 폭이 **0** 이다 → 대기 중 facing 이 한 틱도 흔들리지 않는다.
    // "두리번거리지 않는다"는 규칙이 아니라 `sweepArc: 0` 의 결과다 (BRUTE 의
    // 40px 가 통로를 막는 것과 같은 방식). 시야각 25° 로 좁되 사거리 288px(9타일)
    // 로 가장 길다 — 복도를 훑는 점검자.
    INSPECTOR: kindSpec(26, 416, 448, 512, 288, 466, 3, 0, 60, true, false),
    // 2막. 냄새를 공유한다. 자기 속도는 HOUND 보다 한 단 느리되(448/520/640 <
    // 480/560/704) 추격 지속은 전 유형 최장(480)이다 — 미끼 하나로는 못 끊는다.
    PACK_LEAD: kindSpec(
      24, 448, 520, 640, 176, 700, 2, 6, 480, true, false, HOUND_TURN_RATE, true,
      { sharesScent: true },
    ),
    // 3막. 잔상 한 개당 속도 +12%, 시야 +10%. 잔상을 아낄수록 약해진다.
    OVERSEER: kindSpec(
      26, 384, 448, 512, 208, 1192, 4, 8, 120, true, false, GUARD_TURN_RATE, false,
      { ghostSpeedStep: 12, ghostViewStep: 10 },
    ),
    // 4막. `canChase: false` — 손을 대지 않는다. 45틱(0.75초) 붙들면 한 번 세고,
    // 같은 몸은 180틱(3초) 동안 다시 세지 않는다. `raisesAlarm` 도 false 다:
    // 부르지도 잡지도 않고 **적기만** 한다.
    COUNTER: kindSpec(
      28, 288, 320, 0, 256, 839, 2, 7, 0, false, false, GUARD_TURN_RATE, false,
      { countTicks: 45, countCooldown: 180 },
    ),
  });

// ── 두리번거리기 / 수색 ────────────────────────────────────────────────────
/**
 * SENTRY 의 스윕 폭(facing 인덱스). 유형별 값은 `GUARD_KINDS.sweepArc` 다.
 * ±8 ≈ ±45° 라 유효 감시각이 시야 반각 + 45° 로 넓어진다 — "정면만 피하면 된다"가 사라지되,
 * 반각 50° 안에 머무르므로 **지정 방향은 한 틱도 놓치지 않는다**.
 */
export const GUARD_SWEEP_ARC = 8;
/** 한 왕복(0 → +arc → 0 → -arc → 0)에 걸리는 틱. 4로 나누어떨어져야 한다. */
export const GUARD_SWEEP_PERIOD = 96;

/**
 * INVESTIGATE 가 기준점에 도착한 뒤 순서대로 훑는 오프셋. **고정 배열**이다 —
 * 난수를 쓰면 결정론이 무너진다. 도착해서 가만히 서 있던 예전 동작이
 * "수색"이 아니라 "구경"이었던 문제를 이것이 고친다.
 */
export const SEARCH_OFFSETS: readonly { x: number; y: number }[] = Object.freeze([
  { x: TILE_SUB, y: 0 },
  { x: 0, y: TILE_SUB },
  { x: -TILE_SUB, y: 0 },
]);

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

// ── 구조 지원 (막힌 플레이어를 위한 탈출구) ────────────────────────────────
//
// "실패"는 몸을 잃은 사건만 센다: 체포·시간 소진·전체 초기화. R 조기 확정은
// 전략적 배치라 세지 않는다 — 잘하는 플레이어의 카운터가 올라가면 안 된다.
// 카운터는 스테이지 단위이며 전체 초기화(fullReset)를 넘어 살아남는다 —
// 초기화를 반복하는 그 순간이 바로 막힌 순간이기 때문이다.

/** 이만큼 실패하면 `T ▸ HINT` 가 열린다. 스테이지의 결정적 한 줄을 보여 준다. */
export const HINT_UNLOCK_FAILS = 5;
/** 이만큼 실패하면 (STORY 한정) `N ▸ SKIP` 이 열린다. DEBT +1 을 대가로 다음 방으로. */
export const SKIP_UNLOCK_FAILS = 10;
/** 세션 공지 한 줄(차단된 R 안내 등)의 기본 노출 시간. 5초. */
export const NOTICE_TICKS = 300;
/** 건너뛰기 확인 창. 첫 N 이 무장시키고, 이 안에 한 번 더 눌러야 실행된다. 3초. */
export const SKIP_ARM_TICKS = 180;

// ── 입력 비트마스크 ────────────────────────────────────────────────────────
export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_INTERACT = 16;
export const IN_RUN = 32;
/**
 * 눈뽕 사용 (비트 8). 마이크가 비트 6~7 을 쓰고 있어 바이트가 꽉 찼으므로
 * 테이프는 `Uint16Array` 다. **기존 비트 배치(1·2·4·8·16·32 + 마이크 6~7)는
 * 한 비트도 움직이지 않았다** — 기존 정답 테이프의 의미는 그대로다.
 */
export const IN_FLASH = 256;

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
 * 3루프에서 기침한 순간은 영원히 그 자리에 남아 매 루프 경비를 부른다.
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
