/**
 * 이동 감각 — 코너 어시스트 (SPEC §4, §5.1).
 *
 * 1타일 통로(32px)에 24px 바디가 들어가면 좌우 여유가 각 4px뿐이다. 그 안으로
 * 정렬하지 못하면 축분리 충돌이 진행축을 0으로 만들어 "벽에 비비적거리는" 느낌이 난다.
 * 코너 어시스트는 **막혔을 때만** 수직축을 미세하게 밀어 모서리를 돌게 해 준다.
 *
 * 이 테스트가 지키는 것은 두 가지다.
 *   (a) 어시스트가 실제로 통로를 뚫어 준다.
 *   (b) 그 대가로 **아무것도** 잃지 않는다 — 걷기 1타일 = 정확히 16틱, 정면 벽에서
 *       미끄러지지 않음, 재생 오차 0, 조작 몸과 잔상의 궤적 동일.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BODY_SUB,
  CORNER_ASSIST_MAX,
  CORNER_ASSIST_SPEED,
  TILE_SUB,
  WALK_SPEED,
} from '../src/sim/constants';
import { hashState } from '../src/sim/hash';
import { crateRects, moveBody, moveWithCrates } from '../src/sim/physics';
import type { LevelDef, Tape } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';
import { D, O, R, U, seg, tape, tiles } from './tapes';

/**
 * 코너 레벨 — ty=2 가 tx=4..8 구간에서 **1타일 통로**가 된다.
 * 스폰(1,2) 주변 tx=1..3 은 세로로 열려 있어 일부러 어긋나게 정렬할 수 있다.
 * ty=4 는 loot/escape 를 조작 몸의 동선 밖에 두기 위한 방이다.
 */
const CORNER_LEVEL: LevelDef = {
  id: 'T-CORNER',
  name: 'CORNER ASSIST FIXTURE',
  par: 1,
  tiles: [
    '##########',
    '#...######',
    '#S.......#',
    '#...######',
    '#........#',
    '##########',
  ],
  hint: '',
  loot: { tx: 8, ty: 4 },
  escape: { tx: 1, ty: 4 },
};

/** 정면 벽 레벨 — 오른쪽 전체가 벽이라 어떤 정렬로도 뚫리지 않는다. */
const FLAT_WALL_LEVEL: LevelDef = {
  id: 'T-FLAT',
  name: 'FLAT WALL FIXTURE',
  par: 1,
  tiles: ['######', '#S...#', '#....#', '#....#', '######'],
  hint: '',
  loot: { tx: 4, ty: 3 },
  escape: { tx: 1, ty: 3 },
};

interface Step {
  x: number;
  y: number;
}

/** 테이프를 조작 몸에 먹이고 매 틱 좌표를 기록한다. */
function runLive(level: LevelDef, t: Tape): { path: Step[]; hash: number } {
  const s = createWorld(level, []);
  const path: Step[] = [];
  for (let i = 0; i < t.length; i++) {
    stepWorld(s, t[i]!);
    const b = s.bodies[0]!;
    path.push({ x: b.x, y: b.y });
  }
  return { path, hash: hashState(s) };
}

/** 같은 테이프를 잔상(id 1)으로 재생하고 매 틱 좌표를 기록한다. */
function runGhost(level: LevelDef, t: Tape): { path: Step[]; hash: number } {
  const s = createWorld(level, [{ tape: t, corpse: false }]);
  const path: Step[] = [];
  for (let i = 0; i < t.length; i++) {
    stepWorld(s, 0);
    const b = s.bodies[1]!;
    path.push({ x: b.x, y: b.y });
  }
  return { path, hash: hashState(s) };
}

const last = (p: Step[]): Step => p[p.length - 1]!;

/** 스폰 좌표 (타일 중앙 정렬). */
function spawnOf(level: LevelDef): Step {
  const s = createWorld(level, []);
  return { x: s.spawnX, y: s.spawnY };
}

describe('이동 — 코너 어시스트', () => {
  // ── 1. 직선 주행 불변 ────────────────────────────────────────────────────
  it('벽 없는 구간에서 걷기 1타일은 여전히 정확히 16틱이다', () => {
    const spawn = spawnOf(CORNER_LEVEL);
    const { path } = runLive(CORNER_LEVEL, tape([seg(R, tiles(1))]));
    assert.equal(path.length, 16);
    assert.equal(last(path).x - spawn.x, TILE_SUB);
    assert.equal(last(path).y, spawn.y);
    // 매 틱 정확히 WALK_SPEED — 가속도가 끼어들지 않았다.
    for (let i = 0; i < path.length; i++) {
      assert.equal(path[i]!.x, spawn.x + WALK_SPEED * (i + 1));
    }
  });

  it('타일 정렬된 채 1타일 통로를 종주해도 1타일 = 16틱 그대로다', () => {
    // 스폰(1,2)에서 곧장 오른쪽 — ty=2 는 tx=4 부터 1타일 통로다.
    const spawn = spawnOf(CORNER_LEVEL);
    const { path } = runLive(CORNER_LEVEL, tape([seg(R, tiles(6))]));
    assert.equal(last(path).y, spawn.y, '통로에서 세로로 밀리지 않았다');
    assert.equal(last(path).x - spawn.x, 6 * TILE_SUB);
    for (let n = 1; n <= 6; n++) {
      assert.equal(path[tiles(n) - 1]!.x - spawn.x, n * TILE_SUB, `${n}타일`);
    }
  });

  // ── 2. 코너 어시스트 발동 ────────────────────────────────────────────────
  it('어긋난 채 통로에 들어가면 어시스트 없이는 막히고 어시스트로는 통과한다', () => {
    // D 3틱 = 1536 서브픽셀(6px) 내려 ty=3 쪽으로 512(2px)만 걸치게 만든다.
    const misalign = tape([seg(D, 3)]);
    const spawn = spawnOf(CORNER_LEVEL);
    const misY = spawn.y + 3 * WALK_SPEED;

    // (a) 어시스트가 없는 원래의 축분리 이동은 이 자세로 통로에 못 들어간다.
    const raw = createWorld(CORNER_LEVEL, []);
    for (const m of misalign) stepWorld(raw, m);
    const rb = raw.bodies[0]!;
    assert.equal(rb.y, misY);
    // 모서리에 닿을 때까지 밀어붙인 뒤 raw sweep 을 직접 호출한다.
    const wallX = 4 * TILE_SUB - BODY_SUB; // 오른쪽 모서리가 tx=4 경계에 붙는 지점
    const stuckX = moveWithCrates(
      raw,
      [],
      wallX,
      misY,
      BODY_SUB,
      BODY_SUB,
      WALK_SPEED,
      0,
    );
    assert.equal(stuckX, wallX, '어시스트 없는 축분리 이동은 0만큼 움직인다');
    assert.equal(crateRects(raw.crates).length, 0);

    // (b) 실제 시뮬(어시스트 포함)은 통과한다.
    const { path } = runLive(CORNER_LEVEL, tape([seg(D, 3), seg(R, 60)]));
    const end = last(path);
    assert.ok(end.x > wallX, `통로를 통과했다 (x=${end.x} > ${wallX})`);
    // 어시스트는 걸친 512 만큼만 밀어 통로 안쪽 벽에 정렬시키고 멈춘다.
    assert.equal(end.y, misY - 512);
    assert.equal(end.y + BODY_SUB, 3 * TILE_SUB, '통로 아래 벽에 딱 정렬됐다');
    // 512 를 CORNER_ASSIST_SPEED(192) 로 나눠 밀었으므로 정확히 3틱 걸린다.
    assert.equal(Math.ceil(512 / CORNER_ASSIST_SPEED), 3);
    assert.equal(end.x, wallX + (60 - 34 - 3) * WALK_SPEED);
  });

  // ── 3. 과도 어시스트 없음 ────────────────────────────────────────────────
  it('겹침이 CORNER_ASSIST_MAX 를 넘으면 밀어주지 않는다', () => {
    // D 7틱 = 3584 → 위/아래 겹침이 3584 / 2560 으로 둘 다 2048(8px) 초과.
    const spawn = spawnOf(CORNER_LEVEL);
    const misY = spawn.y + 7 * WALK_SPEED;
    assert.ok(misY + BODY_SUB - 3 * TILE_SUB > CORNER_ASSIST_MAX);
    const { path } = runLive(CORNER_LEVEL, tape([seg(D, 7), seg(R, 60)]));
    const end = last(path);
    assert.equal(end.y, misY, '세로로 한 서브픽셀도 밀리지 않았다');
    assert.equal(end.x, 4 * TILE_SUB - BODY_SUB, '모서리 앞에서 정지했다');
  });

  it('정면 벽에서는 겹침이 작아도 미끄러지지 않는다', () => {
    // 걸침은 512(≤ MAX)지만 정렬해도 오른쪽은 여전히 벽이다 → 어시스트 취소.
    const spawn = spawnOf(FLAT_WALL_LEVEL);
    const misY = spawn.y + 3 * WALK_SPEED;
    assert.ok(misY + BODY_SUB - 2 * TILE_SUB <= CORNER_ASSIST_MAX);
    // 벽까지 50틱이면 닿는다. 60틱을 눌러 10틱 동안 벽을 밀고 있게 만든다.
    const { path } = runLive(FLAT_WALL_LEVEL, tape([seg(D, 3), seg(R, 60)]));
    const end = last(path);
    assert.equal(end.x, 5 * TILE_SUB - BODY_SUB, '벽에 닿아 정지했다');
    assert.equal(end.y, misY, '벽을 따라 미끄러지지 않았다');
  });

  it('어시스트 경로에 닫힌 게이트/상자가 있으면 취소한다', () => {
    // 통로 모서리에 붙어 512 만큼 아래 행에 걸친 자세 — 원래대로면 위로 192 밀린다.
    const s = createWorld(CORNER_LEVEL, []);
    const x = 4 * TILE_SUB - BODY_SUB; // 26624
    const y = 2 * TILE_SUB + 2560; // 18944
    const free = moveBody(s, [], x, y, BODY_SUB, BODY_SUB, WALK_SPEED, 0);
    assert.deepEqual(free, { x, y: y - CORNER_ASSIST_SPEED }, '기준: 어시스트 발동');

    // (a) 정렬을 마친 자리가 막혀 있으면 어시스트해도 소용없다 → 발동 안 함.
    const blockAligned = [{ x: 32768, y: 18432, w: 232, h: 1568 }];
    assert.deepEqual(
      moveBody(s, blockAligned, x, y, BODY_SUB, BODY_SUB, WALK_SPEED, 0),
      { x, y },
    );

    // (b) 정렬 지점은 비었지만 이번 한 걸음이 무언가와 겹치면 그 걸음을 취소한다.
    const blockStep = [{ x: 26624, y: 18500, w: 376, h: 300 }];
    assert.deepEqual(
      moveBody(s, blockStep, x, y, BODY_SUB, BODY_SUB, WALK_SPEED, 0),
      { x, y },
    );
  });

  // ── 4. 결정론 유지 ───────────────────────────────────────────────────────
  it('어시스트가 발동하는 테이프를 2회 재생하면 궤적과 해시가 동일하다', () => {
    const t = tape([seg(D, 3), seg(R, 40), seg(O, 5), seg(D, 5), seg(R, 40)]);
    const a = runLive(CORNER_LEVEL, t);
    const b = runLive(CORNER_LEVEL, t);
    assert.equal(a.hash, b.hash);
    assert.deepEqual(a.path, b.path);
    // 어시스트가 실제로 개입한 테이프인지 확인 (아니면 이 테스트는 공회전이다).
    const spawn = spawnOf(CORNER_LEVEL);
    assert.notEqual(last(a.path).y, spawn.y + 8 * WALK_SPEED);
  });

  // ── 5. 잔상에도 동일 적용 ────────────────────────────────────────────────
  it('같은 테이프의 조작 몸 궤적과 잔상 재생 궤적이 완전히 같다', () => {
    const t = tape([seg(D, 3), seg(R, 40), seg(O, 5), seg(D, 5), seg(R, 40)]);
    const live = runLive(CORNER_LEVEL, t);
    const ghost = runGhost(CORNER_LEVEL, t);
    assert.deepEqual(ghost.path, live.path, '잔상이 어시스트를 못 받으면 어긋난다');

    // 재생 중 실제로 어시스트가 개입했는가 — 세로 입력이 없는 틱에 y 가 움직였는가.
    let assisted = 0;
    for (let i = 1; i < ghost.path.length; i++) {
      if ((t[i]! & (U | D)) === 0 && ghost.path[i]!.y !== ghost.path[i - 1]!.y) {
        assisted++;
      }
    }
    assert.ok(assisted > 0, '이 테이프에서는 어시스트가 발동하지 않아 검증이 공회전한다');
  });

  it('어시스트가 걸리는 테이프는 조작 몸이든 잔상이든 통로를 통과한다', () => {
    const t = tape([seg(D, 3), seg(R, 60)]);
    const wallX = 4 * TILE_SUB - BODY_SUB;
    assert.ok(last(runLive(CORNER_LEVEL, t).path).x > wallX);
    assert.ok(last(runGhost(CORNER_LEVEL, t).path).x > wallX);
  });
});
