/**
 * I.MY.ME.MINE — 정수 물리.
 *
 * 이 파일의 어떤 함수도 부동소수점을 만들지 않는다.
 * 나눗셈은 전부 `Math.floor` / `| 0` 로 절단하며, 삼각함수는 constants.ts 의 Q12 테이블만 쓴다.
 * 그래서 같은 입력열은 어떤 기기에서도 정확히 같은 상태를 만든다 (SPEC §4).
 */

import {
  CORNER_ASSIST_MAX,
  CORNER_ASSIST_SPEED,
  CRATE_SUB,
  DIR_COS,
  DIR_SIN,
  DIR_STEPS,
  TAN_SCALE,
  TILE_SUB,
} from './constants';
import type { Crate, SimState } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** SimState 가 구조적으로 만족하는 최소 타일 정보. 테스트에서 단독 사용 가능. */
export interface TileGrid {
  solid: Uint8Array;
  width: number;
  height: number;
}

// ── 기본 판정 ──────────────────────────────────────────────────────────────

export function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** 맵 바깥은 벽으로 취급한다. */
export function isSolidTile(grid: TileGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}

export function rectHitsTiles(
  grid: TileGrid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const tx0 = Math.floor(x / TILE_SUB);
  const tx1 = Math.floor((x + w - 1) / TILE_SUB);
  const ty0 = Math.floor(y / TILE_SUB);
  const ty1 = Math.floor((y + h - 1) / TILE_SUB);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolidTile(grid, tx, ty)) return true;
    }
  }
  return false;
}

export function rectHitsRects(
  x: number,
  y: number,
  w: number,
  h: number,
  rects: readonly Rect[],
): boolean {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (aabbOverlap(x, y, w, h, r.x, r.y, r.w, r.h)) return true;
  }
  return false;
}

function blocked(
  grid: TileGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  rects: readonly Rect[],
): boolean {
  return rectHitsTiles(grid, x, y, w, h) || rectHitsRects(x, y, w, h, rects);
}

// ── 축분리 이동 ────────────────────────────────────────────────────────────

/**
 * 한 축만 `dv` 만큼 움직인 뒤, 벽/blocker 에 막히면 최대 허용 지점으로 클램프한다.
 * 반환값은 해당 축의 새 좌표.
 *
 * `dv` 는 항상 타일(8192)·바디(6144)보다 작으므로 터널링이 불가능하다.
 * 따라서 "목적지가 비었으면 그대로 이동", 아니면 이분탐색으로 경계를 찾는다.
 * 이미 끼어 있는 상태(몸 위에서 게이트가 닫힌 경우)는 탈출을 위해 이동을 허용한다.
 */
export function sweepAxis(
  grid: TileGrid,
  rects: readonly Rect[],
  x: number,
  y: number,
  w: number,
  h: number,
  dv: number,
  axis: 0 | 1,
): number {
  const base = axis === 0 ? x : y;
  if (dv === 0) return base;

  const at = (t: number): boolean =>
    axis === 0
      ? blocked(grid, x + t, y, w, h, rects)
      : blocked(grid, x, y + t, w, h, rects);

  if (!at(dv)) return base + dv;
  if (at(0)) return base + dv; // 이미 끼어 있음 → 빠져나갈 수 있게 그대로 둔다

  // lo 는 항상 안전, hi 는 항상 충돌. 정수 이분탐색 (최대 10회).
  let lo = 0;
  let hi = dv;
  while (Math.abs(hi - lo) > 1) {
    const mid = (lo + hi) / 2 | 0;
    if (at(mid)) hi = mid;
    else lo = mid;
  }
  return base + lo;
}

// ── 상자 밀기 ──────────────────────────────────────────────────────────────

function crateRectsExcept(crates: readonly Crate[], skipId: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < crates.length; i++) {
    const c = crates[i]!;
    if (c.id === skipId) continue;
    out.push({ x: c.x, y: c.y, w: CRATE_SUB, h: CRATE_SUB });
  }
  return out;
}

export function crateRects(crates: readonly Crate[]): Rect[] {
  return crateRectsExcept(crates, -1);
}

/**
 * 상자를 밀며 한 축을 이동한다. 반환값 = 해당 축의 새 좌표.
 *
 * SPEC §5.2: 밀린 상자는 미는 바디와 같은 속도로 움직이고, 막히면 바디도 그 축으로 멈춘다.
 * 여러 바디가 같은 틱에 반대 방향으로 밀면 합력 0 — 상자는 틱 시작 위치로 복귀하고 잠긴다.
 */
export function moveWithCrates(
  s: SimState,
  staticRects: readonly Rect[],
  x: number,
  y: number,
  w: number,
  h: number,
  dv: number,
  axis: 0 | 1,
): number {
  if (dv === 0) return axis === 0 ? x : y;
  const sign = dv > 0 ? 1 : -1;

  // 이번 축 이동이 스치는 영역 (스윕 AABB)
  const sx = axis === 0 ? Math.min(x, x + dv) : x;
  const sy = axis === 1 ? Math.min(y, y + dv) : y;
  const sw = axis === 0 ? w + Math.abs(dv) : w;
  const sh = axis === 1 ? h + Math.abs(dv) : h;

  for (let i = 0; i < s.crates.length; i++) {
    const c = s.crates[i]!;
    if (!aabbOverlap(sx, sy, sw, sh, c.x, c.y, CRATE_SUB, CRATE_SUB)) continue;

    const pd = axis === 0 ? c.pushDirX : c.pushDirY;
    if (pd === 2) continue; // 이미 상충으로 잠김
    if (pd !== 0 && pd !== sign) {
      // 반대 방향 동시 밀기 → 합력 0
      if (axis === 0) {
        c.x = c.tickStartX;
        c.pushDirX = 2;
      } else {
        c.y = c.tickStartY;
        c.pushDirY = 2;
      }
      continue;
    }

    const others = crateRectsExcept(s.crates, c.id);
    const obstacles = staticRects.length ? others.concat(staticRects) : others;
    if (axis === 0) {
      c.x = sweepAxis(s, obstacles, c.x, c.y, CRATE_SUB, CRATE_SUB, dv, 0);
      c.pushDirX = sign;
    } else {
      c.y = sweepAxis(s, obstacles, c.x, c.y, CRATE_SUB, CRATE_SUB, dv, 1);
      c.pushDirY = sign;
    }
  }

  const all = crateRects(s.crates);
  const obstacles = staticRects.length ? all.concat(staticRects) : all;
  return sweepAxis(s, obstacles, x, y, w, h, dv, axis);
}

// ── 코너 어시스트 ──────────────────────────────────────────────────────────

/**
 * 막힌 축(`axis`)의 **수직축** 보정량을 돌려준다. 어시스트하지 않으면 0.
 *
 * 판단 순서 (전부 정수 연산):
 * 1. 수직축으로 바디가 두 타일에 걸쳐 있는가? 한 타일에 딱 들어가 있으면 정면 벽이다.
 * 2. 얕게 걸친 쪽의 겹침이 `CORNER_ASSIST_MAX` 이하인가? (바디 24px > 2×8px 이라
 *    양쪽이 동시에 얕을 수 없다 — 방향이 유일하게 결정된다.)
 * 3. 그 겹침을 **완전히** 해소했다고 가정했을 때 막힌 축이 실제로 뚫리는가?
 *    안 뚫리면 통로 모서리가 아니라 긴 벽이므로 어시스트하지 않는다.
 *    (이 검사가 없으면 벽을 따라 걸을 때 몸이 저절로 미끄러진다.)
 * 4. 그 방향 한 틱(`CORNER_ASSIST_SPEED`)이 다른 벽·상자와 충돌하지 않는가?
 */
function cornerAssist(
  grid: TileGrid,
  rects: readonly Rect[],
  x: number,
  y: number,
  w: number,
  h: number,
  dv: number,
  axis: 0 | 1,
): number {
  const base = axis === 0 ? y : x; // 수직축 좌표
  const size = axis === 0 ? h : w;
  const t0 = Math.floor(base / TILE_SUB);
  const t1 = Math.floor((base + size - 1) / TILE_SUB);
  if (t1 !== t0 + 1) return 0; // 한 타일 안 (정면 벽) 이거나 3타일 이상 (어시스트 대상 아님)

  const boundary = (t0 + 1) * TILE_SUB;
  const overLow = boundary - base; // 앞쪽 타일에 걸친 양 → +방향으로 밀어 해소
  const overHigh = base + size - boundary; // 뒤쪽 타일에 걸친 양 → -방향으로 밀어 해소

  let push = 0;
  if (overLow <= overHigh) {
    if (overLow <= CORNER_ASSIST_MAX) push = overLow;
  } else if (overHigh <= CORNER_ASSIST_MAX) {
    push = -overHigh;
  }
  if (push === 0) return 0;

  // 3) 정렬을 끝냈다면 막힌 축이 뚫리는가
  const ax = axis === 0 ? x + dv : x + push;
  const ay = axis === 0 ? y + push : y + dv;
  if (blocked(grid, ax, ay, w, h, rects)) return 0;

  // 4) 이번 틱의 한 걸음이 안전한가
  const step =
    push > 0
      ? Math.min(push, CORNER_ASSIST_SPEED)
      : Math.max(push, -CORNER_ASSIST_SPEED);
  const sx = axis === 0 ? x : x + step;
  const sy = axis === 0 ? y + step : y;
  if (blocked(grid, sx, sy, w, h, rects)) return 0;
  return step;
}

/**
 * 바디 한 개의 한 틱 이동 전체 — 축분리(X → Y) + 코너 어시스트.
 *
 * 어시스트는 **막힌 축이 있고 수직축 입력이 0일 때만** 발동한다. 그래서
 * 직선 주행("걷기 1타일 = 16틱")과 대각선 주행은 한 틱도 달라지지 않고,
 * 플레이어가 수직축을 직접 조작 중일 때 보정이 입력과 싸우는 일도 없다.
 *
 * 조작 몸과 잔상이 **같은 함수**를 타므로 재생 오차는 여전히 정확히 0 이다.
 */
export function moveBody(
  s: SimState,
  staticRects: readonly Rect[],
  x: number,
  y: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const nx = dx === 0 ? x : moveWithCrates(s, staticRects, x, y, w, h, dx, 0);
  const ny = dy === 0 ? y : moveWithCrates(s, staticRects, nx, y, w, h, dy, 1);

  // 어시스트는 상자를 밀지 않는다 — 이미 확정된 상자 위치를 장애물로만 본다.
  const all = crateRects(s.crates);
  const obstacles = staticRects.length ? all.concat(staticRects) : all;

  if (dx !== 0 && dy === 0 && nx !== x + dx) {
    return { x: nx, y: ny + cornerAssist(s, obstacles, nx, ny, w, h, dx, 0) };
  }
  if (dy !== 0 && dx === 0 && ny !== y + dy) {
    return { x: nx + cornerAssist(s, obstacles, nx, ny, w, h, dy, 1), y: ny };
  }
  return { x: nx, y: ny };
}

// ── 시야 ───────────────────────────────────────────────────────────────────

/**
 * 정수 레이캐스트. 두 점 사이가 벽/닫힌 게이트로 막혔는지 판정한다.
 *
 * ponytail: 8px 간격 샘플링이라 대각선으로 맞닿은 타일 모서리를 드물게 통과시킨다.
 * 완전 정확한 supercover DDA 로 바꿔도 인터페이스는 그대로다.
 * 샘플링이든 DDA 든 정수 연산만 쓰므로 결정론은 어느 쪽이든 동일하다.
 */
export function lineBlocked(
  grid: TileGrid,
  rects: readonly Rect[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(span / (TILE_SUB / 4)));
  for (let i = 0; i <= steps; i++) {
    const px = x0 + Math.floor((dx * i) / steps);
    const py = y0 + Math.floor((dy * i) / steps);
    if (isSolidTile(grid, Math.floor(px / TILE_SUB), Math.floor(py / TILE_SUB))) {
      return true;
    }
    for (let r = 0; r < rects.length; r++) {
      const q = rects[r]!;
      if (px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h) return true;
    }
  }
  return false;
}

export function dirCos(facing: number): number {
  return DIR_COS[facing] ?? 0;
}

export function dirSin(facing: number): number {
  return DIR_SIN[facing] ?? 0;
}

/**
 * 원뿔 판정. sqrt / atan2 없이 정수 내적·외적만 쓴다.
 * `fovTan` 은 반각의 탄젠트를 TAN_SCALE 배 한 정수 (constants.ts).
 */
export function inCone(
  dx: number,
  dy: number,
  facing: number,
  range: number,
  fovTan: number,
): boolean {
  if (dx * dx + dy * dy > range * range) return false;
  const c = dirCos(facing);
  const sn = dirSin(facing);
  const fwd = dx * c + dy * sn;
  if (fwd <= 0) return false;
  const perp = dy * c - dx * sn;
  const ap = perp < 0 ? -perp : perp;
  return ap * TAN_SCALE <= fovTan * fwd;
}

/**
 * 델타 → facing 인덱스(0..63). 옥탄트 + 탄젠트 선형근사.
 * 오차는 최대 0.5 스텝(약 3°)이며 완전 정수라 결정론적이다.
 * (64회 argmax 대신 O(1) 로 처리해 결정론 회귀 테스트가 몇 초 안에 끝난다.)
 */
export function dirFromDelta(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const oct = DIR_STEPS / 8; // 8
  const quad = DIR_STEPS / 4; // 16
  const r =
    ax >= ay
      ? Math.floor((ay * oct) / ax)
      : quad - Math.floor((ax * oct) / ay);
  if (dx >= 0 && dy >= 0) return r % DIR_STEPS;
  if (dx < 0 && dy >= 0) return (2 * quad - r + DIR_STEPS) % DIR_STEPS;
  if (dx < 0 && dy < 0) return (2 * quad + r) % DIR_STEPS;
  return (4 * quad - r) % DIR_STEPS;
}

/** 최단 회전 방향으로 rate 만큼만 돌린다. */
export function turnToward(cur: number, want: number, rate: number): number {
  const d = (((want - cur) % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
  if (d === 0) return cur;
  if (d <= DIR_STEPS / 2) return (cur + Math.min(rate, d)) % DIR_STEPS;
  const back = DIR_STEPS - d;
  return (cur - Math.min(rate, back) + DIR_STEPS) % DIR_STEPS;
}
