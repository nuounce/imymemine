/**
 * I.MY.ME.MINE — 아트 디렉션 팔레트 (SPEC §7).
 *
 * 렌더 전용. 시뮬레이션은 이 파일을 import 하지 않는다.
 * 외부 이미지 에셋이 0개이므로 색이 곧 가독성이다 — 값을 바꾸면 §7 가독성 규칙을 다시 검토할 것.
 */

// ── 월드 ───────────────────────────────────────────────────────────────────
export const C_BG = '#07080d';
export const C_FLOOR = '#12152180';
export const C_GRID = '#1a1f33';
export const C_WALL = '#232a44';
export const C_WALL_TOP = '#2f3860';

// ── 몸 (제목의 네 격) ──────────────────────────────────────────────────────
export const C_I_CORE = '#f2f8ff';
export const C_I_RING = '#6ce8ff';

/** 잔상 슬롯 색: 인덱스 = SlotIndex(1=MY, 2=ME, 3=MINE). 0번은 I 자리라 미사용. */
export const C_SLOT = ['#f2f8ff', '#4fd8ff', '#a97bff', '#ff6b9d'] as const;
/** 잔상 슬롯 기본 알파. 뒤 슬롯일수록 옅어져 I 가 항상 가장 또렷하다. */
export const A_SLOT = [1.0, 0.5, 0.45, 0.4] as const;

export const C_CORPSE = '#6d7590';
export const A_CORPSE = 0.28;

/**
 * 잔상 몸 외곽선 알파. 색은 C_BG 를 쓴다.
 *
 * 잔상 실루엣을 **어떤 배경 위에서도** 끊기 위한 1px 테두리다. 몸통 채움은 그대로
 * 반투명하게 두므로 "과거"라는 느낌은 유지되고, 테두리 한 줄만 배경색으로 눌러
 * 밝은 배경(스캔 빔)과 붉은 배경(간수 시야콘) 양쪽에서 경계가 살아난다.
 * 이 값을 0.5 밑으로 내리면 밝은 시야콘 안에서 다시 뭉개진다.
 */
export const A_GHOST_OUTLINE = 0.72;

// ── 장치 ───────────────────────────────────────────────────────────────────
export const C_ON = '#7dffb0';
export const C_OFF = '#3d445e';

// ── 적 ─────────────────────────────────────────────────────────────────────
/** WARDEN(간수). */
export const C_GUARD = '#ff5a4d';
/** EYE(감시안) 본체·라벨. 점 크기 요소라 잔상과 면적이 겹치지 않는다. */
export const C_CCTV = '#ff2fb0';
/**
 * EYE 스캔 빔(시야콘) 전용 색.
 *
 * 본체 마젠타(#ff2fb0, hue 318°)를 그대로 면적에 깔면 MINE(#ff6b9d, hue 340°)이
 * 그 안에 들어갔을 때 색상차가 22° 밖에 안 나서 몸과 시야가 한 덩어리로 읽힌다.
 * 그래서 빔만 **차가운 저채도 흰빛**으로 분리했다 — 잔상 4색(흰/시안/보라/핑크)과
 * 간수 시야콘(#ff5a4d, 따뜻한 적색) 어느 쪽과도 색상·채도 양축에서 떨어진다.
 * 값이 밝으므로 알파를 함께 올리지 말 것(A_CONE_CCTV 주석 참조).
 */
export const C_CCTV_SCAN = '#c9e9ff';
export const A_CONE_PATROL = 0.1;
export const A_CONE_SUSPICIOUS = 0.16;
export const A_CONE_CHASE = 0.24;
/**
 * 스캔 빔은 색 자체가 밝아 같은 알파에서 옛 마젠타보다 2.5배 밝게 깔린다.
 * 0.12 → 0.09 로 낮춰 간수 시야콘보다 화면을 더 크게 먹지 않도록 맞췄다.
 */
export const A_CONE_CCTV = 0.09;

// ── 목표 ───────────────────────────────────────────────────────────────────
/** CORE — 나를 묶어두던 억제 코어. 이걸 빼앗아야 바깥 문이 열린다. */
export const C_LOOT = '#ffd75c';
export const C_ESCAPE_OPEN = '#7dffb0';
/** 억제 코어를 되찾기 전의 출구 = SEALED. */
export const C_ESCAPE_LOCKED = '#3d445e';

// ── 시설 분위기 (전부 렌더 전용. SimState 를 읽지도 쓰지도 않는다) ─────────
/** 화면 가장자리 비네트의 최대 농도. 시선을 가운데로 모은다. */
export const A_VIGNETTE = 0.5;
/** 감시 모니터 주사선. 이 값을 올리면 잔상 윤곽이 뭉개진다 — 0.04 를 넘기지 말 것. */
export const A_SCANLINE = 0.03;
/** 주사선 간격(px). */
export const SCANLINE_GAP = 3;
/** 형광등이 깜빡일 때 방 전체가 먹는 어둠. */
export const A_LAMP_DIP = 0.1;
/** 바닥 반사 그라디언트의 시작 알파. */
export const A_FLOOR_REFLECT = 0.22;

// ── UI ─────────────────────────────────────────────────────────────────────
export const C_DANGER = '#ff3b5c';
export const C_TEXT = '#dfe6ff';
export const C_TEXT_DIM = '#7c88ad';
export const C_PANEL = '#0b0e18';

/** 시스템 모노스페이스 스택만 사용한다 — 외부 폰트 로드 금지(§0 정적 제약). */
export const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** `weight px` + 모노 스택을 조립한다. */
export function font(px: number, weight: 'normal' | 'bold' = 'normal'): string {
  return `${weight} ${px}px ${MONO}`;
}

/** `#rrggbb` 를 알파 적용 rgba 문자열로. 이미 알파가 붙은 8자리 hex 도 받는다. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const baseA = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const a = Math.max(0, Math.min(1, alpha * baseA));
  return `rgba(${r},${g},${b},${a})`;
}
