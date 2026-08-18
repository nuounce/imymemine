/**
 * 키보드 → InputMask + 메타키 엣지 트리거.
 *
 * 중요한 구분(SPEC §4): **이동/상호작용/달리기만 테이프에 녹화된다.**
 * R(확정) · Q(덮어쓰기) · 1/2/3 · Backspace · Esc · Enter · M 은 세션을 조작하는
 * 메타 조작이라 마스크에 절대 섞이면 안 된다. 섞이면 재생 시 잔상이 루프를
 * 확정하려 드는 등 시뮬이 오염된다. 그래서 메타키는 별도 엣지 큐로만 노출한다.
 */
import {
  IN_DOWN,
  IN_FLASH,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
} from '../sim/constants';
import type { InputMask } from '../sim/types';

/** 테이프에 녹화되지 않는 세션 제어 키. */
export type MetaKey =
  | 'COMMIT' // R — 루프 조기 확정
  | 'OVERWRITE' // Q — 덮어쓰기 모드 진입
  | 'SLOT1' // 1 — MY 슬롯
  | 'SLOT2' // 2 — ME 슬롯
  | 'SLOT3' // 3 — MINE 슬롯
  | 'RESET' // Backspace — 2초 홀드로 전체 초기화
  | 'PAUSE' // Esc
  | 'START' // Enter — 시작 / 다음 스테이지
  | 'MUTE' // M
  | 'HELP'; // H / ? — 조작법 패널 열고 닫기

export interface Input {
  /** 이번 틱의 녹화 대상 입력 비트마스크. */
  mask(): InputMask;
  /** 마지막 호출 이후 새로 눌린 적이 있으면 true 를 1회만 돌려준다(엣지). */
  consumePressed(key: MetaKey): boolean;
  /** 지금 물리적으로 눌려 있는가(홀드 판정용). */
  isHeld(key: MetaKey): boolean;
  /** 큐에 쌓인 모든 엣지를 버린다. 페이즈 전환 직후 오입력 방지용. */
  flush(): void;
  destroy(): void;
}

/** code → 마스크 비트. WASD 와 방향키를 동등하게 취급한다. */
const MASK_BY_CODE: Readonly<Record<string, number>> = {
  KeyW: IN_UP,
  ArrowUp: IN_UP,
  KeyS: IN_DOWN,
  ArrowDown: IN_DOWN,
  KeyA: IN_LEFT,
  ArrowLeft: IN_LEFT,
  KeyD: IN_RIGHT,
  ArrowRight: IN_RIGHT,
  KeyE: IN_INTERACT,
  // 눈뽕은 한 번 누르면 끝이다. world.ts 가 올라가는 엣지에서만 소비하므로
  // 눌러도 연발되지 않는다 — 소지가 없으면 아무 일도 없다.
  KeyF: IN_FLASH,
  ShiftLeft: IN_RUN,
  ShiftRight: IN_RUN,
};

const META_BY_CODE: Readonly<Record<string, MetaKey>> = {
  KeyR: 'COMMIT',
  KeyQ: 'OVERWRITE',
  Digit1: 'SLOT1',
  Numpad1: 'SLOT1',
  Digit2: 'SLOT2',
  Numpad2: 'SLOT2',
  Digit3: 'SLOT3',
  Numpad3: 'SLOT3',
  Backspace: 'RESET',
  Escape: 'PAUSE',
  Enter: 'START',
  NumpadEnter: 'START',
  KeyM: 'MUTE',
  KeyH: 'HELP',
  Slash: 'HELP',
};

/** 눌렸을 때 브라우저 기본 동작을 막아야 하는 키(뒤로가기·스크롤·검색 등). */
const SWALLOW = new Set([
  'Backspace',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Enter',
  'Slash',
  'Quote',
]);

export function createInput(target: EventTarget = window): Input {
  const held = new Set<string>();
  /** 아직 소비되지 않은 메타키 엣지. */
  const pressed = new Set<MetaKey>();

  const onKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (SWALLOW.has(e.code)) e.preventDefault();
    // 브라우저/OS 단축키(Cmd+R, Ctrl+W …)는 게임 입력으로 가로채지 않는다.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // repeat 이벤트는 홀드 유지에만 쓰고 엣지로는 치지 않는다.
    if (e.repeat) return;

    held.add(e.code);
    const meta = META_BY_CODE[e.code];
    if (meta !== undefined) pressed.add(meta);
  };

  const onKeyUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (SWALLOW.has(e.code)) e.preventDefault();
    held.delete(e.code);
  };

  /** 포커스를 잃으면 키를 붙잡고 있던 상태가 남아 캐릭터가 계속 걷는다. */
  const onBlur = (): void => {
    held.clear();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const isCodeHeldForMeta = (key: MetaKey): boolean => {
    for (const code of Object.keys(META_BY_CODE)) {
      if (META_BY_CODE[code] === key && held.has(code)) return true;
    }
    return false;
  };

  return {
    mask(): InputMask {
      let m = 0;
      for (const code of held) {
        const bit = MASK_BY_CODE[code];
        if (bit !== undefined) m |= bit;
      }
      // 상하 / 좌우 동시 입력은 서로 상쇄시킨다. 이렇게 해야 시뮬이
      // "축별 부호"만 보면 되고, 대각 상수(WALK_DIAG)가 항상 정확히 맞는다.
      if ((m & IN_UP) !== 0 && (m & IN_DOWN) !== 0) m &= ~(IN_UP | IN_DOWN);
      if ((m & IN_LEFT) !== 0 && (m & IN_RIGHT) !== 0) m &= ~(IN_LEFT | IN_RIGHT);
      return m;
    },

    consumePressed(key: MetaKey): boolean {
      if (!pressed.has(key)) return false;
      pressed.delete(key);
      return true;
    },

    isHeld(key: MetaKey): boolean {
      return isCodeHeldForMeta(key);
    },

    flush(): void {
      pressed.clear();
    },

    destroy(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
      pressed.clear();
    },
  };
}
