/**
 * I.MY.ME.MINE — 월드 생성과 틱 진행.
 *
 * 이 파일은 DOM·타이머·난수에 접근하지 않는다. 그래서 헤드리스 테스트가 성립하고,
 * 그 테스트가 곧 "잔상 시스템이 붕괴하지 않는다"는 증명이다 (SPEC §4, §10).
 *
 * 잔상은 궤적이 아니라 **입력 테이프**다. 매 루프 월드를 틱 0부터 다시 굴리고
 * 잔상에는 녹화된 비트마스크를 그대로 먹인다. 그래서 경비는 이번 루프에 존재하는
 * 모든 몸에 반응하고, 그 반응까지 결정론적이다.
 *
 * LISTEN 모드의 마이크 소리도 예외가 아니다: 실시간 음량은 시뮬에 직접 들어오지
 * 않고 입력 마스크의 비트 6~7 로 **녹화**되며, 잔상은 그 녹화본을 재생한다
 * (constants.ts 의 IN_MIC_SHIFT 주석 참고). 이 파일은 마이크가 존재한다는 사실도
 * 모른다 — 비트일 뿐이다.
 */

import {
  BODY_SUB,
  GRATE_NOISE_INTERVAL,
  GRATE_NOISE_RADIUS,
  GUARD_KINDS,
  IN_DOWN,
  IN_INTERACT,
  IN_LEFT,
  IN_RIGHT,
  IN_RUN,
  IN_UP,
  INTERACT_RANGE,
  LEVER_COOLDOWN_TICKS,
  LOOT_PICKUP_RANGE,
  MAX_TICKS,
  MIC_NOISE_RADIUS,
  micLevelOf,
  NOISE_INTERVAL,
  NOISE_RADIUS,
  RUN_DIAG,
  RUN_SPEED,
  TILE_SUB,
  WALK_DIAG,
  WALK_SPEED,
} from './constants';
import {
  buildSeqGroups,
  closedGateRects,
  pressSeqButton,
  rectOnGrate,
  resolveLasers,
  updateCctvs,
  updateDevices,
} from './devices';
import { resolveCapture, updateGuards } from './guard';
import {
  aabbOverlap,
  dirFromDelta,
  dist2,
  moveBody,
  type Rect,
} from './physics';
import type {
  Body,
  GuardKind,
  InputMask,
  LevelDef,
  SimState,
  SlotIndex,
  Tape,
  TickEvents,
} from './types';

export interface GhostSpec {
  tape: Tape;
  corpse: boolean;
}

const MOVE_BITS = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;
/** 타일 중앙에 24×24 바디를 놓기 위한 오프셋. */
const BODY_TILE_INSET = (TILE_SUB - BODY_SUB) / 2;

function tileTopLeft(t: number): number {
  return t * TILE_SUB;
}
function tileCenter(t: number): number {
  return t * TILE_SUB + TILE_SUB / 2;
}

// ── 월드 생성 ──────────────────────────────────────────────────────────────

export function createWorld(level: LevelDef, ghosts: GhostSpec[]): SimState {
  const height = level.tiles.length;
  const width = level.tiles[0]?.length ?? 0;
  const solid = new Uint8Array(width * height);
  let spawnTx = 1;
  let spawnTy = 1;

  for (let ty = 0; ty < height; ty++) {
    const row = level.tiles[ty]!;
    if (row.length !== width) {
      throw new Error(
        `level ${level.id}: row ${ty} 길이 ${row.length} != ${width}`,
      );
    }
    for (let tx = 0; tx < width; tx++) {
      const ch = row[tx]!;
      if (ch === '#') solid[ty * width + tx] = 1;
      if (ch === 'S') {
        spawnTx = tx;
        spawnTy = ty;
      }
    }
  }

  const spawnX = tileTopLeft(spawnTx) + BODY_TILE_INSET;
  const spawnY = tileTopLeft(spawnTy) + BODY_TILE_INSET;

  const bodies: Body[] = [];
  const makeBody = (
    id: number,
    slot: SlotIndex,
    isLive: boolean,
    tape: Tape | null,
    becomesCorpse: boolean,
  ): Body => ({
    id,
    slot,
    isLive,
    x: spawnX,
    y: spawnY,
    facing: 0,
    alive: true,
    frozen: false,
    carryingLoot: false,
    spotted: false,
    lastInput: 0,
    noiseTimer: 0,
    tape,
    becomesCorpse,
  });

  // id 0 = 조작 중인 나(I). 잔상은 1..3 으로 슬롯 번호와 일치시킨다.
  bodies.push(makeBody(0, 0, true, null, false));
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i]!;
    bodies.push(makeBody(i + 1, (i + 1) as SlotIndex, false, g.tape, g.corpse));
  }

  let nextId = 4;
  const id = (): number => nextId++;

  const s: SimState = {
    level,
    tick: 0,
    solid,
    width,
    height,
    spawnX,
    spawnY,
    bodies,
    crates: (level.crates ?? []).map((c) => ({
      id: id(),
      x: tileTopLeft(c.tx),
      y: tileTopLeft(c.ty),
      tickStartX: tileTopLeft(c.tx),
      tickStartY: tileTopLeft(c.ty),
      pushDirX: 0,
      pushDirY: 0,
    })),
    guards: (level.guards ?? []).map((g) => {
      const first = g.path[0] ?? { tx: spawnTx, ty: spawnTy };
      // 유형이 없으면 SENTRY — 기존 스테이지 정의는 그대로 동작한다.
      const kind: GuardKind = g.kind ?? 'SENTRY';
      const sizeSub = GUARD_KINDS[kind].sizeSub;
      const facing = g.facing ?? 0;
      return {
        id: id(),
        kind,
        sizeSub,
        // 첫 웨이포인트 타일의 **중심**에 몸 중심을 맞춘다. BRUTE(40px)는 이 값이
        // 음수가 되어 이웃 타일로 4px 씩 삐져나온다 — 그게 이 유형의 존재 이유다.
        x: tileTopLeft(first.tx) + (TILE_SUB - sizeSub) / 2,
        y: tileTopLeft(first.ty) + (TILE_SUB - sizeSub) / 2,
        facing,
        state: 'PATROL' as const,
        detect: 0,
        path: g.path.map((p) => ({ x: tileCenter(p.tx), y: tileCenter(p.ty) })),
        pathIndex: g.path.length > 1 ? 1 : 0,
        waitTimer: 0,
        waitTicks: g.waitTicks ?? 30,
        targetX: tileCenter(first.tx),
        targetY: tileCenter(first.ty),
        targetBodyId: -1,
        stateTimer: 0,
        sweepBase: facing,
        sweepPhase: 0,
        anchorX: tileCenter(first.tx),
        anchorY: tileCenter(first.ty),
        searchStep: -1,
        chaseTimer: 0,
        alarmCooldown: 0,
      };
    }),
    cctvs: (level.cctvs ?? []).map((c) => ({
      id: id(),
      x: tileTopLeft(c.tx),
      y: tileTopLeft(c.ty),
      baseFacing: c.baseFacing,
      sweepArc: c.sweepArc ?? 8,
      sweepTicks: c.sweepTicks ?? 240,
      phase: c.phase ?? 0,
      facing: c.baseFacing,
      lockTimer: 0,
      disableChannel: c.disableChannel,
      enabled: true,
    })),
    plates: (level.plates ?? []).map((p) => ({
      id: id(),
      x: tileTopLeft(p.tx),
      y: tileTopLeft(p.ty),
      w: TILE_SUB,
      h: TILE_SUB,
      channel: p.channel,
      on: false,
    })),
    buttons: (level.buttons ?? []).map((b) => ({
      id: id(),
      x: tileTopLeft(b.tx),
      y: tileTopLeft(b.ty),
      channel: b.channel,
      holdTicks: b.holdTicks,
      timer: 0,
      on: false,
    })),
    levers: (level.levers ?? []).map((l) => ({
      id: id(),
      x: tileTopLeft(l.tx),
      y: tileTopLeft(l.ty),
      channel: l.channel,
      on: l.on ?? false,
      cooldown: 0,
    })),
    gates: (level.gates ?? []).map((g) => ({
      id: id(),
      x: tileTopLeft(g.tx),
      y: tileTopLeft(g.ty),
      w: (g.w ?? 1) * TILE_SUB,
      h: (g.h ?? 1) * TILE_SUB,
      channel: g.channel,
      invert: g.invert ?? false,
      open: false,
    })),
    grates: (level.grates ?? []).map((g) => ({
      id: id(),
      x: tileTopLeft(g.tx),
      y: tileTopLeft(g.ty),
      w: (g.w ?? 1) * TILE_SUB,
      h: (g.h ?? 1) * TILE_SUB,
    })),
    lasers: (level.lasers ?? []).map((l) => ({
      id: id(),
      x0: tileCenter(l.from.tx),
      y0: tileCenter(l.from.ty),
      x1: tileCenter(l.to.tx),
      y1: tileCenter(l.to.ty),
      periodTicks: l.periodTicks,
      onTicks: l.onTicks,
      phase: l.phase ?? 0,
      disableChannel: l.disableChannel,
      on: false,
    })),
    seqButtons: (level.seqButtons ?? []).map((b) => ({
      id: id(),
      x: tileTopLeft(b.tx),
      y: tileTopLeft(b.ty),
      group: b.group,
      order: b.order,
    })),
    seqGroups: buildSeqGroups(level.seqButtons ?? []),
    powerBuses: (level.powerBuses ?? []).map((b) => ({
      bus: b.bus,
      channels: b.channels.slice(),
      activeIndex: -1,
      prevOn: b.channels.map(() => false),
    })),
    loot: {
      id: id(),
      x: tileTopLeft(level.loot.tx) + BODY_TILE_INSET,
      y: tileTopLeft(level.loot.ty) + BODY_TILE_INSET,
      taken: false,
      holderId: -1,
    },
    escape: {
      id: id(),
      x: tileTopLeft(level.escape.tx),
      y: tileTopLeft(level.escape.ty),
      w: (level.escape.w ?? 1) * TILE_SUB,
      h: (level.escape.h ?? 1) * TILE_SUB,
    },
    channels: new Map<string, boolean>(),
    noises: [],
    outcome: 'RUNNING',
    alerts: 0,
    nextId,
  };

  // 틱 0의 이동이 올바른 게이트 상태 위에서 일어나도록 한 번 평가해 둔다.
  updateDevices(s);
  return s;
}

// ── 틱 ─────────────────────────────────────────────────────────────────────

function inputFor(s: SimState, b: Body): InputMask {
  if (!b.alive) return 0;
  if (b.isLive) return -1; // 호출부가 실시간 입력으로 대체한다
  const tape = b.tape;
  if (tape === null || s.tick >= tape.length) {
    if (!b.frozen) {
      b.frozen = true;
      if (b.becomesCorpse) b.alive = false;
    }
    return 0;
  }
  return tape[s.tick] ?? 0;
}

/** 사거리 안에서 가장 가까운 버튼/레버/순차버튼 하나. 동률이면 id 낮은 쪽 (SPEC §5.5). */
function tryInteract(s: SimState, b: Body): boolean {
  const bx = b.x + BODY_SUB / 2;
  const by = b.y + BODY_SUB / 2;
  const maxD = INTERACT_RANGE * INTERACT_RANGE;
  let bestD = -1;
  let bestId = -1;
  let bestButton = -1;
  let bestLever = -1;
  let bestSeq = -1;

  for (let i = 0; i < s.buttons.length; i++) {
    const t = s.buttons[i]!;
    const d = dist2(bx, by, t.x + TILE_SUB / 2, t.y + TILE_SUB / 2);
    if (d > maxD) continue;
    if (bestD < 0 || d < bestD || (d === bestD && t.id < bestId)) {
      bestD = d;
      bestId = t.id;
      bestButton = i;
      bestLever = -1;
      bestSeq = -1;
    }
  }
  for (let i = 0; i < s.levers.length; i++) {
    const t = s.levers[i]!;
    const d = dist2(bx, by, t.x + TILE_SUB / 2, t.y + TILE_SUB / 2);
    if (d > maxD) continue;
    if (bestD < 0 || d < bestD || (d === bestD && t.id < bestId)) {
      bestD = d;
      bestId = t.id;
      bestLever = i;
      bestButton = -1;
      bestSeq = -1;
    }
  }
  for (let i = 0; i < s.seqButtons.length; i++) {
    const t = s.seqButtons[i]!;
    const d = dist2(bx, by, t.x + TILE_SUB / 2, t.y + TILE_SUB / 2);
    if (d > maxD) continue;
    if (bestD < 0 || d < bestD || (d === bestD && t.id < bestId)) {
      bestD = d;
      bestId = t.id;
      bestSeq = i;
      bestButton = -1;
      bestLever = -1;
    }
  }

  if (bestButton >= 0) {
    const t = s.buttons[bestButton]!;
    t.timer = t.holdTicks; // 재누름은 타이머 리셋
    t.on = true;
    return true;
  }
  if (bestLever >= 0) {
    const t = s.levers[bestLever]!;
    if (t.cooldown > 0) return false;
    t.on = !t.on;
    t.cooldown = LEVER_COOLDOWN_TICKS;
    return true;
  }
  if (bestSeq >= 0) {
    const t = s.seqButtons[bestSeq]!;
    pressSeqButton(s, t.group, t.order);
    return true;
  }
  return false;
}

function speedFor(mask: InputMask, diagonal: boolean): number {
  const run = (mask & IN_RUN) !== 0;
  if (diagonal) return run ? RUN_DIAG : WALK_DIAG;
  return run ? RUN_SPEED : WALK_SPEED;
}

function dropLoot(s: SimState, b: Body): void {
  if (!b.carryingLoot) return;
  b.carryingLoot = false;
  s.loot.taken = false;
  s.loot.holderId = -1;
  s.loot.x = b.x;
  s.loot.y = b.y;
}

/**
 * 1 틱 진행. SPEC §4 의 10단계 순서를 그대로 따른다.
 * `s` 만 변형하고, 이번 틱에 일어난 사건은 반환값으로만 내보낸다.
 */
export function stepWorld(s: SimState, liveInput: InputMask): TickEvents {
  const ev: TickEvents = {
    captured: false,
    cleared: false,
    lootTaken: false,
    gateToggled: false,
    interacted: false,
    alerted: false,
    footstep: false,
    ghostSpotted: false,
  };
  if (s.outcome !== 'RUNNING') return ev;

  const staticRects: Rect[] = closedGateRects(s);

  // 1) 입력 적용 (id 오름차순)
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    const raw = inputFor(s, b);
    const mask = raw === -1 ? liveInput : raw;
    const prev = b.lastInput;
    b.lastInput = mask;
    if (!b.alive || b.frozen) continue;
    if ((mask & IN_INTERACT) !== 0 && (prev & IN_INTERACT) === 0) {
      if (tryInteract(s, b)) ev.interacted = true;
    }
  }

  // 2) 이동 + 3) 상자 밀림 (축분리 X → Y, 상자는 이동 안에서 함께 해결된다)
  for (let i = 0; i < s.crates.length; i++) {
    const c = s.crates[i]!;
    c.tickStartX = c.x;
    c.tickStartY = c.y;
    c.pushDirX = 0;
    c.pushDirY = 0;
  }
  // 소음 바닥은 "움직였는가"로 판정한다 — 입력이 아니라 실제 변위다.
  // 벽에 붙어 미는 동안은 서 있는 것과 같으므로 무음이 옳다.
  const grated = s.grates.length > 0;
  const prevX = grated ? s.bodies.map((b) => b.x) : null;
  const prevY = grated ? s.bodies.map((b) => b.y) : null;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (!b.alive || b.frozen) continue;
    const m = b.lastInput;
    let sx = 0;
    let sy = 0;
    if ((m & IN_LEFT) !== 0) sx -= 1;
    if ((m & IN_RIGHT) !== 0) sx += 1;
    if ((m & IN_UP) !== 0) sy -= 1;
    if ((m & IN_DOWN) !== 0) sy += 1;
    if (sx === 0 && sy === 0) continue;
    const sp = speedFor(m, sx !== 0 && sy !== 0);
    b.facing = dirFromDelta(sx, sy);
    // 축분리 이동 + 코너 어시스트. 조작 몸과 잔상이 같은 경로를 탄다.
    const mv = moveBody(s, staticRects, b.x, b.y, BODY_SUB, BODY_SUB, sx * sp, sy * sp);
    b.x = mv.x;
    b.y = mv.y;
  }

  // 4) 소음 — 달리기 / 마이크 / 소음 바닥이 **같은 경로**를 탄다.
  //
  // 한 몸은 최대 **한 개**의 소음만 낸다. 뛰면서 기침하며 격자 위를 지나도
  // 이벤트가 셋으로 늘지 않는다 — 간격은 짧은 쪽, 반경은 큰 쪽 하나로 합친다.
  // 마이크 비트가 0 이고 격자가 없으면 이 블록은 기존 달리기 소음과 정확히 같다.
  s.noises.length = 0;
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    const active = b.alive && !b.frozen;
    const running =
      active && (b.lastInput & IN_RUN) !== 0 && (b.lastInput & MOVE_BITS) !== 0;
    // 마이크 레벨은 테이프에 녹화된 값이다 — 잔상도 자기 테이프의 소리를 그대로 낸다.
    const micRadius = active ? (MIC_NOISE_RADIUS[micLevelOf(b.lastInput)] ?? 0) : 0;
    // 격자 위에서 실제로 움직였는가. 서 있으면 걷기와 마찬가지로 무음이다.
    const onGrate =
      active &&
      prevX !== null &&
      prevY !== null &&
      (b.x !== prevX[i] || b.y !== prevY[i]) &&
      rectOnGrate(s, b.x, b.y);
    if (!running && micRadius === 0 && !onGrate) {
      b.noiseTimer = 0;
      continue;
    }
    b.noiseTimer++;
    const interval = onGrate
      ? Math.min(NOISE_INTERVAL, GRATE_NOISE_INTERVAL)
      : NOISE_INTERVAL;
    if (b.noiseTimer < interval) continue;
    b.noiseTimer = 0;
    const radius = Math.max(
      running ? NOISE_RADIUS : 0,
      micRadius,
      onGrate ? GRATE_NOISE_RADIUS : 0,
    );
    s.noises.push({
      x: b.x + BODY_SUB / 2,
      y: b.y + BODY_SUB / 2,
      radius,
      tick: s.tick,
    });
    // footstep 은 "발소리"라는 청각 피드백 전용이다. 마이크 소음은 플레이어가
    // 이미 자기 귀로 듣고 있으므로 발소리 SFX 를 덧씌우지 않는다.
    if (running) ev.footstep = true;
  }

  // 5) 경비 AI
  updateGuards(s, staticRects);

  // 6) CCTV
  if (updateCctvs(s, staticRects)) ev.alerted = true;

  // 7) 장치 → 채널 → 게이트/CCTV 전원
  if (updateDevices(s)) ev.gateToggled = true;

  // 8) loot
  const holder =
    s.loot.holderId >= 0
      ? s.bodies.find((b) => b.id === s.loot.holderId)
      : undefined;
  if (holder !== undefined) {
    if (!holder.alive || holder.frozen) {
      dropLoot(s, holder); // 잔상이 멈추면 그 자리에 놓고 간다
    } else {
      s.loot.x = holder.x;
      s.loot.y = holder.y;
    }
  } else if (!s.loot.taken) {
    const lx = s.loot.x + BODY_SUB / 2;
    const ly = s.loot.y + BODY_SUB / 2;
    for (let i = 0; i < s.bodies.length; i++) {
      const b = s.bodies[i]!;
      if (!b.alive || b.frozen) continue;
      if (dist2(b.x + BODY_SUB / 2, b.y + BODY_SUB / 2, lx, ly) > LOOT_PICKUP_RANGE * LOOT_PICKUP_RANGE) {
        continue;
      }
      b.carryingLoot = true;
      s.loot.taken = true;
      s.loot.holderId = b.id;
      s.loot.x = b.x;
      s.loot.y = b.y;
      ev.lootTaken = true;
      break;
    }
  }

  // 9) 체포 — 경비와 레이저는 같은 지점에서 판정한다 (규칙도 동일하다)
  const cap = resolveCapture(s);
  if (cap.ghostSpotted) ev.ghostSpotted = true;
  if (cap.captured) {
    ev.captured = true;
    s.tick++;
    return ev;
  }
  const laz = resolveLasers(s);
  if (laz.ghostSpotted) ev.ghostSpotted = true;
  if (laz.captured) {
    ev.captured = true;
    s.tick++;
    return ev;
  }

  // 10) 클리어 — 잔상의 탈출은 무효다 (SPEC §2)
  for (let i = 0; i < s.bodies.length; i++) {
    const b = s.bodies[i]!;
    if (!b.isLive || !b.alive || !b.carryingLoot) continue;
    if (
      aabbOverlap(
        b.x,
        b.y,
        BODY_SUB,
        BODY_SUB,
        s.escape.x,
        s.escape.y,
        s.escape.w,
        s.escape.h,
      )
    ) {
      s.outcome = 'CLEARED';
      ev.cleared = true;
    }
  }

  s.tick++;
  if (s.outcome === 'RUNNING' && s.tick >= MAX_TICKS) s.outcome = 'TIMEUP';
  return ev;
}
