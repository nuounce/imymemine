/**
 * 규칙 엣지케이스 QA (SPEC §1.1, §2, §3-1, §3-2, §5.3).
 *
 * solvability.test.ts 가 "행복 경로가 존재한다"를 증명한다면, 이 파일은
 * **규칙이 경계에서도 명세대로 동작하는가**를 묻는다. 전용 미니 레벨을 써서
 * 각 규칙을 다른 규칙과 섞이지 않게 격리한다.
 *
 * 마지막 블록(§9)은 반대 방향의 질문이다 — "잔상 없이는 클리어할 수 없다"는
 * 게임의 전제가 15개 스테이지에서 실제로 성립하는지를 검증한다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  beginOverwriteMode,
  commitLoop,
  createSession,
  fullReset,
  nextStage,
  requestOverwrite,
  startStage,
  tickSession,
  type Session,
} from '../src/game/session';
import {
  BODY_SUB,
  CRATE_SUB,
  DETECT_MAX,
  DETECT_SUSPICIOUS,
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  MAX_TICKS,
  TILE_SUB,
} from '../src/sim/constants';
import { aabbOverlap } from '../src/sim/physics';
import type { LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';
import { D, L, O, R, U, driveWaypoints, playSolution, seg, tape, tiles } from './tapes';

// ── 전용 미니 레벨 ─────────────────────────────────────────────────────────

/** 발판 하나 · 게이트 하나. 잔상 정지 규칙만 본다. */
const LV_FREEZE: LevelDef = {
  id: 'T_FREEZE',
  name: 'FREEZE',
  par: 1,
  hint: '',
  tiles: [
    '############',
    '#....#.....#',
    '#.S..#.....#',
    '#....#.....#',
    '#..........#',
    '#....#.....#',
    '#....#.....#',
    '############',
  ],
  plates: [{ tx: 2, ty: 6, channel: 'p' }],
  gates: [{ tx: 5, ty: 4, channel: 'p' }],
  loot: { tx: 9, ty: 2 },
  escape: { tx: 9, ty: 6 },
};

/** 벽 없는 방. loot 와 escape 만 있다 — "잔상은 탈출할 수 없다"만 본다. */
const LV_OPEN: LevelDef = {
  id: 'T_OPEN',
  name: 'OPEN',
  par: 1,
  hint: '',
  tiles: [
    '############',
    '#..........#',
    '#.S........#',
    '#..........#',
    '#..........#',
    '#..........#',
    '############',
  ],
  loot: { tx: 5, ty: 2 },
  escape: { tx: 9, ty: 4 },
};

/**
 * 제자리 경비 하나(웨이포인트 1개 → 절대 움직이지 않는다), 정면은 +X.
 * 잔상은 경비 옆을 지나 (5,5) 발판 위에서 테이프가 끝난다.
 */
const LV_GUARD: LevelDef = {
  id: 'T_GUARD',
  name: 'GUARD',
  par: 1,
  hint: '',
  tiles: [
    '##############',
    '#............#',
    '#.S..........#',
    '#............#',
    '#............#',
    '#............#',
    '#............#',
    '##############',
  ],
  plates: [{ tx: 5, ty: 5, channel: 'p' }],
  guards: [{ path: [{ tx: 4, ty: 5 }], waitTicks: 60, facing: 0 }],
  loot: { tx: 11, ty: 1 },
  escape: { tx: 11, ty: 6 },
};

/** (2,2) → (2,5) → (5,5). 96틱. 마지막 3타일 중 1타일만 경비 시야 안이다. */
const GHOST_TO_PLATE: Tape = tape([seg(D, tiles(3)), seg(R, tiles(3))]);

function runWorld(
  level: LevelDef,
  ghosts: { tape: Tape; corpse: boolean }[],
  ticks: number,
  live: (tick: number) => number = () => 0,
  onTick?: (s: SimState, tick: number) => void,
): SimState {
  const sim = createWorld(level, ghosts);
  for (let t = 0; t < ticks && sim.outcome === 'RUNNING'; t++) {
    stepWorld(sim, live(t));
    onTick?.(sim, t);
  }
  return sim;
}

/** 세션을 한 루프 굴리고 확정한다(전환 오버레이까지 소화). */
function commitLoopOfLength(s: Session, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickSession(s, 0);
  commitLoop(s, 'MANUAL');
  for (let i = 0; i < LOOP_TRANSITION_TICKS; i++) tickSession(s, 0);
}

// ── 1. 잔상 정지 규칙 (SPEC §3-1) ─────────────────────────────────────────

describe('§3-1 잔상은 테이프가 끝나도 사라지지 않고 마지막 상태로 정지한다', () => {
  it('68틱짜리 잔상이 400틱 내내 발판을 누르고 있다', () => {
    const ghost = tape([seg(D, tiles(4)), seg(O, 4)]); // (2,2) → (2,6) 발판
    assert.equal(ghost.length, 68);

    let onSince = -1;
    const sim = runWorld(LV_FREEZE, [{ tape: ghost, corpse: false }], 400, () => 0, (s, t) => {
      const on = s.channels.get('p') === true;
      if (t >= ghost.length) {
        assert.equal(on, true, `틱 ${t}: 정지한 잔상이 발판을 놓았다`);
        assert.equal(s.gates[0]!.open, true, `틱 ${t}: 게이트가 닫혔다`);
        if (onSince < 0) onSince = t;
      }
    });

    const g = sim.bodies[1]!;
    assert.equal(g.frozen, true, '테이프 소진 후 frozen 이 아니다');
    assert.equal(g.alive, true, '체포되지 않은 잔상이 시체가 됐다');
    assert.equal(sim.tick, 400);
    assert.equal(sim.channels.get('p'), true);
    assert.ok(onSince >= 0);
  });

  it('잔상이 없으면 같은 발판은 계속 OFF (대조군)', () => {
    const sim = runWorld(LV_FREEZE, [], 400);
    assert.equal(sim.channels.get('p'), false);
    assert.equal(sim.gates[0]!.open, false);
  });
});

// ── 2. 4번째 확정 = 강제 초기화 (SPEC §1.1) ───────────────────────────────

describe('§1.1 잔상 3개가 찬 뒤 또 확정하면 전체 초기화 + DEBT', () => {
  it('잔상이 0으로 리셋되고 DEBT 가 1 오른다', () => {
    const s = createSession();
    startStage(s, 0);
    for (let i = 0; i < MAX_AFTERIMAGES; i++) commitLoopOfLength(s, 10);
    assert.equal(s.ghosts.length, MAX_AFTERIMAGES);
    assert.equal(s.debt, 0);

    for (let i = 0; i < 10; i++) tickSession(s, 0);
    commitLoop(s, 'MANUAL');

    assert.equal(s.ghosts.length, 0, '4번째 확정인데 잔상이 남아 있다');
    assert.equal(s.debt, 1, 'DEBT 가 오르지 않았다');
    assert.equal(s.phase, 'TRANSITION');
    assert.equal(s.transitionMsg[0], 'NO ONE LEFT TO BECOME.');
  });
});

// ── 3. DEBT 영속성 (SPEC §3-2) ────────────────────────────────────────────

describe('§3-2 DEBT 는 스테이지를 넘어가도 리셋되지 않는다', () => {
  it('초기화 2회로 쌓은 DEBT 가 클리어 후 다음 스테이지까지 남는다', () => {
    const s = createSession();
    startStage(s, 0);
    fullReset(s);
    fullReset(s);
    assert.equal(s.debt, 2);
    assert.equal(s.overwriteLeft, 1, '초기화가 덮어쓰기 횟수는 되돌려준다');

    // 1번 스테이지 정답: 발판 위에서 확정 → 열린 게이트로 통과 → loot → escape
    for (const mask of tape([seg(L, tiles(1)), seg(D, tiles(3)), seg(O, 4)])) {
      tickSession(s, mask);
    }
    commitLoop(s, 'MANUAL');
    for (let i = 0; i < LOOP_TRANSITION_TICKS; i++) tickSession(s, 0);
    for (const mask of tape([
      seg(D, tiles(1)),
      seg(R, tiles(11)),
      seg(U, tiles(2)),
      seg(D, tiles(4)),
    ])) {
      tickSession(s, mask);
    }
    assert.equal(s.phase, 'CLEAR', '1번 스테이지 클리어에 실패했다');
    assert.equal(s.debt, 2, '클리어가 DEBT 를 지웠다');

    nextStage(s);
    assert.equal(s.stageIndex, 1);
    assert.equal(s.debt, 2, 'nextStage 가 DEBT 를 지웠다');
    assert.equal(s.ghosts.length, 0);
  });
});

// ── 4. 덮어쓰기 1회 제한 (SPEC §3-2) ──────────────────────────────────────

describe('§3-2 덮어쓰기는 스테이지당 1회', () => {
  it('쓰고 나면 0, 새 스테이지에서 1 로 복구된다 (DEBT 는 복구되지 않는다)', () => {
    const s = createSession();
    startStage(s, 0);
    commitLoopOfLength(s, 20);
    assert.equal(s.overwriteLeft, 1);

    // 세션 API 의 Q → 1 흐름
    beginOverwriteMode(s);
    assert.equal(requestOverwrite(s, 1), true);
    assert.equal(s.overwriteLeft, 0, '덮어쓰기 후에도 횟수가 남아 있다');

    beginOverwriteMode(s);
    assert.equal(s.awaitingOverwritePick, false, '소진됐는데 모드에 진입했다');
    assert.equal(requestOverwrite(s, 1), false);

    fullReset(s); // DEBT 를 남기고 스테이지 재시작
    startStage(s, 1);
    assert.equal(s.overwriteLeft, 1, '새 스테이지에서 덮어쓰기가 복구되지 않았다');
    assert.equal(s.debt, 1, 'DEBT 가 사라졌다');
  });
});

// ── 5. 시체 규칙 (SPEC §3-2, §5.3) ────────────────────────────────────────

describe('§5.3 체포로 확정된 잔상 = 재생 중엔 미끼, 끝나면 시체', () => {
  it('(a) 재생 중에는 살아 있는 미끼로 경비 시야에 잡힌다', () => {
    let seenAlive = false;
    let suspicious = false;
    runWorld(LV_GUARD, [{ tape: GHOST_TO_PLATE, corpse: true }], GHOST_TO_PLATE.length, () => 0, (s, t) => {
      const g = s.bodies[1]!;
      if (t < GHOST_TO_PLATE.length - 1 && g.alive && s.guards[0]!.detect > 0) seenAlive = true;
      if (s.guards[0]!.detect >= DETECT_SUSPICIOUS) suspicious = true;
    });
    assert.equal(seenAlive, true, '재생 중인 잔상을 경비가 전혀 감지하지 못했다');
    assert.equal(suspicious, true, '감지 게이지가 SUSPICIOUS 문턱을 넘지 못했다');
  });

  it('(b) 테이프가 끝나면 alive === false 인 시체가 된다', () => {
    const sim = runWorld(LV_GUARD, [{ tape: GHOST_TO_PLATE, corpse: true }], 300);
    const g = sim.bodies[1]!;
    assert.equal(g.frozen, true);
    assert.equal(g.alive, false, '체포 확정된 잔상이 시체가 되지 않았다');
  });

  it('(c) 시체도 발판을 계속 누른다', () => {
    const sim = runWorld(LV_GUARD, [{ tape: GHOST_TO_PLATE, corpse: true }], 300, () => 0, (s, t) => {
      if (t >= GHOST_TO_PLATE.length) {
        assert.equal(s.channels.get('p'), true, `틱 ${t}: 시체가 발판을 놓았다`);
      }
    });
    assert.equal(sim.bodies[1]!.alive, false);
    assert.equal(sim.channels.get('p'), true);
  });

  it('(d) 시체는 경비 시야에 잡히지 않는다 — 같은 테이프의 산 잔상과 A/B', () => {
    const count = (corpse: boolean): { spotted: number; detectEnd: number } => {
      let spotted = 0;
      const sim = runWorld(LV_GUARD, [{ tape: GHOST_TO_PLATE, corpse }], 400, () => 0, (s, t) => {
        if (t > GHOST_TO_PLATE.length && s.guards[0]!.detect > 0) spotted++;
      });
      return { spotted, detectEnd: sim.guards[0]!.detect };
    };

    const corpseRun = count(true);
    const aliveRun = count(false);

    assert.equal(corpseRun.spotted, 0, '시체를 경비가 계속 보고 있다');
    assert.equal(corpseRun.detectEnd, 0, '시체 앞에서 감지 게이지가 0 이 아니다');
    assert.ok(
      aliveRun.spotted > 0,
      '대조군(산 잔상)조차 감지되지 않았다 — 시야 배치가 잘못된 테스트다',
    );
  });
});

// ── 6. 잔상은 탈출할 수 없다 (SPEC §2) ────────────────────────────────────

describe('§2 승리는 조작 중인 몸(I)만 만든다', () => {
  /** (2,2) → loot(5,2) → (9,2) → escape(9,4) */
  const ROUTE = tape([seg(R, tiles(3)), seg(R, tiles(4)), seg(D, tiles(2)), seg(O, 10)]);

  it('잔상이 loot 를 들고 escape 에 들어가도 클리어되지 않는다', () => {
    let ghostOnEscapeWithLoot = 0;
    const sim = runWorld(LV_OPEN, [{ tape: ROUTE, corpse: false }], ROUTE.length + 60, () => 0, (s) => {
      const g = s.bodies[1]!;
      const onEscape = aabbOverlap(
        g.x, g.y, BODY_SUB, BODY_SUB,
        s.escape.x, s.escape.y, s.escape.w, s.escape.h,
      );
      if (onEscape && g.carryingLoot) ghostOnEscapeWithLoot++;
      assert.notEqual(s.outcome, 'CLEARED', '잔상의 탈출로 클리어됐다');
    });

    assert.ok(
      ghostOnEscapeWithLoot > 0,
      'loot 를 든 잔상이 escape 에 들어간 틱이 없다 — 조건을 못 만든 테스트다',
    );
    assert.notEqual(sim.outcome, 'CLEARED');
  });

  it('같은 경로를 I 가 걸으면 클리어된다 (대조군)', () => {
    const res = playSolution(LV_OPEN, [ROUTE]);
    assert.equal(res.outcome, 'CLEARED');
    assert.equal(res.ghostsUsed, 0);
  });
});

// ── 7. 시간초과 자동 확정 (SPEC §2) ───────────────────────────────────────

describe('§2 3600틱을 소진하면 TIMEUP 으로 자동 잔상화된다', () => {
  it('MAX_TICKS 도달 → outcome TIMEUP → 세션이 스스로 확정한다', () => {
    const s = createSession();
    startStage(s, 0);
    for (let i = 0; i < MAX_TICKS; i++) tickSession(s, 0);

    assert.equal(s.sim.outcome, 'TIMEUP');
    assert.equal(s.phase, 'TRANSITION', '시간초과인데 자동 확정되지 않았다');
    assert.equal(s.ghosts.length, 1, '시간초과 런이 잔상으로 남지 않았다');
    assert.equal(s.ghosts[0]!.tape.length, MAX_TICKS);
    assert.equal(s.ghosts[0]!.corpse, false, '시간초과는 시체가 아니다');
    assert.equal(s.transitionMsg[0], 'TIME IS UP.');
    assert.equal(s.debt, 0, '시간초과가 DEBT 를 매겼다');
  });
});

// ── 8. 경비가 잔상을 잡아도 루프는 끝나지 않는다 (SPEC §5.3) ──────────────

describe('§5.3 루프를 끝내는 체포는 조작 몸(I)뿐이다', () => {
  /** 경비 정면(+X)을 길게 가로지른다 → 감지 게이지가 100 까지 찬다. */
  const LONG_WALK = tape([seg(D, tiles(3)), seg(R, tiles(7))]);

  it('잔상을 붙잡으면 발각 처리만 되고 루프는 계속된다', () => {
    let ghostSpotted = false;
    let chased = false;
    const sim = runWorld(LV_GUARD, [{ tape: LONG_WALK, corpse: false }], 400, () => 0, (s, t) => {
      if (s.guards[0]!.state === 'CHASE') chased = true;
      assert.notEqual(s.outcome, 'CAPTURED', `틱 ${t}: 잔상 체포로 루프가 끝났다`);
    });

    // ghostSpotted 는 stepWorld 반환값으로만 나오므로 다시 한 번 이벤트를 훑는다.
    const sim2 = createWorld(LV_GUARD, [{ tape: LONG_WALK, corpse: false }]);
    for (let t = 0; t < 400 && sim2.outcome === 'RUNNING'; t++) {
      if (stepWorld(sim2, 0).ghostSpotted) ghostSpotted = true;
    }

    assert.equal(chased, true, '경비가 잔상을 추격조차 하지 않았다 — 배치가 잘못된 테스트다');
    assert.equal(ghostSpotted, true, '경비가 잔상과 겹쳤는데 발각 이벤트가 없다');
    assert.equal(sim.outcome, 'RUNNING');
    assert.equal(sim.bodies[1]!.alive, true, '발각된 잔상이 죽었다');
    assert.equal(sim.bodies[1]!.spotted, true);
  });

  it('같은 경비가 I 를 잡으면 CAPTURED (대조군)', () => {
    const sim = createWorld(LV_GUARD, []);
    let captured = false;
    for (let t = 0; t < 400 && sim.outcome === 'RUNNING'; t++) {
      // I 가 직접 LONG_WALK 를 걷는다.
      const mask = t < LONG_WALK.length ? LONG_WALK[t]! : 0;
      if (stepWorld(sim, mask).captured) captured = true;
    }
    assert.equal(captured, true, 'I 가 경비 정면을 가로질렀는데 체포되지 않았다');
    assert.equal(sim.outcome, 'CAPTURED');
    assert.equal(sim.guards[0]!.detect, DETECT_MAX);
  });
});

// ── 9. 설계 전제: 잔상 없이는 클리어할 수 없다 ────────────────────────────

interface TileGridLite {
  solid: Uint8Array;
  width: number;
  height: number;
}

/** 타일맵 + (요청 시) 닫힌 게이트를 벽으로 굳힌 격자. */
function gridOf(level: LevelDef, gatesAreWalls: boolean): TileGridLite {
  const height = level.tiles.length;
  const width = level.tiles[0]!.length;
  const solid = new Uint8Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      if (level.tiles[ty]![tx] === '#') solid[ty * width + tx] = 1;
    }
  }
  if (gatesAreWalls) {
    for (const g of level.gates ?? []) {
      for (let dy = 0; dy < (g.h ?? 1); dy++) {
        for (let dx = 0; dx < (g.w ?? 1); dx++) {
          solid[(g.ty + dy) * width + (g.tx + dx)] = 1;
        }
      }
    }
  }
  return { solid, width, height };
}

function spawnTile(level: LevelDef): { tx: number; ty: number } {
  for (let ty = 0; ty < level.tiles.length; ty++) {
    const tx = level.tiles[ty]!.indexOf('S');
    if (tx >= 0) return { tx, ty };
  }
  throw new Error(`${level.id}: 스폰 없음`);
}

/**
 * 8방향 타일 BFS. 몸이 실제로는 24px AABB 라 두 타일에 걸칠 수 있으므로
 * 8방향은 실제 이동 능력의 **과대평가**다 — 여기서 닿지 않는 타일은 정말로 닿지 않는다.
 */
function reachableTiles(grid: TileGridLite, start: { tx: number; ty: number }): Set<number> {
  const seen = new Set<number>([start.ty * grid.width + start.tx]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cur.tx + dx;
        const ty = cur.ty + dy;
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
        const k = ty * grid.width + tx;
        if (grid.solid[k] === 1 || seen.has(k)) continue;
        seen.add(k);
        queue.push({ tx, ty });
      }
    }
  }
  return seen;
}

/** 몸이 두 사각형을 동시에 덮을 수 있는가 (AABB 24px 기준). */
function oneBodyCanCoverBoth(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  // 몸 좌상단이 a 를 덮는 구간 (a.x - BODY_SUB, a.x + a.w) 와 b 의 그것이 겹치는가
  const overlapX = a.x - BODY_SUB < b.x + b.w && b.x - BODY_SUB < a.x + a.w;
  const overlapY = a.y - BODY_SUB < b.y + b.h && b.y - BODY_SUB < a.y + a.h;
  return overlapX && overlapY;
}

interface Proof {
  proved: boolean;
  reason: string;
}

/**
 * "잔상 0개로는 escape 에 닿을 수 없다"의 구조적 증명.
 *
 * 1. 게이트를 벽으로 굳히면 escape 가 스폰과 다른 연결요소에 있다
 *    → 몸은 반드시 어느 게이트 타일과 겹친 채 통과해야 한다.
 * 2. 그 순간 그 게이트의 채널이 ON 이어야 한다. 채널이 AND 이고 소스에 발판이 있으면
 *    발판마다 서로 다른 점유자(몸 또는 상자)가 필요하다.
 * 3. 조작 몸은 게이트 안에 있으므로 발판을 누를 수 없다(기하로 확인).
 *    잔상이 0개이므로 남은 점유자는 상자뿐 → 발판 수 > 상자 수 면 채널은 절대 ON 이 될 수 없다.
 *
 * 증명이 서지 않으면 `proved: false` 와 이유를 돌려준다 (거짓 안심 금지).
 */
function proveNoSoloEscape(level: LevelDef): Proof {
  const grid = gridOf(level, true);
  const reach = reachableTiles(grid, spawnTile(level));
  const ew = level.escape.w ?? 1;
  const eh = level.escape.h ?? 1;
  for (let dy = 0; dy < eh; dy++) {
    for (let dx = 0; dx < ew; dx++) {
      const k = (level.escape.ty + dy) * grid.width + (level.escape.tx + dx);
      if (reach.has(k)) {
        return { proved: false, reason: '게이트를 열지 않고도 escape 에 도달할 수 있다' };
      }
    }
  }

  const crateCount = (level.crates ?? []).length;
  for (const g of level.gates ?? []) {
    const mode = level.channelMode?.[g.channel] ?? 'AND';
    if (mode !== 'AND') {
      return { proved: false, reason: `게이트 ${g.channel}: OR 채널이라 소스 하나로 열린다` };
    }
    const plates = (level.plates ?? []).filter((p) => p.channel === g.channel);
    const gateRect = {
      x: g.tx * TILE_SUB,
      y: g.ty * TILE_SUB,
      w: (g.w ?? 1) * TILE_SUB,
      h: (g.h ?? 1) * TILE_SUB,
    };
    for (const p of plates) {
      const plateRect = { x: p.tx * TILE_SUB, y: p.ty * TILE_SUB, w: TILE_SUB, h: TILE_SUB };
      if (oneBodyCanCoverBoth(gateRect, plateRect)) {
        return {
          proved: false,
          reason: `게이트 ${g.channel}: 발판 (${p.tx},${p.ty}) 을 밟은 채 게이트에 설 수 있다`,
        };
      }
    }
    // 상자 하나가 발판 두 개를 동시에 덮을 수는 없어야 셈이 성립한다.
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const a = plates[i]!;
        const b = plates[j]!;
        const near =
          Math.abs(a.tx - b.tx) * TILE_SUB < CRATE_SUB + TILE_SUB &&
          Math.abs(a.ty - b.ty) * TILE_SUB < CRATE_SUB + TILE_SUB;
        if (near) {
          return { proved: false, reason: `게이트 ${g.channel}: 상자 하나가 발판 둘을 덮을 수 있다` };
        }
      }
    }
    if (plates.length <= crateCount) {
      return {
        proved: false,
        reason:
          `게이트 ${g.channel}: 발판 ${plates.length}개를 상자 ${crateCount}개로 채울 수 있다` +
          ' — 조작 몸 혼자서도 채널을 켤 수 있다',
      };
    }
  }
  return { proved: true, reason: '모든 게이트가 잔상 없이는 열리지 않는다' };
}

/**
 * 각 스테이지의 "잔상 0개 단독 공략" 시도. 클리어되면 설계 전제가 깨진다.
 *
 * **15개 스테이지 전부에 하나씩 둔다.** 구조 증명이 서는 스테이지에서도 이 시도는
 * 그대로 돌린다 — 증명은 게이트 채널의 발판 셈만 보므로, 레이저·순차 버튼·전력 버스처럼
 * 증명이 모르는 장치가 뒷문을 여는 경우를 잡지 못하기 때문이다.
 *
 * 모든 시도에 **달리기(`run: true`)를 섞는다.** 과거에 걷기만으로 검사했다가
 * "달리면 시간차 버튼 안에 닿는다"는 붕괴를 놓친 적이 있다.
 */
const SOLO_ATTEMPTS: Record<string, Parameters<typeof driveWaypoints>[1]> = {
  // 01_I: 발판을 밟았다가 달려서 게이트로. 발판을 떠나는 순간 문이 닫힌다.
  '01_I': [
    { tx: 3, ty: 7, run: true, wait: 30 },
    { tx: 9, ty: 5, run: true },
    { tx: 15, ty: 3, run: true },
    { tx: 15, ty: 7, run: true },
  ],
  // 02_I: 버튼(1,7)을 누르고 달려서 게이트(19,4)까지 — 18타일 ≈ 178틱 > holdTicks 90.
  '02_I': [
    { tx: 1, ty: 7, run: true, press: true },
    { tx: 18, ty: 4, run: true },
    { tx: 22, ty: 2, run: true },
    { tx: 22, ty: 6, run: true },
  ],
  // 03_I: 상자를 발판으로 밀고 남은 발판을 몸으로 눌렀다가 달려 나간다.
  '03_I': [
    { tx: 2, ty: 4 },
    { tx: 2, ty: 7 },
    { tx: 5, ty: 7, wait: 30 },
    { tx: 8, ty: 5, run: true },
    { tx: 18, ty: 2, run: true },
    { tx: 18, ty: 7, run: true },
  ],
  // 04_I: 바깥 발판 → 안쪽 발판 → 달려서 두 문을 통과.
  '04_I': [
    { tx: 1, ty: 7, run: true, wait: 30 },
    { tx: 12, ty: 7, run: true, wait: 30 },
    { tx: 22, ty: 2, run: true },
    { tx: 22, ty: 7, run: true },
  ],
  // 05_MY: 시간차 버튼을 누르고 달려서 금고를 왕복한다.
  '05_MY': [
    { tx: 5, ty: 7, run: true, press: true },
    { tx: 8, ty: 4, run: true },
    { tx: 11, ty: 4, run: true },
    { tx: 11, ty: 1, run: true },
    { tx: 11, ty: 4, run: true },
    { tx: 8, ty: 4, run: true },
    { tx: 2, ty: 7, run: true },
  ],
  // 06_MY: 발판을 밟았다가 격자를 달려 건너 버튼을 누르고 게이트로.
  '06_MY': [
    { tx: 1, ty: 10, run: true, wait: 30 },
    { tx: 11, ty: 7, run: true, press: true },
    { tx: 20, ty: 5, run: true },
    { tx: 26, ty: 2, run: true },
    { tx: 26, ty: 10, run: true },
  ],
  // 07_MY: 레버로 눈을 감기고 발판 → 버튼 → 달려서 게이트 → 코어(22,1) → escape(11,8).
  '07_MY': [
    { tx: 2, ty: 7, press: true },
    { tx: 6, ty: 7, run: true, wait: 30 },
    { tx: 4, ty: 1, run: true, press: true },
    { tx: 10, ty: 5, run: true },
    { tx: 22, ty: 5, run: true },
    { tx: 22, ty: 1, run: true },
    { tx: 22, ty: 8, run: true },
    { tx: 11, ty: 8, run: true },
  ],
  // 08_MY: 발판 → 격자 위 레버 → 달려서 금고문.
  '08_MY': [
    { tx: 1, ty: 1, run: true, wait: 30 },
    { tx: 14, ty: 6, run: true, press: true },
    { tx: 20, ty: 6, run: true },
    { tx: 24, ty: 2, run: true },
    { tx: 24, ty: 10, run: true },
  ],
  // 09_ME: 0 을 누르고 발판을 밟았다가 달려서 1 을, 다시 반대편 발판을 거쳐 2 를.
  '09_ME': [
    { tx: 5, ty: 3, press: true },
    { tx: 2, ty: 11, run: true, wait: 30 },
    { tx: 12, ty: 3, run: true, press: true },
    { tx: 21, ty: 11, run: true, wait: 30 },
    { tx: 19, ty: 3, run: true, press: true },
    { tx: 23, ty: 9, run: true },
    { tx: 26, ty: 7, run: true },
    { tx: 26, ty: 11, run: true },
  ],
  // 10_ME: 발판을 밟았다가 레이저를 무시하고 달려서 버튼 → 게이트.
  '10_ME': [
    { tx: 2, ty: 8, run: true, wait: 30 },
    { tx: 17, ty: 2, run: true, press: true },
    { tx: 19, ty: 5, run: true },
    { tx: 23, ty: 2, run: true },
    { tx: 23, ty: 8, run: true },
  ],
  // 11_ME: 순서를 밟으며 문 버튼을 자기가 누르고 달려서 벽장까지 — 90틱 안에 닿지 못한다.
  '11_ME': [
    { tx: 10, ty: 6, press: true },
    { tx: 24, ty: 11, run: true, press: true },
    { tx: 6, ty: 3, run: true, press: true },
    { tx: 2, ty: 5, run: true, press: true },
    { tx: 15, ty: 3, run: true, press: true },
    { tx: 1, ty: 11, run: true, wait: 30 },
    { tx: 26, ty: 10, run: true },
    { tx: 29, ty: 8, run: true },
    { tx: 29, ty: 11, run: true },
  ],
  // 12_ME: 상자를 발판에 밀어 복도를 열고, 소음 없이 걸어서 전부 혼자 한다.
  '12_ME': [
    { tx: 7, ty: 3 },
    { tx: 7, ty: 2 },
    { tx: 3, ty: 2 },
    { tx: 3, ty: 5 },
    { tx: 12, ty: 5, press: true },
    { tx: 26, ty: 5 },
    { tx: 26, ty: 8 },
    { tx: 24, ty: 8 },
    { tx: 26, ty: 8 },
    { tx: 26, ty: 5 },
    { tx: 16, ty: 5, press: true },
    { tx: 26, ty: 5, run: true },
    { tx: 26, ty: 2, run: true },
    { tx: 25, ty: 2, run: true },
  ],
  // 13_MINE: 레버로 눈을 감기고 발판 셋을 차례로 밟아 본다 — 한 몸은 하나뿐이다.
  '13_MINE': [
    { tx: 8, ty: 8, press: true },
    { tx: 1, ty: 1, run: true, wait: 20 },
    { tx: 1, ty: 5, run: true, wait: 20 },
    { tx: 1, ty: 8, run: true, wait: 20 },
    { tx: 19, ty: 5, run: true },
    { tx: 24, ty: 2, run: true },
    { tx: 24, ty: 8, run: true },
  ],
  // 14_MINE: 레버 둘을 켜고 발판 셋을 훑은 뒤 달려서 복도를 종주.
  '14_MINE': [
    { tx: 7, ty: 1, press: true },
    { tx: 7, ty: 8, run: true, press: true },
    { tx: 1, ty: 1, run: true, wait: 20 },
    { tx: 1, ty: 5, run: true, wait: 20 },
    { tx: 1, ty: 8, run: true, wait: 20 },
    { tx: 25, ty: 5, run: true },
    { tx: 27, ty: 2, run: true },
    { tx: 27, ty: 8, run: true },
  ],
  // 15_MINE_FINAL: 순서를 혼자 다 밟고 발판 셋도 혼자 훑어 본다.
  '15_MINE_FINAL': [
    { tx: 13, ty: 2, press: true },
    { tx: 17, ty: 10, run: true, press: true },
    { tx: 18, ty: 3, run: true, press: true },
    { tx: 1, ty: 1, run: true, wait: 20 },
    { tx: 1, ty: 6, run: true, wait: 20 },
    { tx: 1, ty: 10, run: true, wait: 20 },
    { tx: 24, ty: 6, run: true },
    { tx: 26, ty: 3, run: true },
    { tx: 26, ty: 10, run: true },
  ],
};

describe('설계 전제: 어떤 스테이지도 잔상 0개로는 클리어할 수 없다', () => {
  it('15개 스테이지 전부에 단독 공략 시도가 정의돼 있다', () => {
    for (const level of STAGES) {
      assert.ok(
        SOLO_ATTEMPTS[level.id] !== undefined,
        `${level.id}: 단독 공략 시도가 없다`,
      );
      assert.ok(
        SOLO_ATTEMPTS[level.id]!.some((w) => w.run === true),
        `${level.id}: 달리기를 섞지 않은 단독 공략은 검사가 약하다`,
      );
    }
  });

  for (const level of STAGES) {
    it(`${level.id} ${level.name} — 잔상 0개 클리어 불가`, () => {
      const proof = proveNoSoloEscape(level);

      // 구조 증명이 서든 안 서든 **항상** 실제로 단독 공략을 굴려 본다.
      const wps = SOLO_ATTEMPTS[level.id];
      assert.ok(
        wps !== undefined,
        `${level.id}: 구조 증명 ${proof.proved ? '성공' : `실패(${proof.reason})`} — 단독 공략 시도가 없다`,
      );
      const solo = driveWaypoints(level, wps);
      // 폐루프로 뽑은 입력열을 고정 테이프로 되돌려, 잔상 0개 한 루프로 재현되는지 확인한다.
      const replay = playSolution(level, [solo.tape]);
      assert.notEqual(
        replay.outcome,
        'CLEARED',
        `${level.id}: 잔상 0개로 ${solo.tape.length}틱 만에 클리어된다 ` +
          `(구조 증명: ${proof.proved ? '성공했는데도' : `실패 — ${proof.reason}`}). 설계 전제가 무너진다.`,
      );
    });
  }
});
