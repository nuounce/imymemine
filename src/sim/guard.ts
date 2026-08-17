/**
 * I.MY.ME.MINE — 경비 상태기계 (SPEC §5.3).
 *
 * PATROL → SUSPICIOUS → INVESTIGATE → CHASE → RETURN → PATROL.
 * 경로탐색은 A* 없이 "주축 우선 + 벽 슬라이딩". 맵이 작아 충분하고 완전히 결정론적이다.
 * 시체는 감지하지 않는다 — 그래서 실패한 잔상은 미끼가 아니라 순수 발판 자원이 된다.
 */

import {
  BODY_SUB,
  DETECT_DECAY,
  DETECT_GAIN,
  DETECT_GAIN_RUN,
  DETECT_MAX,
  DETECT_SUSPICIOUS,
  GUARD_CHASE_SPEED,
  GUARD_FOV_TAN,
  GUARD_INVESTIGATE_SPEED,
  GUARD_PATROL_SPEED,
  GUARD_SUB,
  GUARD_TURN_RATE,
  GUARD_VIEW_RANGE,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  INVESTIGATE_TICKS,
} from './constants';
import {
  crateRects,
  dirFromDelta,
  dist2,
  inCone,
  lineBlocked,
  sweepAxis,
  turnToward,
  type Rect,
} from './physics';
import type { Body, Guard, SimState } from './types';

/** 경비가 잔상을 붙잡은 뒤 다시 흥분하기까지의 냉각 시간. 미끼가 성립하려면 필요하다. */
const RETURN_BLIND_TICKS = 90;
/** 도착 판정 여유 (서브픽셀). */
const ARRIVE_EPS = 256;

const MOVE_BITS = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;

function guardCx(g: Guard): number {
  return g.x + GUARD_SUB / 2;
}
function guardCy(g: Guard): number {
  return g.y + GUARD_SUB / 2;
}
function bodyCx(b: Body): number {
  return b.x + BODY_SUB / 2;
}
function bodyCy(b: Body): number {
  return b.y + BODY_SUB / 2;
}

/** 시야 안의 살아있는 바디 중 가장 가까운 것. 동률이면 id 낮은 쪽. */
function sense(s: SimState, g: Guard, blockers: readonly Rect[]): Body | null {
  const gx = guardCx(g);
  const gy = guardCy(g);
  let best: Body | null = null;
  let bestD = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (!b.alive) continue;
    const bx = bodyCx(b);
    const by = bodyCy(b);
    if (!inCone(bx - gx, by - gy, g.facing, GUARD_VIEW_RANGE, GUARD_FOV_TAN)) {
      continue;
    }
    if (lineBlocked(s, blockers, gx, gy, bx, by)) continue;
    const d = dist2(gx, gy, bx, by);
    if (best === null || d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** 한 틱에 한 축만 움직인다(축정렬). 주축이 막히면 부축으로 슬라이딩. */
function moveToward(
  s: SimState,
  blockers: readonly Rect[],
  g: Guard,
  tx: number,
  ty: number,
  speed: number,
): void {
  const dx = tx - guardCx(g);
  const dy = ty - guardCy(g);
  if (dx === 0 && dy === 0) return;
  const primaryX = Math.abs(dx) >= Math.abs(dy);
  const order: (0 | 1)[] = primaryX ? [0, 1] : [1, 0];

  for (let i = 0; i < order.length; i++) {
    const axis = order[i]!;
    const d = axis === 0 ? dx : dy;
    if (d === 0) continue;
    const step = d > 0 ? Math.min(speed, d) : Math.max(-speed, d);
    if (axis === 0) {
      const nx = sweepAxis(s, blockers, g.x, g.y, GUARD_SUB, GUARD_SUB, step, 0);
      if (nx !== g.x) {
        g.x = nx;
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
        return;
      }
    } else {
      const ny = sweepAxis(s, blockers, g.x, g.y, GUARD_SUB, GUARD_SUB, step, 1);
      if (ny !== g.y) {
        g.y = ny;
        g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
        return;
      }
    }
  }
  // 완전히 막혔다면 목표 방향만 바라본다.
  g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
}

function arrived(g: Guard, tx: number, ty: number): boolean {
  return (
    Math.abs(tx - guardCx(g)) <= ARRIVE_EPS &&
    Math.abs(ty - guardCy(g)) <= ARRIVE_EPS
  );
}

function nearestWaypoint(g: Guard): number {
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < g.path.length; i++) {
    const p = g.path[i]!;
    const d = dist2(guardCx(g), guardCy(g), p.x, p.y);
    if (bestD < 0 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function hearNoise(s: SimState, g: Guard): void {
  if (g.state === 'CHASE') return;
  for (let i = 0; i < s.noises.length; i++) {
    const n = s.noises[i]!;
    if (dist2(guardCx(g), guardCy(g), n.x, n.y) > n.radius * n.radius) continue;
    g.state = 'INVESTIGATE';
    g.targetX = n.x;
    g.targetY = n.y;
    g.targetBodyId = -1;
    g.stateTimer = INVESTIGATE_TICKS;
    return;
  }
}

function isRunning(b: Body): boolean {
  return (b.lastInput & IN_RUN) !== 0 && (b.lastInput & MOVE_BITS) !== 0;
}

/** 마지막으로 감지하던 대상이 그 사이 시체가 되었는가. */
function trackedIsCorpse(s: SimState, g: Guard): boolean {
  if (g.targetBodyId < 0) return false;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (b.id === g.targetBodyId) return !b.alive;
  }
  return false;
}

function updateOne(s: SimState, g: Guard, blockers: readonly Rect[]): void {
  if (g.state === 'RETURN' && g.stateTimer > 0) g.stateTimer--;

  hearNoise(s, g);

  const blind = g.state === 'RETURN' && g.stateTimer > 0;
  const seen = blind ? null : sense(s, g, blockers);

  if (seen !== null) {
    g.detect = Math.min(
      DETECT_MAX,
      g.detect + (isRunning(seen) ? DETECT_GAIN_RUN : DETECT_GAIN),
    );
    g.targetX = bodyCx(seen);
    g.targetY = bodyCy(seen);
    g.targetBodyId = seen.id;
    seen.spotted = true;
  } else if (trackedIsCorpse(s, g)) {
    // 보고 있던 대상이 시체가 됐다 — 경비는 그것을 "이미 처리된 것"으로 보고
    // 관심을 완전히 끊는다 (SPEC §5.3). 남은 게이지가 흘러내리며 시체를
    // 계속 의심하는 일이 없어야 시체가 순수 발판 자원이 된다.
    g.detect = 0;
    g.targetBodyId = -1;
  } else {
    g.detect = Math.max(0, g.detect - DETECT_DECAY);
  }

  if (g.detect >= DETECT_MAX) {
    g.state = 'CHASE';
    g.targetBodyId = seen !== null ? seen.id : g.targetBodyId;
  } else if (g.state === 'CHASE') {
    // 시야를 완전히 잃으면 추격을 접는다.
    if (g.detect <= 0) {
      g.state = 'RETURN';
      g.stateTimer = 0;
      g.targetBodyId = -1;
    }
  } else if (g.detect >= DETECT_SUSPICIOUS) {
    if (g.state === 'PATROL' || g.state === 'RETURN') g.state = 'SUSPICIOUS';
  } else if (g.state === 'SUSPICIOUS') {
    g.state = 'RETURN';
    g.stateTimer = 0;
  }

  switch (g.state) {
    case 'PATROL': {
      if (g.path.length === 0) break;
      const wp = g.path[g.pathIndex % g.path.length]!;
      if (arrived(g, wp.x, wp.y)) {
        g.waitTimer++;
        if (g.waitTimer >= g.waitTicks) {
          g.waitTimer = 0;
          g.pathIndex = (g.pathIndex + 1) % g.path.length;
        }
      } else {
        moveToward(s, blockers, g, wp.x, wp.y, GUARD_PATROL_SPEED);
      }
      break;
    }
    case 'SUSPICIOUS': {
      // 멈춰서 마지막 목격 지점을 바라본다.
      const dx = g.targetX - guardCx(g);
      const dy = g.targetY - guardCy(g);
      g.facing = turnToward(g.facing, dirFromDelta(dx, dy), GUARD_TURN_RATE);
      break;
    }
    case 'INVESTIGATE': {
      if (arrived(g, g.targetX, g.targetY)) {
        g.stateTimer--;
        // 제자리 수색 — 천천히 한 바퀴 돈다.
        g.facing = (g.facing + 1) % 64;
      } else {
        const px = g.x;
        const py = g.y;
        moveToward(s, blockers, g, g.targetX, g.targetY, GUARD_INVESTIGATE_SPEED);
        // 경로탐색이 A* 가 아니라서(SPEC §5.3) 벽 너머의 소음 지점에는 영영 닿지
        // 못할 수 있다. 한 발짝도 못 간 틱은 "그 자리에서 귀 기울인 틱"으로 쳐서
        // 탐색 시간을 소진시킨다 — 그러지 않으면 경비가 벽을 보고 영구히 굳는다.
        if (g.x === px && g.y === py) g.stateTimer--;
      }
      if (g.stateTimer <= 0) {
        g.state = 'RETURN';
        g.stateTimer = 0;
      }
      break;
    }
    case 'CHASE': {
      const target = s.bodies.find((b) => b.id === g.targetBodyId);
      if (target !== undefined && target.alive) {
        g.targetX = bodyCx(target);
        g.targetY = bodyCy(target);
      }
      if (arrived(g, g.targetX, g.targetY) && target === undefined) {
        g.state = 'RETURN';
        g.stateTimer = 0;
        g.detect = 0;
      } else {
        moveToward(s, blockers, g, g.targetX, g.targetY, GUARD_CHASE_SPEED);
      }
      break;
    }
    case 'RETURN': {
      if (g.path.length === 0) {
        g.state = 'PATROL';
        break;
      }
      const idx = nearestWaypoint(g);
      const wp = g.path[idx]!;
      if (arrived(g, wp.x, wp.y)) {
        g.pathIndex = idx;
        g.waitTimer = 0;
        g.state = 'PATROL';
      } else {
        moveToward(s, blockers, g, wp.x, wp.y, GUARD_PATROL_SPEED);
      }
      break;
    }
  }
}

export function updateGuards(s: SimState, staticBlockers: readonly Rect[]): void {
  const blockers = crateRects(s.crates).concat(staticBlockers);
  for (let i = 0; i < s.guards.length; i++) {
    updateOne(s, s.guards[i]!, blockers);
  }
}

/**
 * 체포 판정 (SPEC §4 의 9단계).
 * 추격 중인 경비가 살아있는 몸과 겹치면 붙잡는다.
 * 잔상이면 "발각"만 되고 재생은 계속된다 — 미끼가 성립하는 지점.
 * 조작 중인 I 라면 루프 종료.
 */
export function resolveCapture(s: SimState): { captured: boolean; ghostSpotted: boolean } {
  let captured = false;
  let ghostSpotted = false;
  for (let i = 0; i < s.guards.length; i++) {
    const g = s.guards[i]!;
    if (g.state !== 'CHASE') continue;
    for (let b = 0; b < s.bodies.length; b++) {
      const body = s.bodies[b]!;
      if (!body.alive) continue;
      const overlap =
        g.x < body.x + BODY_SUB &&
        body.x < g.x + GUARD_SUB &&
        g.y < body.y + BODY_SUB &&
        body.y < g.y + GUARD_SUB;
      if (!overlap) continue;

      if (body.isLive) {
        body.alive = false;
        body.spotted = true;
        s.alerts++;
        s.outcome = 'CAPTURED';
        captured = true;
        return { captured, ghostSpotted };
      }
      body.spotted = true;
      ghostSpotted = true;
      g.state = 'RETURN';
      g.detect = 0;
      g.targetBodyId = -1;
      g.stateTimer = RETURN_BLIND_TICKS;
      break;
    }
  }
  return { captured, ghostSpotted };
}
