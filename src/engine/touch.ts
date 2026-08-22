/**
 * 터치 입력 → **키보드와 완전히 같은 InputMask 경로**.
 *
 * 이 파일의 존재 이유는 딱 하나다: 모바일에서 녹화한 테이프가 데스크톱에서
 * 한 틱도 어긋나지 않고 재생돼야 한다. 그래서 아날로그 값은 시뮬 경계를 넘지 않는다 —
 * 조이스틱 벡터는 여기서 **8방향 비트로 양자화**되고, 그 뒤로는 키보드가 만든 마스크와
 * 구분할 방법이 없다.
 *
 * 양자화 규칙(결정론의 전제):
 * 1. 입력 좌표는 즉시 정수로 반올림된다(`Math.round(v) | 0`).
 * 2. 섹터 판정은 **정수 곱셈 비교**뿐이다. `atan2` · 나눗셈 · 부동소수 임계값 비교를
 *    쓰지 않는다 — 같은 각도가 기기·엔진에 따라 다른 비트로 떨어지면 안 된다.
 * 3. 데드존/달리기 판정도 거리의 **제곱**을 정수로 비교한다(`sqrt` 금지).
 *
 * 좌표계는 캔버스 내부 좌표(960×600) 고정이다. 화면 배율·devicePixelRatio 가 바뀌어도
 * 조작 감각과 양자화 결과가 동일해야 하므로, CSS 픽셀을 여기 들여오지 않는다.
 */
import {
  CANVAS_H,
  CANVAS_W,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
} from '../sim/constants';
import type { InputMask } from '../sim/types';
import type { Input, MetaKey } from './input';

// ── 조이스틱 기하 (캔버스 내부 좌표) ───────────────────────────────────────

/** 손을 대지 않았을 때 조이스틱 바탕이 놓여 있는 자리. 왼쪽 하단. */
export const STICK_HOME_X = 118;
export const STICK_HOME_Y = 450;
/** 바깥 링 = 노브가 갈 수 있는 최대 거리. */
export const STICK_R = 62;
/**
 * 이 거리 이상 밀면 **달리기**(IN_RUN). 안쪽은 걷기.
 * 달리기는 12틱마다 소음을 낸다 — 실수로 걸리면 억울한 구분이라 링을 시각적으로
 * 분리하고, 밴드를 넓게(42..62) 잡아 손가락이 경계에서 떨지 않게 했다.
 */
export const STICK_RUN_R = 42;
/** 이 안쪽에서는 이동 비트가 0. 미세한 떨림으로 방향이 튀지 않게 한다. */
export const STICK_DEAD_R = 12;

/** 조이스틱을 새로 잡을 수 있는 영역(왼쪽 아래). 액션 패드 판정 뒤에 검사한다. */
const STICK_ZONE_MAX_X = 430;
const STICK_ZONE_MIN_Y = 236;

/** 8방향 섹터 판정용 고정소수 스케일. sim/constants 의 TAN_SCALE 과 같은 규약. */
export const TOUCH_TAN_SCALE = 1000;
/** tan(22.5°) × 1000 = 414.21… → 414. 섹터 경계는 이 정수 하나로 결정된다. */
export const TOUCH_TAN_22_5 = 414;

/** 유한하지 않은 값은 0 으로. `| 0` 은 `-0` 을 `0` 으로 정규화하기도 한다. */
function toInt(v: number): number {
  return Number.isFinite(v) ? Math.round(v) | 0 : 0;
}

/**
 * 조이스틱 벡터 → InputMask. **이 함수가 이 파일의 계약 전부다.**
 *
 * @param dx 조이스틱 중심에서의 가로 변위(캔버스 단위, 오른쪽 +)
 * @param dy 세로 변위(아래 +)
 * @returns 이동 비트 조합 + 선택적 `IN_RUN`. 그 외 비트는 절대 섞이지 않는다.
 *
 * 섹터는 45°씩 8개이고 경계는 22.5° 의 홀수배다. 경계값(정확히 22.5°)은
 * **축 방향 쪽**에 속한다 — `<=` 로 못박아 두 판정이 동시에 참이 되는 각도가 없다.
 */
export function quantizeStick(dx: number, dy: number): InputMask {
  const ix = toInt(dx);
  const iy = toInt(dy);
  const d2 = ix * ix + iy * iy;
  if (d2 < STICK_DEAD_R * STICK_DEAD_R) return 0;

  const ax = ix < 0 ? -ix : ix;
  const ay = iy < 0 ? -iy : iy;
  // 가로축만 / 세로축만 / 둘 다(대각). 두 조건이 함께 참이 되는 정수쌍은
  // 원점뿐이며 원점은 위에서 데드존으로 걸러졌다.
  const horizOnly = ay * TOUCH_TAN_SCALE <= ax * TOUCH_TAN_22_5;
  const vertOnly = ax * TOUCH_TAN_SCALE <= ay * TOUCH_TAN_22_5;

  let m = 0;
  if (!vertOnly) m |= ix > 0 ? IN_RIGHT : IN_LEFT;
  if (!horizOnly) m |= iy > 0 ? IN_DOWN : IN_UP;
  // 링 밖 = 달리기. 데드존을 넘긴 뒤에만 도달하므로 IN_RUN 은 언제나 이동 비트를 동반한다.
  if (d2 >= STICK_RUN_R * STICK_RUN_R) m |= IN_RUN;
  return m;
}

/** 노브를 바깥 링 안으로 눌러 담는다. 렌더 전용 — 양자화는 원본 벡터로 한다. */
export function clampKnob(dx: number, dy: number): { x: number; y: number } {
  const d2 = dx * dx + dy * dy;
  const max2 = STICK_R * STICK_R;
  if (d2 <= max2 || d2 === 0) return { x: dx, y: dy };
  const k = STICK_R / Math.sqrt(d2);
  return { x: dx * k, y: dy * k };
}

// ── 화면 조작 패드 ─────────────────────────────────────────────────────────

export type PadId =
  | 'COMMIT'
  | 'INTERACT'
  | 'OVERWRITE'
  | 'RESET'
  | 'PAUSE'
  | 'SLOT1'
  | 'SLOT2'
  | 'SLOT3'
  | 'CANCEL';

export interface TouchPad {
  id: PadId;
  /** 원형 패드: cx/cy/r. 사각 패드: x/y/w/h. */
  shape: 'circle' | 'rect';
  cx: number;
  cy: number;
  r: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub: string;
}

function circle(id: PadId, cx: number, cy: number, r: number, label: string, sub = ''): TouchPad {
  return { id, shape: 'circle', cx, cy, r, x: cx - r, y: cy - r, w: r * 2, h: r * 2, label, sub };
}

function rect(id: PadId, x: number, y: number, w: number, h: number, label: string, sub = ''): TouchPad {
  return { id, shape: 'rect', cx: x + w / 2, cy: y + h / 2, r: 0, x, y, w, h, label, sub };
}

/**
 * PLAY 중의 액션 패드. 오른쪽 하단에 모아 두되 **조작 중인 몸(I)이 있는 화면 중앙과
 * 하단 HUD 밴드의 수치(ALERTS/DEBT)를 가리지 않는** 자리로 잡았다.
 * `COMMIT` 이 압도적으로 큰 이유는 이 게임의 핵심 동작이기 때문이다.
 */
export const TOUCH_PADS: readonly TouchPad[] = [
  circle('COMMIT', 862, 492, 54, 'COMMIT', '잔상 남기기'),
  circle('INTERACT', 754, 442, 36, 'E', '상호작용'),
  circle('OVERWRITE', 754, 524, 32, 'Q', '덮어쓰기'),
  circle('RESET', 926, 398, 26, '⟲', '초기화'),
  circle('PAUSE', 926, 74, 21, 'II', ''),
];

/**
 * 덮어쓰기 슬롯 선택 오버레이의 탭 대상. 데스크톱의 작은 명찰(96×30)은 손가락에
 * 너무 작아, 터치에서는 이 큰 기하를 **hud 가 그대로 그린다**(중복 정의 금지).
 */
export const PICK_PADS: readonly TouchPad[] = [
  rect('SLOT1', 112, 270, 232, 92, '1', 'MY'),
  rect('SLOT2', 364, 270, 232, 92, '2', 'ME'),
  rect('SLOT3', 616, 270, 232, 92, '3', 'MINE'),
  rect('CANCEL', 380, 376, 200, 40, 'CANCEL', ''),
];

/** 선택 오버레이 패널(터치 전용 확대판). hud 가 이 사각형에 판을 깐다. */
export const PICK_PANEL = { x: 60, y: 170, w: 840, h: 260 } as const;

/** 패드가 만들어내는 메타 엣지. 없으면 마스크 비트이거나 홀드 전용이다. */
const PAD_META: Readonly<Partial<Record<PadId, MetaKey>>> = {
  COMMIT: 'COMMIT',
  OVERWRITE: 'OVERWRITE',
  PAUSE: 'PAUSE',
  SLOT1: 'SLOT1',
  SLOT2: 'SLOT2',
  SLOT3: 'SLOT3',
  // 취소는 Q 를 다시 누른 것과 같다 — handleMeta 가 토글로 처리한다.
  CANCEL: 'OVERWRITE',
};

function hitPad(pad: TouchPad, x: number, y: number): boolean {
  if (pad.shape === 'circle') {
    const dx = x - pad.cx;
    const dy = y - pad.cy;
    return dx * dx + dy * dy <= pad.r * pad.r;
  }
  return x >= pad.x && x <= pad.x + pad.w && y >= pad.y && y <= pad.y + pad.h;
}

// ── 컨트롤러 ───────────────────────────────────────────────────────────────

/**
 * 지금 어떤 패드 묶음이 살아 있는가.
 * `PLAY` = 조이스틱 + 액션 패드, `PICK` = 슬롯 선택만, `NONE` = 전부 탭으로 흘린다.
 */
export type TouchContext = 'PLAY' | 'PICK' | 'NONE';

export interface TouchTap {
  x: number;
  y: number;
}

/** hud 가 그리는 데 필요한 것 전부. 상태를 복사해 넘긴다(외부에서 못 바꾼다). */
export interface TouchView {
  context: TouchContext;
  stickActive: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  running: boolean;
  mask: InputMask;
  down: readonly PadId[];
}

export interface TouchInput extends Input {
  /** 터치 기기로 판정됐는가. `(pointer: coarse)` 또는 첫 터치 이벤트. */
  isTouch(): boolean;
  /** 어떤 패드 묶음을 살릴지. 매 틱 세션 상태에서 갱신한다. */
  setContext(c: TouchContext): void;
  /** 패드가 먹지 않은 탭(메뉴·오버레이용). 한 번 읽으면 큐에서 사라진다. */
  consumeTaps(): TouchTap[];
  view(): TouchView;
}

export interface TouchOptions {
  canvas: HTMLCanvasElement;
  /** 터치 기기로 처음 판정된 순간 알림(레이아웃·UI 전환용). */
  onTouchDetected?: () => void;
}

/** 이 거리(캔버스 단위) 이상 끌면 탭이 아니다 — 스와이프로 메뉴가 눌리면 안 된다. */
const TAP_SLOP = 26;

/**
 * 클라이언트 좌표 → 캔버스 내부 좌표(960×600).
 *
 * `getBoundingClientRect` 를 기준으로 하므로 CSS 배율·letterbox·devicePixelRatio 가
 * 어떻게 잡혀도 결과가 같다. 화면 밖 좌표는 그대로 음수/초과로 돌려준다 —
 * 히트테스트가 알아서 떨어뜨린다.
 */
export function canvasPoint(
  cv: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): TouchTap {
  const r = cv.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { x: -1, y: -1 };
  return {
    x: ((clientX - r.left) * CANVAS_W) / r.width,
    y: ((clientY - r.top) * CANVAS_H) / r.height,
  };
}

type Role = { kind: 'stick' } | { kind: 'pad'; id: PadId } | { kind: 'tap'; x: number; y: number; ok: boolean };

export function createTouch(opts: TouchOptions): TouchInput {
  const cv = opts.canvas;

  let context: TouchContext = 'NONE';
  let touchSeen = coarsePointer();
  const roles = new Map<number, Role>();
  /**
   * 살아 있는 포인터의 마지막 캔버스 좌표. 컨텍스트가 바뀔 때 이 좌표로
   * 배역을 다시 정한다 — 화면에 남아 있는 손가락이 영구 무효가 되면 안 된다.
   */
  const lastPoint = new Map<number, TouchTap>();
  /** 지금 눌려 있는 패드. 같은 패드를 두 손가락이 누를 수 있어 카운트로 센다. */
  const downCount = new Map<PadId, number>();
  const pressed = new Set<MetaKey>();
  const taps: TouchTap[] = [];

  let stickId = -1;
  let baseX = STICK_HOME_X;
  let baseY = STICK_HOME_Y;
  let dx = 0;
  let dy = 0;

  function activePads(): readonly TouchPad[] {
    if (context === 'PLAY') return TOUCH_PADS;
    if (context === 'PICK') return PICK_PADS;
    return [];
  }

  function toCanvas(clientX: number, clientY: number): TouchTap {
    return canvasPoint(cv, clientX, clientY);
  }

  function markTouch(type: string): void {
    // 'touch' 만 터치다 — pen 은 정밀 포인터라 터치 UI 로 전환하면 안 된다.
    if (touchSeen || type !== 'touch') return;
    touchSeen = true;
    opts.onTouchDetected?.();
  }

  function padDown(id: PadId): boolean {
    return (downCount.get(id) ?? 0) > 0;
  }

  function inStickZone(x: number, y: number): boolean {
    return context === 'PLAY' && stickId < 0 && x >= 0 && x <= STICK_ZONE_MAX_X && y >= STICK_ZONE_MIN_Y;
  }

  /** 손을 댄 자리가 곧 중심이다. 다만 바탕이 화면 밖으로 새어나가지 않게 눌러 담는다. */
  function grabStick(pointerId: number, x: number, y: number): void {
    const m = STICK_R + 6;
    baseX = Math.max(m, Math.min(CANVAS_W - m, x));
    baseY = Math.max(m, Math.min(CANVAS_H - m, y));
    dx = 0;
    dy = 0;
    stickId = pointerId;
    roles.set(pointerId, { kind: 'stick' });
    try {
      cv.setPointerCapture(pointerId);
    } catch {
      // 캡처는 편의 기능이다 — 실패해도 pointerup 은 그대로 온다.
    }
  }

  const onDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    markTouch(e.pointerType);
    const p = toCanvas(e.clientX, e.clientY);
    lastPoint.set(e.pointerId, p);

    for (const pad of activePads()) {
      if (!hitPad(pad, p.x, p.y)) continue;
      e.preventDefault();
      roles.set(e.pointerId, { kind: 'pad', id: pad.id });
      downCount.set(pad.id, (downCount.get(pad.id) ?? 0) + 1);
      const meta = PAD_META[pad.id];
      // 엣지는 **누르는 순간** 낸다. 손을 뗄 때 내면 반응이 한 박자 늦게 느껴진다.
      if (meta !== undefined) pressed.add(meta);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // 위와 같음
      }
      return;
    }

    if (inStickZone(p.x, p.y)) {
      e.preventDefault();
      grabStick(e.pointerId, p.x, p.y);
      return;
    }

    roles.set(e.pointerId, { kind: 'tap', x: p.x, y: p.y, ok: true });
  };

  const onMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    const role = roles.get(e.pointerId);
    if (role === undefined) return;
    const p = toCanvas(e.clientX, e.clientY);
    lastPoint.set(e.pointerId, p);
    if (role.kind === 'stick') {
      e.preventDefault();
      dx = p.x - baseX;
      dy = p.y - baseY;
      return;
    }
    if (role.kind === 'tap') {
      const mx = p.x - role.x;
      const my = p.y - role.y;
      if (mx * mx + my * my > TAP_SLOP * TAP_SLOP) role.ok = false;
      return;
    }
    // 패드는 손가락이 벗어나도 놓지 않는다 — 미끄러짐으로 COMMIT 이 풀리면 치명적이다.
    e.preventDefault();
  };

  const release = (pointerId: number, canceled: boolean): void => {
    const role = roles.get(pointerId);
    lastPoint.delete(pointerId);
    if (role === undefined) return;
    roles.delete(pointerId);
    if (role.kind === 'stick') {
      stickId = -1;
      dx = 0;
      dy = 0;
      baseX = STICK_HOME_X;
      baseY = STICK_HOME_Y;
      return;
    }
    if (role.kind === 'pad') {
      const n = (downCount.get(role.id) ?? 1) - 1;
      if (n <= 0) downCount.delete(role.id);
      else downCount.set(role.id, n);
      return;
    }
    if (!canceled && role.ok) taps.push({ x: role.x, y: role.y });
  };

  const onUp = (ev: Event): void => {
    const e = ev as PointerEvent;
    release(e.pointerId, false);
  };

  const onCancel = (ev: Event): void => {
    const e = ev as PointerEvent;
    release(e.pointerId, true);
  };

  /**
   * 현재 포인터를 전부 놓는다. Safari 가 페이지를 보관하거나 제어 센터로 나갈 때
   * pointercancel 없이 캡처만 남는 경우에도 다음 손가락이 새 입력으로 시작해야 한다.
   */
  const clearHeldPointers = (): void => {
    for (const pointerId of roles.keys()) {
      try {
        cv.releasePointerCapture(pointerId);
      } catch {
        // 이미 브라우저가 캡처를 반납했으면 할 일이 없다.
      }
    }
    roles.clear();
    lastPoint.clear();
    downCount.clear();
    stickId = -1;
    dx = 0;
    dy = 0;
    baseX = STICK_HOME_X;
    baseY = STICK_HOME_Y;
  };

  /**
   * 컨텍스트가 바뀐 뒤에도 화면에 남아 있는 손가락에게 새 묶음 기준의 배역을 다시 준다.
   *
   * - 스틱 존(PLAY): 마지막 좌표에서 새로 잡은 것처럼 스틱을 grab 한다 — 스틱을 잡은 채
   *   묶음이 스쳐 지나가도(루프 전환 등) 이동이 끊기지 않는다.
   * - 패드 위: 홀드가 전환을 살아 넘으면 오발이 된다(원래 clearHeldPointers 의 의도).
   *   패드 배역·엣지는 **새 down 부터만** 유효하다 — 탭 배역으로 강등한다.
   * - 그 외: 탭 배역. 단 `ok:false` — 전환 전 정황으로 시작한 손가락이 유령 탭을
   *   만들면 안 된다.
   */
  const rebindPointers = (): void => {
    const survivors: [number, TouchTap][] = [];
    for (const pointerId of roles.keys()) {
      const p = lastPoint.get(pointerId);
      if (p !== undefined) survivors.push([pointerId, p]);
    }
    roles.clear();
    downCount.clear();
    stickId = -1;
    dx = 0;
    dy = 0;
    baseX = STICK_HOME_X;
    baseY = STICK_HOME_Y;
    for (const [pointerId, p] of survivors) {
      const onPad = activePads().some((pad) => hitPad(pad, p.x, p.y));
      if (!onPad && inStickZone(p.x, p.y)) {
        grabStick(pointerId, p.x, p.y);
        continue;
      }
      roles.set(pointerId, { kind: 'tap', x: p.x, y: p.y, ok: false });
    }
  };

  /** 포커스/페이지 경계를 넘는 입력은 엣지와 탭까지 함께 버린다. */
  const resetTransient = (): void => {
    clearHeldPointers();
    pressed.clear();
    taps.length = 0;
  };

  /** 창이 포커스를 잃으면 손가락이 붙잡고 있던 상태가 남아 계속 걷는다. */
  const onBlur = (): void => resetTransient();
  /** Safari back/forward cache 에서 돌아와도 이전 포인터 캡처를 재사용하지 않는다. */
  const onPageLifecycle = (): void => resetTransient();

  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageLifecycle);
  window.addEventListener('pageshow', onPageLifecycle);

  return {
    mask(): InputMask {
      if (context !== 'PLAY') return 0;
      let m = stickId >= 0 ? quantizeStick(dx, dy) : 0;
      if (padDown('INTERACT')) m |= IN_INTERACT;
      return m;
    },

    consumePressed(key: MetaKey): boolean {
      if (!pressed.has(key)) return false;
      pressed.delete(key);
      return true;
    },

    isHeld(key: MetaKey): boolean {
      // 초기화만 홀드 판정이 필요하다(2초). 나머지는 엣지로만 쓰인다.
      return key === 'RESET' ? padDown('RESET') : false;
    },

    flush(): void {
      // 동결 직전에 쌓인 입력이 언블록 첫 틱에 터지면 안 된다 — 엣지와 탭을 함께 버린다.
      pressed.clear();
      taps.length = 0;
    },

    destroy(): void {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageLifecycle);
      window.removeEventListener('pageshow', onPageLifecycle);
      resetTransient();
    },

    isTouch(): boolean {
      return touchSeen;
    },

    setContext(c: TouchContext): void {
      if (c === context) return;
      context = c;
      // 묶음이 바뀌면 붙잡고 있던 패드는 의미가 없다 — 홀드는 끊는다. 하지만 손가락
      // 자체는 아직 화면에 있으니 죽이지 않고 새 묶음 기준으로 배역만 다시 준다
      // (스틱 존이면 그 자리에서 스틱 grab). 엣지 큐는 남긴다 — PICK 을 여는
      // Q 엣지가 여기서 사라지면 안 된다.
      rebindPointers();
    },

    consumeTaps(): TouchTap[] {
      if (taps.length === 0) return [];
      return taps.splice(0, taps.length);
    },

    view(): TouchView {
      const k = clampKnob(dx, dy);
      const m = stickId >= 0 ? quantizeStick(dx, dy) : 0;
      return {
        context,
        stickActive: stickId >= 0,
        baseX,
        baseY,
        knobX: baseX + k.x,
        knobY: baseY + k.y,
        running: (m & IN_RUN) !== 0,
        mask: m,
        down: [...downCount.keys()],
      };
    },
  };
}

/** 손가락 기기인지 미리 알 수 있으면 첫 터치를 기다리지 않고 UI 를 띄운다. */
function coarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * 두 입력원을 하나로 합친다. 마스크는 OR 이지만 **상쇄 규칙을 다시 적용**한다 —
 * 키보드가 UP, 터치가 DOWN 을 내면 축이 살아 있는 채로 시뮬에 들어가고,
 * 그러면 대각 상수(WALK_DIAG)가 맞지 않는다.
 */
export function mergeInput(a: Input, b: Input): Input {
  return {
    mask(): InputMask {
      let m = a.mask() | b.mask();
      if ((m & IN_UP) !== 0 && (m & IN_DOWN) !== 0) m &= ~(IN_UP | IN_DOWN);
      if ((m & IN_LEFT) !== 0 && (m & IN_RIGHT) !== 0) m &= ~(IN_LEFT | IN_RIGHT);
      return m;
    },
    consumePressed(key: MetaKey): boolean {
      // 양쪽을 **모두** 소비해야 한다. `a() || b()` 는 단축 평가로 b 의 엣지를
      // 큐에 남기고, 그 엣지는 다음 페이즈에서 뒤늦게 터진다.
      const x = a.consumePressed(key);
      const y = b.consumePressed(key);
      return x || y;
    },
    isHeld(key: MetaKey): boolean {
      return a.isHeld(key) || b.isHeld(key);
    },
    flush(): void {
      a.flush();
      b.flush();
    },
    destroy(): void {
      a.destroy();
      b.destroy();
    },
  };
}
