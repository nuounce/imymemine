/**
 * 키캡 그림 — "무엇을 누르는가"를 글자가 아니라 **물체**로 보여준다.
 *
 * 조작 안내에서 `R` 이라고 쓰면 그것은 문장의 일부로 읽히고 지나간다. 같은 `R` 이
 * **눌러지는 키 모양** 안에 들어 있으면 손이 먼저 반응한다. 그래서 이 파일은
 * 텍스트가 아니라 키를 그린다: 윗면은 조명을 받고, 아래에는 3px 스커트(측면)와
 * 접지 그림자가 있고, 눌린 상태에서는 윗면이 실제로 내려앉는다.
 *
 * 터치 기기에서 키캡은 **거짓 정보**다. 손가락에게 `R` 은 존재하지 않는다. 그래서
 * `touch: true` 면 같은 함수가 화면의 그 버튼(원형 패드)을 그린다 — 실제로 화면에
 * 있는 물체와 같은 모양이라야 안내가 안내로 기능한다.
 *
 * 색은 발명하지 않는다: 전부 `palette.ts` 의 강철·조명 토큰에서 파생시킨다.
 * 시설의 강철 키에 형광등 빛이 걸린 것이지, 발광하는 SF 버튼이 아니다.
 */
import {
  C_BG,
  C_LAMP,
  C_METAL,
  C_METAL_DARK,
  C_METAL_LIP,
  font,
  mulHex,
  withAlpha,
} from './palette';

/** 키 윗면 = 조명을 정면으로 받는 강철면. 라벨(C_LAMP)과 4.6:1 이상 남는 값. */
const C_CAP_TOP = C_METAL;
/** 키 측면(스커트). 윗면과 확실히 갈려야 "두께"로 읽힌다. */
const C_CAP_SIDE = mulHex(C_METAL_DARK, 0.9);
/** 윗면 모서리에 걸린 빛 한 줄. 발광이 아니라 금속 립이다. */
const C_CAP_LIP = C_METAL_LIP;
/** 키캡 라벨 = 스텐실 도장 흰색(형광등 색). */
const C_CAP_LABEL = C_LAMP;

/** 스커트 깊이. 이 3px 이 "누를 수 있는 물체"의 전부다. */
const SKIRT = 3;
/** 라벨 좌우 여백. */
const PAD_X = 7;
/** 글자 크기에 더해지는 세로 여백(스커트 포함). */
const PAD_Y = 13;

export interface KeycapOpts {
  /** 라벨 글자 크기(px). 키캡 전체 크기가 여기서 파생된다. */
  size?: number;
  /** 강조색. 주면 라벨과 윗면 색조가 그 색으로 기운다(R = 금색 등). */
  color?: string;
  /** 전체 불투명도. 페이드 인/아웃용. */
  alpha?: number;
  /** 눌린 상태. 윗면이 2px 내려앉고 립이 사라진다. */
  pressed?: boolean;
  /** 터치 기기 — 키캡 대신 화면의 그 버튼(원형 패드)을 그린다. */
  touch?: boolean;
}

/**
 * 키캡 하나가 차지하는 사각형. **그리지 않고** 크기만 잰다 —
 * 여러 개를 한 줄에 놓을 때 먼저 폭을 알아야 중앙 정렬이 된다.
 *
 * `ctx.font` 을 건드리므로 호출한 쪽은 이 뒤에 폰트를 다시 세워야 한다.
 */
export function keycapBox(
  ctx: CanvasRenderingContext2D,
  label: string,
  opts: KeycapOpts = {},
): { w: number; h: number } {
  const size = opts.size ?? 13;
  ctx.font = font(size, 'bold');
  const tw = Math.round(ctx.measureText(label).width);
  if (opts.touch === true) {
    // 원형 패드. 화면에 실제로 있는 패드(r 26~54)와 같은 크기대로 앉힌다.
    const r = Math.max(22, Math.round(tw / 2) + 11);
    return { w: r * 2, h: r * 2 };
  }
  return { w: Math.max(size + 12, tw + PAD_X * 2), h: size + PAD_Y };
}

/**
 * 키캡 한 개. `x`/`y` 는 **좌상단**이고, 반환값은 `keycapBox` 와 같은 사각형이다.
 * 터치에서는 그 사각형에 **내접하는 원**을 그린다(중심 = 사각형 중심).
 */
export function drawKeycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  opts: KeycapOpts = {},
): { w: number; h: number } {
  const size = opts.size ?? 13;
  const a = Math.max(0, Math.min(1, opts.alpha ?? 1));
  const accent = opts.color;
  const box = keycapBox(ctx, label, opts);
  if (a <= 0) return box;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (opts.touch === true) {
    drawTouchPad(ctx, x, y, box, label, size, a, accent, opts.pressed === true);
    return box;
  }

  const { w, h } = box;
  const down = opts.pressed === true;
  /** 윗면이 내려앉는 양. 눌린 키는 스커트가 그만큼 사라진다. */
  const sink = down ? 2 : 0;
  const faceH = h - SKIRT;

  // 접지 그림자 — 키가 판 위에 **얹혀 있다**는 사실.
  ctx.fillStyle = withAlpha(C_BG, 0.55 * a);
  ctx.fillRect(x + 1, y + 2, w, h);

  // 몸통(측면).
  ctx.fillStyle = withAlpha(C_CAP_SIDE, a);
  ctx.fillRect(x, y, w, h);

  // 윗면.
  ctx.fillStyle = withAlpha(C_CAP_TOP, a);
  ctx.fillRect(x + 1, y + 1 + sink, w - 2, faceH - 2);
  if (accent !== undefined) {
    // 강조색은 윗면에 **얇게만** 얹는다 — 색을 채우면 라벨 대비가 무너진다.
    ctx.fillStyle = withAlpha(accent, 0.16 * a);
    ctx.fillRect(x + 1, y + 1 + sink, w - 2, faceH - 2);
  }

  if (!down) {
    // 윗면 상단·좌측 립. 이 두 줄이 평면 사각형을 키캡으로 만든다.
    ctx.fillStyle = withAlpha(C_CAP_LIP, 0.42 * a);
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillStyle = withAlpha(C_CAP_LIP, 0.22 * a);
    ctx.fillRect(x + 1, y + 1, 1, faceH - 2);
  }
  // 윗면과 스커트 사이의 그늘.
  ctx.fillStyle = withAlpha(C_BG, 0.5 * a);
  ctx.fillRect(x + 1, y + faceH - 1 + sink, w - 2, 1);

  // 라벨 — 어두운 잉크 헤일로를 깔아 어떤 판 위에서도 명도 대비를 지킨다.
  const ly = y + 1 + sink + Math.round((faceH - 2) / 2) + Math.round(size * 0.36);
  const cx = x + w / 2;
  ctx.font = font(size, 'bold');
  ctx.fillStyle = withAlpha(C_BG, 0.7 * a);
  ctx.fillText(label, cx + 1, ly + 1);
  ctx.fillStyle = withAlpha(accent ?? C_CAP_LABEL, a);
  ctx.fillText(label, cx, ly);

  return box;
}

/**
 * 터치 버튼 모양. 화면에 실제로 있는 원형 패드(`TOUCH_PADS`)와 같은 언어로 그린다 —
 * 어두운 판 + 강조색 링 + 가운데 라벨. 눌린 상태에서는 링이 굵어진다.
 */
function drawTouchPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  box: { w: number; h: number },
  label: string,
  size: number,
  a: number,
  accent: string | undefined,
  down: boolean,
): void {
  const r = box.w / 2;
  const cx = x + r;
  const cy = y + r;
  const col = accent ?? C_CAP_LIP;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(C_METAL_DARK, (down ? 0.98 : 0.9) * a);
  ctx.fill();
  if (down) {
    ctx.fillStyle = withAlpha(col, 0.28 * a);
    ctx.fill();
  }
  ctx.strokeStyle = withAlpha(col, (down ? 1 : 0.85) * a);
  ctx.lineWidth = down ? 3 : 2;
  ctx.stroke();

  ctx.font = font(size, 'bold');
  ctx.fillStyle = withAlpha(C_BG, 0.7 * a);
  ctx.fillText(label, cx + 1, cy + Math.round(size * 0.36) + 1);
  ctx.fillStyle = withAlpha(C_CAP_LABEL, a);
  ctx.fillText(label, cx, cy + Math.round(size * 0.36));
}
