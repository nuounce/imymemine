/**
 * I.MY.ME.MINE — 아트 디렉션 팔레트 (SPEC §7).
 *
 * 렌더 전용. 시뮬레이션은 이 파일을 import 하지 않는다.
 * 외부 이미지 에셋이 0개이므로 색이 곧 가독성이다 — 값을 바꾸면 §7 가독성 규칙을 다시 검토할 것.
 *
 * **한 문장 원칙: 세계는 콘크리트고 어둡다. 형광색은 기능 요소에만 쓴다.**
 * 벽·바닥·상자·문은 채도 낮은 회갈색 콘크리트/강철이고 절대 발광하지 않는다.
 * 빛나는 것은 넷뿐이다 — 천장 형광등(실용 조명), 잔상 4색(능력), 장치 ON(초록),
 * 위험 신호(경비 붉은색 / EYE 청백색). 이 목록에 없는 것을 빛나게 만들면 다시
 * "사이버 공간"으로 되돌아간다.
 */

// ── 어둠 ───────────────────────────────────────────────────────────────────
/**
 * 잉크·접지 그림자·글자 헤일로용 깊은 검정. 순수 검정이 아니라 **따뜻한** 검정이라
 * 콘크리트 회갈색과 같은 계열로 앉는다(순수 검정은 회색 위에서 푸르게 뜬다).
 */
export const C_BG = '#080706';
/**
 * 월드 밖 영역. 지하 시설이므로 여기는 보이드가 아니라 **더 어두운 콘크리트**다 —
 * 검정으로 두면 방이 우주에 떠 있는 판으로 읽힌다.
 */
export const C_VOID = '#100e0c';
/** 조명 감쇠 오버레이 색. 따뜻한 바닥과 갈리도록 아주 살짝 차갑다(공기 원근). */
export const C_DARK_AIR = '#07070b';

// ── 바닥: 얼룩진 콘크리트 ─────────────────────────────────────────────────
/** 조명 웅덩이 **안**에서의 바닥색. 감쇠 오버레이가 이 위에 얹혀 나머지를 떨어뜨린다. */
export const C_FLOOR = '#4b433a';
/** 바닥 밝은 반점(마른 자리·시멘트 편차). */
export const C_FLOOR_PALE = '#5d5347';
/** 바닥 어두운 반점(물자국·기름때). */
export const C_FLOOR_DARK = '#2b2622';
/** 슬래브 이음새(신축 줄눈)와 균열. **발광하지 않고 규칙적이지도 않다** — 격자선의 대체물. */
export const C_SEAM = '#211d18';
/** 이음새의 빛 받는 쪽 립. 이 1px 이 홈을 "파인 자리"로 만든다. */
export const C_SEAM_LIP = '#6a6053';

// ── 벽: 두께 있는 콘크리트 덩어리 ─────────────────────────────────────────
/**
 * 벽 윗면 — 천장 조명을 정면으로 받는 면이라 **바닥보다 확실히 밝다.**
 * 바닥과 한두 단계 차이로 두면 어두운 방에서 둘 다 검정으로 뭉쳐 벽이 사라진다.
 */
export const C_WALL_TOP = '#564e43';
/** 벽 측면(카메라 쪽 두께). 윗면과 확실히 갈려야 두께로 읽힌다. */
export const C_WALL = '#231f1a';
/** 벽 near-edge 하이라이트. 윗면과 측면 사이 1px. */
export const C_WALL_LIP = '#8a7f6c';
/** 벽 밑동 곰팡이·물때. */
export const C_GRIME = '#3a3b26';
/** 벽 밑동 녹물 흘러내린 자국. */
export const C_RUST = '#4b2e19';

// ── 강철 구조물(상자·셔터·장치 하우징) ────────────────────────────────────
export const C_METAL = '#544b40';
export const C_METAL_DARK = '#241f1a';
export const C_METAL_LIP = '#7e7361';
/**
 * 셔터에 칠한 낡은 위험 도색. 형광이 아니라 **바래고 더러운** 노랑이다.
 * 여기를 더 밝게 올리면 근처 CORE(금색)와 "금색 주목물" 자리를 다투기 시작한다.
 */
export const C_HAZARD = '#5c4c1c';

// ── 실용 조명(practical lighting) ─────────────────────────────────────────
/** 천장 형광등 디퓨저. 차가운 형광 흰색이되 인물(C_I_CORE)보다 어둡다. */
export const C_LAMP = '#dbe6d8';
/** 형광등 하우징. */
export const C_LAMP_CASE = '#312e28';
/**
 * 조명 웅덩이 밖의 최소 광량(0..1). 0 으로 두면 길을 못 찾는다.
 * 이 값과 `A_LIGHT_FALLOFF` 가 함께 방 안 명암비를 정한다 — 현재 대략 2.4:1.
 */
export const LIGHT_AMBIENT = 0.26;
/** 광량 0 인 자리에 깔리는 감쇠 알파. 강한 감쇠가 곧 "지하"의 압박감이다. */
export const A_LIGHT_FALLOFF = 0.86;

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
 * 밝은 배경(스캔 빔)과 붉은 배경(경비 시야콘) 양쪽에서 경계가 살아난다.
 * 이 값을 0.5 밑으로 내리면 밝은 시야콘 안에서 다시 뭉개진다.
 */
export const A_GHOST_OUTLINE = 0.72;

// ── 장치 ───────────────────────────────────────────────────────────────────
export const C_ON = '#7dffb0';
export const C_OFF = '#3d445e';

// ── 적 ─────────────────────────────────────────────────────────────────────
/** WARDEN(경비). */
export const C_GUARD = '#ff5a4d';
/** EYE(감시안) 본체·라벨. 점 크기 요소라 잔상과 면적이 겹치지 않는다. */
export const C_CCTV = '#ff2fb0';
/**
 * EYE 스캔 빔(시야콘) 전용 색.
 *
 * 본체 마젠타(#ff2fb0, hue 318°)를 그대로 면적에 깔면 MINE(#ff6b9d, hue 340°)이
 * 그 안에 들어갔을 때 색상차가 22° 밖에 안 나서 몸과 시야가 한 덩어리로 읽힌다.
 * 그래서 빔만 **차가운 저채도 흰빛**으로 분리했다 — 잔상 4색(흰/시안/보라/핑크)과
 * 경비 시야콘(#ff5a4d, 따뜻한 적색) 어느 쪽과도 색상·채도 양축에서 떨어진다.
 * 값이 밝으므로 알파를 함께 올리지 말 것(A_CONE_CCTV 주석 참조).
 */
export const C_CCTV_SCAN = '#c9e9ff';
export const A_CONE_PATROL = 0.1;
export const A_CONE_SUSPICIOUS = 0.16;
export const A_CONE_CHASE = 0.24;
/**
 * 스캔 빔은 색 자체가 밝아 같은 알파에서 옛 마젠타보다 2.5배 밝게 깔린다.
 * 0.12 → 0.09 로 낮춰 경비 시야콘보다 화면을 더 크게 먹지 않도록 맞췄다.
 */
export const A_CONE_CCTV = 0.09;

// ── 목표 ───────────────────────────────────────────────────────────────────
/**
 * CORE — 나를 묶어두던 억제 코어.
 *
 * **발광 오브젝트가 아니라 조명받는 금속이다.** 그래서 색이 세 개다: 빛 받는 면(LIT),
 * 중간면(C_LOOT), 그늘진 면(DARK). 하나로 칠하면 다시 네온 마름모가 된다.
 */
export const C_LOOT = '#d9a83a';
export const C_LOOT_LIT = '#ffe9a8';
export const C_LOOT_DARK = '#5d4113';
export const C_ESCAPE_OPEN = '#7dffb0';
/** 억제 코어를 되찾기 전의 출구 = SEALED. 강철 셔터라 금속색이다. */
export const C_ESCAPE_LOCKED = '#4a453c';

// ── 시설 분위기 (전부 렌더 전용. SimState 를 읽지도 쓰지도 않는다) ─────────
/** 화면 가장자리 비네트의 최대 농도. 시선을 가운데로 모은다. */
export const A_VIGNETTE = 0.5;
/** 형광등이 깜빡일 때 방 전체가 먹는 어둠. */
export const A_LAMP_DIP = 0.14;
/**
 * 필름 그레인(화면 공간). 1px 알갱이라 **아주 낮아야** 한다 —
 * 0.05 만 넘겨도 화면 전체가 사포처럼 보이고 잔상 실루엣 경계가 뭉개진다.
 */
export const A_GRAIN = 0.028;
/** 콘크리트 골재 반점(월드 공간, 베이킹 시 1회). 알갱이가 2px 라 더 굵게 읽힌다. */
export const A_GRAIN_FLOOR = 0.055;
/**
 * 가장자리 색수차. 아주 약하게 — 0.04 만 넘어도 어두운 화면 밖 영역이
 * 왼쪽은 붉고 오른쪽은 청록인 **색 얼룩**으로 보인다(필름 흠이 아니라 버그로 읽힌다).
 */
export const A_FRINGE = 0.026;

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

/**
 * `#rrggbb` 를 `k` 배 밝기의 **`#rrggbb`** 로. 조명 웅덩이 밖에 놓인 **물리 오브젝트**
 * (상자·셔터·하우징)를 어둡게 앉히는 데 쓴다. 발광체(장치 ON, 잔상, 위험 신호)에는
 * 쓰지 않는다 — 스스로 빛나는 것은 주변 광량과 무관해야 한다.
 *
 * **반드시 hex 를 돌려줘야 한다.** `rgb(...)` 를 돌려주면 `withAlpha(mulHex(...))` 가
 * 그 문자열을 hex 로 파싱하다 `rgba(NaN,...)` 를 만들고, 캔버스는 잘못된 색 대입을
 * **조용히 무시해 직전 색을 그대로 쓴다** — 셔터가 이전 프레임의 잔상 색으로 칠해진다.
 */
export function mulHex(hex: string, k: number): string {
  const h = hex.slice(1);
  const c = (i: number): string =>
    Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(0)}${c(2)}${c(4)}`;
}
