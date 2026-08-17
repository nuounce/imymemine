/**
 * 테스트용 입력 테이프 DSL.
 *
 * 걷기 한 타일 = 정확히 16틱(8192 서브픽셀 / 512)이라서 `{방향, 틱}` 세그먼트만으로
 * 정답 경로를 사람이 읽고 검산할 수 있다. 달리기는 타일 정렬이 깨지므로
 * 정확한 위치가 필요한 구간에는 쓰지 않는다.
 */

import {
  BODY_SUB,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  TILE_SUB,
} from '../src/sim/constants';
import type { LevelDef, SimOutcome, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';

export const U = IN_UP;
export const D = IN_DOWN;
export const L = IN_LEFT;
export const R = IN_RIGHT;
export const E = IN_INTERACT;
export const RUN = IN_RUN;
/** 아무 것도 안 함 (제자리 대기). */
export const O = 0;

export interface Seg {
  mask: number;
  ticks: number;
}

export function seg(mask: number, ticks: number): Seg {
  return { mask, ticks };
}

/** 타일 수로 걷는 시간. 한 타일 = 16틱. */
export function tiles(n: number): number {
  return n * 16;
}

export function tape(segs: Seg[]): Tape {
  let total = 0;
  for (const s of segs) total += s.ticks;
  const out = new Uint8Array(total);
  let i = 0;
  for (const s of segs) {
    out.fill(s.mask, i, i + s.ticks);
    i += s.ticks;
  }
  return out;
}

export interface SolutionResult {
  outcome: SimOutcome;
  /** 클리어한 루프에서 사용된 잔상 수. */
  ghostsUsed: number;
  loopIndex: number;
  sim: SimState;
}

/**
 * 루프별 테이프를 순서대로 적용한다.
 * 각 루프는 그 시점까지 확정된 잔상만 가진 채 시뮬되므로,
 * "그 루프에서 실제로 녹화 가능한 행동인가"까지 함께 검증된다.
 */
export function playSolution(level: LevelDef, loops: Tape[]): SolutionResult {
  const ghosts: GhostSpec[] = [];
  let sim = createWorld(level, ghosts);

  for (let i = 0; i < loops.length; i++) {
    const t = loops[i]!;
    sim = createWorld(level, ghosts.slice());
    let used = 0;
    while (used < t.length && sim.outcome === 'RUNNING') {
      stepWorld(sim, t[used]!);
      used++;
    }
    if (sim.outcome === 'CLEARED') {
      return { outcome: 'CLEARED', ghostsUsed: i, loopIndex: i, sim };
    }
    ghosts.push({
      tape: t.slice(0, used),
      corpse: sim.outcome === 'CAPTURED',
    });
  }
  return {
    outcome: sim.outcome,
    ghostsUsed: loops.length - 1,
    loopIndex: loops.length - 1,
    sim,
  };
}

// ── 웨이포인트 주행 (탐색용) ───────────────────────────────────────────────

/**
 * 조작 몸(I)이 지나갈 타일 좌표. `press` 는 도착 후 `E` 1틱, `wait` 는 그 자리 대기 틱.
 * `run` 이면 그 구간을 달린다(= 소음 발생).
 */
export interface Waypoint {
  tx: number;
  ty: number;
  run?: boolean;
  press?: boolean;
  wait?: number;
}

/**
 * 웨이포인트를 따라 조작 몸을 몰고, **그 결과 만들어진 입력열**을 테이프로 돌려준다.
 *
 * 폐루프 제어지만 시뮬이 결정론이므로 출력 테이프도 결정론이다. 즉 여기서 나온 테이프는
 * 그대로 `playSolution` 에 다시 넣어 "사람이 실제로 녹화 가능한 한 루프"임을 재확인할 수 있다.
 * 손으로 틱을 세지 않고 "이 경로가 되는가"를 물을 때 쓴다.
 */
export function driveWaypoints(
  level: LevelDef,
  wps: readonly Waypoint[],
  maxTicks = 3600,
): { tape: Tape; sim: SimState } {
  const sim = createWorld(level, []);
  const out: number[] = [];
  /** 달리기 속도(832)보다 커야 웨이포인트를 넘나들며 진동하지 않는다. */
  const TOL = 900;
  let wi = 0;
  let pressed = false;
  let waited = 0;

  while (out.length < maxTicks && sim.outcome === 'RUNNING' && wi < wps.length) {
    const w = wps[wi]!;
    const b = sim.bodies[0]!;
    const dx = w.tx * TILE_SUB + TILE_SUB / 2 - (b.x + BODY_SUB / 2);
    const dy = w.ty * TILE_SUB + TILE_SUB / 2 - (b.y + BODY_SUB / 2);
    let mask = 0;

    if (Math.abs(dx) <= TOL && Math.abs(dy) <= TOL) {
      if (w.press === true && !pressed) {
        mask = IN_INTERACT;
        pressed = true;
      } else if (w.wait !== undefined && waited < w.wait) {
        waited++;
      } else {
        wi++;
        pressed = false;
        waited = 0;
        continue;
      }
    } else {
      if (dx > TOL) mask |= IN_RIGHT;
      else if (dx < -TOL) mask |= IN_LEFT;
      if (dy > TOL) mask |= IN_DOWN;
      else if (dy < -TOL) mask |= IN_UP;
      if (w.run === true) mask |= IN_RUN;
    }

    stepWorld(sim, mask);
    out.push(mask);
  }
  return { tape: Uint8Array.from(out), sim };
}
