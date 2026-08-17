/**
 * I.MY.ME.MINE — 시뮬레이션 공개 타입.
 *
 * 이 파일은 sim / render / game 사이의 **통합 계약**이다.
 * 필드 추가는 허용하되, 기존 필드의 이름·의미·단위를 바꾸지 말 것.
 *
 * 좌표 규약: 모든 x/y 는 서브픽셀 정수이며 **AABB 좌상단**을 가리킨다.
 */

// ── 기본 ───────────────────────────────────────────────────────────────────

/**
 * 틱당 입력 비트마스크 (constants.ts 의 IN_* 조합). 0..255
 * - 비트 0~5: 이동 / 상호작용 / 달리기 (UP DOWN LEFT RIGHT INTERACT RUN)
 * - 비트 6~7: 마이크 레벨 0~3 (LISTEN 모드. EASY 에서는 항상 0)
 */
export type InputMask = number;

/** 녹화된 한 루프의 입력 열. 인덱스 = 틱. */
export type Tape = Uint8Array;

/** 0 = I(조작 중), 1 = MY, 2 = ME, 3 = MINE */
export type SlotIndex = 0 | 1 | 2 | 3;

export interface Vec2 {
  x: number;
  y: number;
}

// ── 엔티티 ─────────────────────────────────────────────────────────────────

export interface Body {
  id: number;
  slot: SlotIndex;
  /** true = 플레이어가 지금 조작 중인 몸(I). 루프당 정확히 하나. */
  isLive: boolean;
  x: number;
  y: number;
  /** 0..DIR_STEPS-1 */
  facing: number;
  /** false = 체포되어 시체가 됨. 시체도 발판을 누르지만 경비 시야에는 잡히지 않는다. */
  alive: boolean;
  /** 테이프가 소진되어 마지막 상태로 정지함. 조기 확정 전략의 핵심. */
  frozen: boolean;
  carryingLoot: boolean;
  /** 이번 루프에 경비/CCTV에 발각된 적이 있는가 (렌더 힌트). */
  spotted: boolean;
  lastInput: InputMask;
  noiseTimer: number;
  /** 이 몸이 소비하는 테이프. isLive 인 몸은 null (실시간 입력). */
  tape: Tape | null;
  /**
   * 테이프가 끝나는 순간 시체가 되는가.
   * 체포로 확정된 잔상은 재생 동안에는 살아 있는 미끼로 기능하고,
   * 재생이 끝나면 그 자리에 시체로 남는다 (SPEC §3-2).
   */
  becomesCorpse: boolean;
}

export interface Crate {
  id: number;
  x: number;
  y: number;
  /** 이번 틱 시작 위치. 반대 방향 동시 밀림(합력 0)일 때 여기로 되돌린다. */
  tickStartX: number;
  tickStartY: number;
  /**
   * 이번 틱에 밀린 방향. 0 = 아직 안 밀림, -1/1 = 그 방향, 2 = 상충으로 잠김.
   * 매 틱 시작에 0 으로 초기화된다.
   */
  pushDirX: number;
  pushDirY: number;
}

export type GuardState =
  | 'PATROL'
  | 'SUSPICIOUS'
  | 'INVESTIGATE'
  | 'CHASE'
  | 'RETURN';

export interface Guard {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: GuardState;
  /** 0..DETECT_MAX */
  detect: number;
  /** 순찰 웨이포인트 (서브픽셀 중심 좌표) */
  path: Vec2[];
  pathIndex: number;
  waitTimer: number;
  waitTicks: number;
  /** 마지막으로 목격/추적 중인 지점 */
  targetX: number;
  targetY: number;
  /** 현재 추적 중인 Body id (-1 = 없음) */
  targetBodyId: number;
  stateTimer: number;
}

export interface Cctv {
  id: number;
  x: number;
  y: number;
  /** 스윕 중심 방향 (0..DIR_STEPS-1) */
  baseFacing: number;
  /** 중심에서 좌우로 흔들리는 폭 (facing 인덱스 단위) */
  sweepArc: number;
  /** 한 번 왕복하는 데 걸리는 틱 */
  sweepTicks: number;
  /** 시작 위상 오프셋 (틱) */
  phase: number;
  facing: number;
  lockTimer: number;
  /** 이 채널이 ON 이면 CCTV 가 꺼진다. undefined = 항상 켜짐. */
  disableChannel?: string;
  enabled: boolean;
}

// ── 장치 ───────────────────────────────────────────────────────────────────

export interface Plate {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  channel: string;
  on: boolean;
}

export interface Button {
  id: number;
  x: number;
  y: number;
  channel: string;
  /** 눌린 뒤 ON 을 유지하는 틱 수. 이게 "시간차"를 만든다. */
  holdTicks: number;
  timer: number;
  on: boolean;
}

export interface Lever {
  id: number;
  x: number;
  y: number;
  channel: string;
  on: boolean;
  /** 같은 틱에 여러 번 토글되지 않게 하는 잠금 */
  cooldown: number;
}

export interface Gate {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  channel: string;
  /** true = 채널 ON 일 때 오히려 닫힌다 */
  invert: boolean;
  open: boolean;
}

/**
 * 소음 바닥. 그 위를 **움직이는** 몸은 걷든 뛰든 소음을 낸다. 서 있으면 무음.
 * 상태가 없다 — 판정에 필요한 건 사각형뿐이다.
 */
export interface Grate {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 주기 레이저. `(tick + phase) % periodTicks < onTicks` 이면 ON — 난수가 없다.
 * 좌표는 두 타일 중심을 잇는 선분이며, 판정은 정수 SAT 다 (devices.ts).
 */
export interface Laser {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  periodTicks: number;
  onTicks: number;
  phase: number;
  /** 이 채널이 ON 이면 레이저가 꺼진다 (CCTV 와 같은 규약). */
  disableChannel?: string;
  on: boolean;
}

/** 순차 버튼 한 개. 같은 group 의 버튼들을 order 오름차순으로 눌러야 한다. */
export interface SeqButton {
  id: number;
  x: number;
  y: number;
  group: string;
  order: number;
}

/**
 * 순차 버튼 그룹의 상태. 그룹 이름이 곧 채널 이름이다.
 * 위치가 아니라 **시간 순서**가 자원이 되는 장치 (SPEC §3-3 의 연장).
 */
export interface SeqGroup {
  group: string;
  /** 이 그룹의 order 값들을 오름차순으로 정렬한 목록. */
  orders: number[];
  /** 다음에 눌러야 할 order 의 `orders` 내 인덱스. */
  next: number;
  /** 끝까지 맞게 눌렀는가. true 면 채널이 영구 ON (월드 재생성 전까지). */
  done: boolean;
}

/**
 * 전력 버스. 묶인 채널 중 **동시에 하나만** ON 이 된다.
 * 문을 여는 것과 감시안을 끄는 것 중 하나를 골라야 한다.
 */
export interface PowerBus {
  bus: string;
  channels: string[];
  /** 지금 전력을 쥔 채널의 `channels` 내 인덱스. -1 = 없음. */
  activeIndex: number;
  /** 직전 틱에 각 채널이 **요청**한 상태 (강제 OFF 당한 결과가 아니라 원래 소스 값). */
  prevOn: boolean[];
}

export interface Loot {
  id: number;
  x: number;
  y: number;
  taken: boolean;
  /** 들고 있는 Body id (-1 = 바닥) */
  holderId: number;
}

export interface EscapeZone {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoiseEvent {
  x: number;
  y: number;
  radius: number;
  tick: number;
}

// ── 레벨 정의 (순수 데이터) ────────────────────────────────────────────────

/** 타일맵 문자: '#' 벽, '.' 바닥, 'S' 스폰 지점 */
export interface LevelDef {
  id: string;
  name: string;
  /** 메달 기준 잔상 수. 사용 잔상 <= par 면 MINIMUM AFTERIMAGE ★ */
  par: number;
  /** 각 줄의 길이가 모두 같아야 한다. */
  tiles: string[];
  /** 한 문장 힌트. 화면 하단에 조용히 표시. */
  hint: string;
  channelMode?: Record<string, 'AND' | 'OR'>;
  plates?: { tx: number; ty: number; channel: string }[];
  buttons?: { tx: number; ty: number; channel: string; holdTicks: number }[];
  levers?: { tx: number; ty: number; channel: string; on?: boolean }[];
  gates?: {
    tx: number;
    ty: number;
    w?: number;
    h?: number;
    channel: string;
    invert?: boolean;
  }[];
  crates?: { tx: number; ty: number }[];
  /** 소음 바닥. w/h 생략 시 1타일. */
  grates?: { tx: number; ty: number; w?: number; h?: number }[];
  lasers?: {
    from: { tx: number; ty: number };
    to: { tx: number; ty: number };
    periodTicks: number;
    onTicks: number;
    phase?: number;
    disableChannel?: string;
  }[];
  /** 그룹 이름이 그대로 완성 채널 이름이 된다. */
  seqButtons?: { tx: number; ty: number; group: string; order: number }[];
  powerBuses?: { bus: string; channels: string[] }[];
  guards?: {
    path: { tx: number; ty: number }[];
    waitTicks?: number;
    facing?: number;
  }[];
  cctvs?: {
    tx: number;
    ty: number;
    baseFacing: number;
    sweepArc?: number;
    sweepTicks?: number;
    phase?: number;
    disableChannel?: string;
  }[];
  loot: { tx: number; ty: number };
  escape: { tx: number; ty: number; w?: number; h?: number };
}

// ── 시뮬 상태 ──────────────────────────────────────────────────────────────

export type SimOutcome = 'RUNNING' | 'CLEARED' | 'CAPTURED' | 'TIMEUP';

export interface SimState {
  level: LevelDef;
  tick: number;
  /** 벽 여부. 인덱스 = ty * width + tx */
  solid: Uint8Array;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;

  bodies: Body[];
  crates: Crate[];
  guards: Guard[];
  cctvs: Cctv[];
  plates: Plate[];
  buttons: Button[];
  levers: Lever[];
  gates: Gate[];
  grates: Grate[];
  lasers: Laser[];
  seqButtons: SeqButton[];
  /** group 이름 오름차순 고정. 순회 순서 = 결정론. */
  seqGroups: SeqGroup[];
  powerBuses: PowerBus[];
  loot: Loot;
  escape: EscapeZone;

  /** 채널 → ON 여부. 매 틱 재계산된다. */
  channels: Map<string, boolean>;
  /** 이번 틱에 발생한 소음 (렌더/AI 공용, 매 틱 초기화) */
  noises: NoiseEvent[];

  outcome: SimOutcome;
  alerts: number;
  /** 다음 엔티티 id */
  nextId: number;
}

/** stepWorld 가 렌더/오디오에 넘겨주는 이번 틱의 사건들. 시뮬 상태가 아니다. */
export interface TickEvents {
  captured: boolean;
  cleared: boolean;
  lootTaken: boolean;
  gateToggled: boolean;
  interacted: boolean;
  alerted: boolean;
  footstep: boolean;
  ghostSpotted: boolean;
}
