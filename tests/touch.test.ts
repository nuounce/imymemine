/**
 * 터치 입력 결정론 테스트 (SPEC §4 · §6).
 *
 * 터치가 존재해도 좋은 유일한 조건: **시뮬이 터치를 구분할 수 없다.**
 * 조이스틱 각도는 `quantizeStick` 에서 8방향 비트로 양자화되고, 그 뒤로는
 * 키보드가 만든 마스크와 완전히 같은 값이어야 한다. 그래서 이 파일은
 * "대충 비슷하다"가 아니라 **마스크 열의 완전 일치 + 상태 해시 일치**를 요구한다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// createInput 은 포커스 손실 처리를 위해 `window` 에 blur 리스너를 건다.
// Node 에는 window 가 없으므로, 실제 코드를 그대로 태우기 위해 최소 스텁을 먼저 세운다.
// (EventTarget 이면 충분하다 — createInput 이 window 에서 쓰는 것은 add/removeEventListener 뿐이다.)
if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
}

import { STAGES } from '../src/game/levels';
import { createInput } from '../src/engine/input';
import {
  clampKnob,
  mergeInput,
  PICK_PADS,
  quantizeStick,
  STICK_DEAD_R,
  STICK_R,
  STICK_RUN_R,
  TOUCH_PADS,
  TOUCH_TAN_22_5,
  TOUCH_TAN_SCALE,
} from '../src/engine/touch';
import {
  CANVAS_H,
  CANVAS_W,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import type { InputMask } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';

const MOVE_BITS = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;
/** 조이스틱이 만들 수 있는 비트의 전부. 이 밖의 비트가 섞이면 테이프가 오염된다. */
const STICK_BITS = MOVE_BITS | IN_RUN;

/** 마스크를 사람이 읽는 이름으로. 실패 메시지가 숫자면 원인 추적이 안 된다. */
function names(m: InputMask): string {
  const out: string[] = [];
  if ((m & IN_UP) !== 0) out.push('UP');
  if ((m & IN_DOWN) !== 0) out.push('DOWN');
  if ((m & IN_LEFT) !== 0) out.push('LEFT');
  if ((m & IN_RIGHT) !== 0) out.push('RIGHT');
  if ((m & IN_INTERACT) !== 0) out.push('INTERACT');
  if ((m & IN_RUN) !== 0) out.push('RUN');
  return out.length === 0 ? '(none)' : out.join('|');
}

// ── 1. 8방향 양자화 경계값 표 ──────────────────────────────────────────────

/**
 * `[dx, dy, 기대 마스크, 설명]`.
 *
 * 경계는 22.5° 의 홀수배이고, 판정은 `ay*1000 <= ax*414` 형태의 **정수 비교**다.
 * 그래서 경계 바로 앞/뒤의 정수 좌표가 어느 섹터로 떨어지는지가 못박혀 있다 —
 * 이 표가 그 계약이다. 값을 바꾸면 과거에 녹화된 테이프의 의미가 달라진다.
 */
const TABLE: readonly [number, number, InputMask, string][] = [
  // 8방향 대표값 (걷기 반경)
  [30, 0, IN_RIGHT, '오른쪽 (0°)'],
  [21, 21, IN_RIGHT | IN_DOWN, '오른쪽아래 (45°)'],
  [0, 30, IN_DOWN, '아래 (90°)'],
  [-21, 21, IN_LEFT | IN_DOWN, '왼쪽아래 (135°)'],
  [-30, 0, IN_LEFT, '왼쪽 (180°)'],
  [-21, -21, IN_LEFT | IN_UP, '왼쪽위 (225°)'],
  [0, -30, IN_UP, '위 (270°)'],
  [21, -21, IN_RIGHT | IN_UP, '오른쪽위 (315°)'],

  // 22.5° 경계 — 축 쪽 / 대각 쪽
  [30, 12, IN_RIGHT, '21.8° — 22.5° 미달이라 축만'],
  [30, 13, IN_RIGHT | IN_DOWN, '23.4° — 22.5° 초과라 대각'],
  [12, 30, IN_DOWN, '68.2° — 67.5° 초과라 축만'],
  [13, 30, IN_RIGHT | IN_DOWN, '66.6° — 67.5° 미달이라 대각'],

  // 정확히 경계에 놓인 정수쌍(ay*1000 == ax*414). 경계는 **축 쪽**에 속한다.
  [500, 207, IN_RIGHT | IN_RUN, '정확히 22.5° 경계 → 축'],
  [207, 500, IN_DOWN | IN_RUN, '정확히 67.5° 경계 → 축'],
  [-500, -207, IN_LEFT | IN_RUN, '경계, 3사분면 → 축'],

  // 데드존
  [0, 0, 0, '중심 — 이동 없음'],
  [11, 0, 0, `반경 11 < 데드존 ${STICK_DEAD_R}`],
  [8, 8, 0, '반경 11.3 — 데드존 안(제곱 비교 128 < 144)'],
  [12, 0, IN_RIGHT, `반경 12 = 데드존 경계 → 살아난다`],
  // 판정은 제곱거리 정수 비교다: 64+81=145 ≥ 144 이므로 데드존을 넘긴다.
  [-8, -9, IN_UP | IN_LEFT, '반경 12.04 — 데드존 바로 밖, 대각'],

  // 달리기 링
  [41, 0, IN_RIGHT, `반경 41 < 링 ${STICK_RUN_R} → 걷기`],
  [42, 0, IN_RIGHT | IN_RUN, `반경 42 = 링 → 달리기`],
  [29, 29, IN_RIGHT | IN_DOWN, '반경 41.0 → 대각 걷기'],
  [30, 30, IN_RIGHT | IN_DOWN | IN_RUN, '반경 42.4 → 대각 달리기'],

  // 반올림: 정수화가 먼저 일어난다
  [11.6, 0, IN_RIGHT, '11.6 → 12 로 반올림되어 데드존을 넘는다'],
  [11.4, 0, 0, '11.4 → 11 로 반올림되어 데드존 안'],
];

describe('터치: 8방향 양자화', () => {
  it('경계값 표가 정확히 재현된다', () => {
    for (const [dx, dy, want, why] of TABLE) {
      const got = quantizeStick(dx, dy);
      assert.equal(
        got,
        want,
        `(${dx}, ${dy}) ${why}: ${names(got)} 이 나왔지만 ${names(want)} 여야 한다`,
      );
    }
  });

  it('같은 입력은 몇 번을 물어도 같은 마스크다 (부동소수 임계값 비교 없음)', () => {
    // 0.5° 씩 720 방향 × 반경 5종 = 3600 표본을 두 번 훑어 바이트 단위로 비교한다.
    const radii = [6, 12, 30, 41, 42, 61, 200];
    const passA: number[] = [];
    const passB: number[] = [];
    for (let step = 0; step < 720; step++) {
      const ang = (step * Math.PI) / 360;
      for (const r of radii) {
        const dx = Math.cos(ang) * r;
        const dy = Math.sin(ang) * r;
        passA.push(quantizeStick(dx, dy));
        passB.push(quantizeStick(dx, dy));
      }
    }
    assert.deepEqual(passA, passB);
    // 표본이 실제로 8방향 전부(+정지)를 덮었는지 확인 — 통과했지만 아무것도 안 본
    // 테스트가 되지 않게. 8방향 × (걷기 | 달리기) + 정지 = 17 종.
    assert.equal(new Set(passA).size, 17, '8방향 × 걷기/달리기 + 정지');
  });

  it('경계 상수는 tan(22.5°) 를 정수로 고정한 값이다', () => {
    // 이 상수가 흔들리면 과거 테이프의 의미가 바뀐다. 값 자체를 못박는다.
    assert.equal(TOUCH_TAN_SCALE, 1000);
    assert.equal(TOUCH_TAN_22_5, 414);
    assert.equal(Math.round(Math.tan(Math.PI / 8) * TOUCH_TAN_SCALE), TOUCH_TAN_22_5);
  });
});

// ── 2. 마스크 유효성 ───────────────────────────────────────────────────────

describe('터치: 양자화 결과는 항상 유효한 마스크다', () => {
  it('이동 비트 조합 + 선택적 RUN 뿐이고, 축이 상충하지 않는다', () => {
    for (let step = 0; step < 1440; step++) {
      const ang = (step * Math.PI) / 720;
      for (const r of [0, 3, 11, 12, 20, 41, 42, 62, 400]) {
        const dx = Math.cos(ang) * r;
        const dy = Math.sin(ang) * r;
        const m = quantizeStick(dx, dy);

        assert.equal(m & ~STICK_BITS, 0, `(${dx},${dy}) 에서 허용되지 않은 비트: ${names(m)}`);
        assert.notEqual(
          m & (IN_UP | IN_DOWN),
          IN_UP | IN_DOWN,
          `(${dx},${dy}) 상하 동시 입력: ${names(m)}`,
        );
        assert.notEqual(
          m & (IN_LEFT | IN_RIGHT),
          IN_LEFT | IN_RIGHT,
          `(${dx},${dy}) 좌우 동시 입력: ${names(m)}`,
        );
        // RUN 은 절대 혼자 오지 않는다 — 제자리 달리기는 시뮬에 없는 상태다.
        if ((m & IN_RUN) !== 0) {
          assert.notEqual(m & MOVE_BITS, 0, `(${dx},${dy}) 이동 없는 RUN: ${names(m)}`);
        }
      }
    }
  });

  it('마이크 비트(6~7)와 상호작용 비트는 조이스틱에서 나오지 않는다', () => {
    // 마이크 2비트가 조이스틱에서 위조되면 잔상이 없는 소리를 영구히 녹화한다.
    for (let step = 0; step < 360; step++) {
      const ang = (step * Math.PI) / 180;
      const m = quantizeStick(Math.cos(ang) * 300, Math.sin(ang) * 300);
      assert.equal(m & IN_INTERACT, 0);
      assert.equal(m >> 6, 0);
    }
  });
});

// ── 3. 달리기 링 (대조군 포함) ─────────────────────────────────────────────

describe('터치: 바깥 링에서만 달린다', () => {
  it('같은 각도에서 링 안쪽은 RUN 이 없고 링 밖은 RUN 이 붙는다', () => {
    for (let step = 0; step < 64; step++) {
      // 섹터 경계(22.5° 의 홀수배)를 정확히 밟지 않도록 반칸 비켜 간다. 경계각에서는
      // 반경이 달라지면 정수 반올림 결과가 경계의 반대쪽으로 넘어갈 수 있고(결정론적
      // 이지만) 그건 "링을 넘으면 속도만 바뀐다"와는 다른 이야기다.
      const ang = ((step + 0.5) * Math.PI * 2) / 64;
      const inner = quantizeStick(
        Math.cos(ang) * (STICK_RUN_R - 6),
        Math.sin(ang) * (STICK_RUN_R - 6),
      );
      const outer = quantizeStick(
        Math.cos(ang) * (STICK_RUN_R + 6),
        Math.sin(ang) * (STICK_RUN_R + 6),
      );
      assert.equal(inner & IN_RUN, 0, `${step}: 링 안쪽에서 RUN 이 붙었다 (${names(inner)})`);
      assert.equal(outer & IN_RUN, IN_RUN, `${step}: 링 밖에서 RUN 이 없다 (${names(outer)})`);
      // 링을 넘는 것은 **속도뿐**이다 — 방향 비트는 그대로여야 한다.
      assert.equal(
        inner & MOVE_BITS,
        outer & MOVE_BITS,
        `${step}: 링을 넘자 방향이 바뀌었다 ${names(inner)} → ${names(outer)}`,
      );
    }
  });

  it('데드존 · 걷기 · 달리기 구간이 반경 순서대로 나뉜다', () => {
    assert.ok(STICK_DEAD_R < STICK_RUN_R && STICK_RUN_R < STICK_R);
    assert.equal(quantizeStick(STICK_DEAD_R - 1, 0), 0);
    assert.equal(quantizeStick(STICK_DEAD_R, 0), IN_RIGHT);
    assert.equal(quantizeStick(STICK_RUN_R - 1, 0), IN_RIGHT);
    assert.equal(quantizeStick(STICK_RUN_R, 0), IN_RIGHT | IN_RUN);
  });

  it('노브는 바깥 링 안으로만 움직인다 (렌더 전용 클램프)', () => {
    const far = clampKnob(300, -400);
    const r = Math.hypot(far.x, far.y);
    assert.ok(Math.abs(r - STICK_R) < 1e-9, `클램프 반경 ${r} ≠ ${STICK_R}`);
    // 방향은 보존된다.
    assert.ok(far.x > 0 && far.y < 0);
    // 링 안쪽 값은 손대지 않는다.
    assert.deepEqual(clampKnob(10, -20), { x: 10, y: -20 });
    assert.deepEqual(clampKnob(0, 0), { x: 0, y: 0 });
  });
});

// ── 4. 데드존 ──────────────────────────────────────────────────────────────

describe('터치: 데드존 안에서는 이동 비트가 0', () => {
  it('반경이 데드존 미만인 모든 각도에서 마스크가 0 이다', () => {
    for (let step = 0; step < 720; step++) {
      const ang = (step * Math.PI) / 360;
      for (let r = 0; r < STICK_DEAD_R; r += 0.5) {
        const dx = Math.cos(ang) * r;
        const dy = Math.sin(ang) * r;
        const m = quantizeStick(dx, dy);
        // 반올림 뒤 제곱거리가 여전히 데드존 밖일 수 있다(예: 8.4,8.4 → 8,8).
        const ix = Math.round(dx) | 0;
        const iy = Math.round(dy) | 0;
        if (ix * ix + iy * iy >= STICK_DEAD_R * STICK_DEAD_R) continue;
        assert.equal(m, 0, `반경 ${r} 각도 ${step / 2}° 에서 ${names(m)} 가 새어나왔다`);
      }
    }
  });

  it('유한하지 않은 좌표는 중심으로 취급한다 (NaN 이 시뮬에 들어가면 끝이다)', () => {
    assert.equal(quantizeStick(Number.NaN, 0), 0);
    assert.equal(quantizeStick(0, Number.POSITIVE_INFINITY), 0);
    assert.equal(quantizeStick(Number.NaN, Number.NaN), 0);
  });
});

// ── 5. 터치 마스크 열 == 키보드 마스크 열 (가장 중요) ──────────────────────

interface Dir {
  vx: number;
  vy: number;
  keys: readonly string[];
}

/** 8방향의 벡터와 **그에 대응하는 물리 키**. 두 열은 서로를 참조하지 않는다. */
const DIRS: Readonly<Record<string, Dir>> = {
  RIGHT: { vx: 1, vy: 0, keys: ['KeyD'] },
  DOWN_RIGHT: { vx: 1, vy: 1, keys: ['KeyS', 'KeyD'] },
  DOWN: { vx: 0, vy: 1, keys: ['KeyS'] },
  DOWN_LEFT: { vx: -1, vy: 1, keys: ['KeyS', 'KeyA'] },
  LEFT: { vx: -1, vy: 0, keys: ['KeyA'] },
  UP_LEFT: { vx: -1, vy: -1, keys: ['KeyA', 'KeyW'] },
  UP: { vx: 0, vy: -1, keys: ['KeyW'] },
  UP_RIGHT: { vx: 1, vy: -1, keys: ['KeyW', 'KeyD'] },
  IDLE: { vx: 0, vy: 0, keys: [] },
};

interface Gesture {
  dir: keyof typeof DIRS;
  run: boolean;
  /** `E` 상호작용 패드를 함께 누르고 있는가. */
  interact: boolean;
  ticks: number;
}

/**
 * 손가락이 실제로 할 만한 동작 열. 8방향을 전부 지나고, 달리기를 켜고 끄고,
 * 상호작용을 섞고, 중간에 손을 뗀다.
 */
const SCRIPT: readonly Gesture[] = [
  { dir: 'DOWN', run: false, interact: false, ticks: 24 },
  { dir: 'DOWN_RIGHT', run: true, interact: false, ticks: 30 },
  { dir: 'RIGHT', run: true, interact: false, ticks: 18 },
  { dir: 'IDLE', run: false, interact: true, ticks: 6 },
  { dir: 'UP_RIGHT', run: false, interact: false, ticks: 22 },
  { dir: 'UP', run: false, interact: false, ticks: 16 },
  { dir: 'UP_LEFT', run: true, interact: false, ticks: 14 },
  { dir: 'LEFT', run: false, interact: true, ticks: 20 },
  { dir: 'DOWN_LEFT', run: true, interact: false, ticks: 26 },
  { dir: 'IDLE', run: false, interact: false, ticks: 10 },
  { dir: 'DOWN', run: true, interact: false, ticks: 40 },
];

/** 걷기 반경 / 달리기 반경. 대각은 √2 배가 되므로 두 값 모두 링 판정을 만족한다. */
const WALK_PUSH = 20;
const RUN_PUSH = 45;

/** 터치 경로: 조이스틱 벡터 → 양자화, `E` 패드는 마스크 비트로 OR (touch.mask() 와 동일). */
function touchColumn(): InputMask[] {
  const out: InputMask[] = [];
  for (const g of SCRIPT) {
    const d = DIRS[g.dir]!;
    const push = g.run ? RUN_PUSH : WALK_PUSH;
    const stick = d.vx === 0 && d.vy === 0 ? 0 : quantizeStick(d.vx * push, d.vy * push);
    const m = stick | (g.interact ? IN_INTERACT : 0);
    for (let i = 0; i < g.ticks; i++) out.push(m);
  }
  return out;
}

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  const ev = new Event(type, { cancelable: true });
  Object.assign(ev, {
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  });
  return ev;
}

/** 키보드 경로: 실제 `createInput` 에 물리 키 이벤트를 쏘고 마스크를 읽는다. */
function keyboardColumn(): InputMask[] {
  const target = new EventTarget();
  const kb = createInput(target);
  const held = new Set<string>();
  const out: InputMask[] = [];

  const set = (want: readonly string[]): void => {
    for (const code of held) {
      if (!want.includes(code)) target.dispatchEvent(keyEvent('keyup', code));
    }
    for (const code of want) {
      if (!held.has(code)) target.dispatchEvent(keyEvent('keydown', code));
    }
    held.clear();
    for (const code of want) held.add(code);
  };

  for (const g of SCRIPT) {
    const d = DIRS[g.dir]!;
    const want = [...d.keys];
    // 달리기는 방향이 있을 때만 의미가 있다 — 조이스틱도 데드존 밖에서만 RUN 을 낸다.
    if (g.run && want.length > 0) want.push('ShiftLeft');
    if (g.interact) want.push('KeyE');
    set(want);
    for (let i = 0; i < g.ticks; i++) out.push(kb.mask());
  }

  kb.destroy();
  return out;
}

/** 마스크 열 하나를 1스테이지에 그대로 먹인다. 잔상 없음 — 비교 대상은 최종 상태 해시. */
function runColumn(column: readonly InputMask[]): { hash: number; tick: number } {
  const s = createWorld(STAGES[0]!, []);
  for (let i = 0; i < column.length && s.outcome === 'RUNNING'; i++) {
    stepWorld(s, column[i]!);
  }
  return { hash: hashState(s), tick: s.tick };
}

describe('터치: 손가락이 만든 마스크 열은 키보드가 만든 열과 구분되지 않는다', () => {
  it('마스크 열이 틱 단위로 완전히 일치한다', () => {
    const t = touchColumn();
    const k = keyboardColumn();
    assert.equal(t.length, k.length);
    for (let i = 0; i < t.length; i++) {
      assert.equal(
        t[i],
        k[i],
        `틱 ${i}: 터치 ${names(t[i]!)} vs 키보드 ${names(k[i]!)}`,
      );
    }
  });

  it('최종 상태 해시가 같다 — 모바일에서 녹화한 테이프는 데스크톱에서 그대로 재생된다', () => {
    const a = runColumn(touchColumn());
    const b = runColumn(keyboardColumn());
    assert.equal(a.tick, b.tick, '진행한 틱 수가 다르다');
    assert.equal(a.hash, b.hash, '같은 조작인데 최종 상태 해시가 다르다');
  });

  it('대조군: 달리기 비트를 빼면 해시가 갈린다 (해시가 실제로 비교를 하고 있는가)', () => {
    // 이 비교가 통과해야 위 두 테스트가 "아무것도 안 보고 통과한 것"이 아니게 된다.
    // 한 틱만 지우는 방식은 이 스테이지(THE CELL)에서 통하지 않는다 — 방이 좁아
    // 벽에 눌린 몸이 한 틱 늦게 같은 자리에 도달할 뿐이다. 그래서 이동량 자체를 바꾼다.
    const base = touchColumn();
    const walking = base.map((m) => m & ~IN_RUN);
    assert.notEqual(runColumn(base).hash, runColumn(walking).hash);
  });
});

// ── 6. 입력원 합성 ─────────────────────────────────────────────────────────

function fakeInput(mask: InputMask, edges: readonly string[] = []) {
  const pressed = new Set(edges);
  return {
    mask: () => mask,
    consumePressed: (k: string) => {
      if (!pressed.has(k)) return false;
      pressed.delete(k);
      return true;
    },
    isHeld: () => false,
    flush: () => pressed.clear(),
    destroy: () => pressed.clear(),
    /** 테스트가 들여다보는 남은 엣지. */
    left: () => pressed.size,
  };
}

describe('터치: 두 입력원 합성', () => {
  it('키보드와 터치가 반대 축을 내면 서로 상쇄된다', () => {
    // 상쇄하지 않으면 UP|DOWN 이 시뮬에 들어가 대각 상수(WALK_DIAG)가 맞지 않는다.
    const m = mergeInput(
      fakeInput(IN_UP | IN_LEFT) as never,
      fakeInput(IN_DOWN | IN_LEFT) as never,
    ).mask();
    assert.equal(m, IN_LEFT, names(m));
  });

  it('한쪽만 눌린 축은 그대로 통과하고 RUN 은 OR 된다', () => {
    const m = mergeInput(fakeInput(IN_UP) as never, fakeInput(IN_RIGHT | IN_RUN) as never).mask();
    assert.equal(m, IN_UP | IN_RIGHT | IN_RUN, names(m));
  });

  it('메타 엣지는 양쪽에서 모두 소비된다 (한쪽에 남으면 다음 페이즈에서 뒤늦게 터진다)', () => {
    const a = fakeInput(0, ['COMMIT']);
    const b = fakeInput(0, ['COMMIT']);
    const merged = mergeInput(a as never, b as never);
    assert.equal(merged.consumePressed('COMMIT'), true);
    assert.equal(a.left(), 0);
    assert.equal(b.left(), 0, '단축 평가로 한쪽 엣지가 큐에 남았다');
    assert.equal(merged.consumePressed('COMMIT'), false);
  });
});

// ── 7. 패드 배치 ───────────────────────────────────────────────────────────

describe('터치: 조작 버튼 배치', () => {
  it('모든 패드가 캔버스 안에 있다', () => {
    for (const pad of [...TOUCH_PADS, ...PICK_PADS]) {
      assert.ok(pad.x >= 0, `${pad.id} 가 왼쪽으로 넘쳤다 (${pad.x})`);
      assert.ok(pad.y >= 0, `${pad.id} 가 위로 넘쳤다 (${pad.y})`);
      assert.ok(pad.x + pad.w <= CANVAS_W, `${pad.id} 가 오른쪽으로 넘쳤다`);
      assert.ok(pad.y + pad.h <= CANVAS_H, `${pad.id} 가 아래로 넘쳤다`);
    }
  });

  it('같은 묶음 안에서 패드가 겹치지 않는다 (옆 버튼이 눌리면 되돌릴 수 없다)', () => {
    for (const group of [TOUCH_PADS, PICK_PADS]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          const apart =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          assert.ok(apart, `${a.id} 와 ${b.id} 의 히트 영역이 겹친다`);
        }
      }
    }
  });

  it('COMMIT 이 가장 큰 패드다 — 이 게임의 핵심 동작이다', () => {
    const commit = TOUCH_PADS.find((p) => p.id === 'COMMIT')!;
    for (const pad of TOUCH_PADS) {
      if (pad.id === 'COMMIT') continue;
      assert.ok(commit.r > pad.r, `${pad.id}(${pad.r}) 가 COMMIT(${commit.r}) 보다 크거나 같다`);
    }
  });
});
