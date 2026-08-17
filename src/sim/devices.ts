/**
 * I.MY.ME.MINE — 장치와 채널 (SPEC §5.4, §5.5).
 *
 * 채널은 "소스(발판/버튼/레버) → 싱크(게이트/CCTV)" 단방향이며 매 틱 처음부터 재계산된다.
 * 기본 결합은 AND, 레벨에서 `channelMode` 로 채널별 OR 지정.
 * 소스가 하나도 없는 채널은 항상 OFF (빈 AND 를 참으로 보지 않는다).
 */

import {
  BODY_SUB,
  CCTV_FOV_TAN,
  CCTV_LOCK_TICKS,
  CCTV_RANGE,
  CRATE_SUB,
  DIR_STEPS,
  TILE_SUB,
} from './constants';
import {
  aabbOverlap,
  inCone,
  lineBlocked,
  type Rect,
} from './physics';
import type { Laser, SeqGroup, SimState } from './types';

/** 닫힌 게이트는 벽과 똑같이 취급된다. 이동·시야 양쪽에서 쓴다. */
export function closedGateRects(s: SimState): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < s.gates.length; i++) {
    const g = s.gates[i]!;
    if (!g.open) out.push({ x: g.x, y: g.y, w: g.w, h: g.h });
  }
  return out;
}

/** 발판: 바디(시체 포함) 또는 상자가 겹쳐 있는 동안 ON. */
function updatePlates(s: SimState): void {
  for (let i = 0; i < s.plates.length; i++) {
    const p = s.plates[i]!;
    let on = false;
    for (let b = 0; b < s.bodies.length && !on; b++) {
      const body = s.bodies[b]!;
      if (aabbOverlap(body.x, body.y, BODY_SUB, BODY_SUB, p.x, p.y, p.w, p.h)) {
        on = true;
      }
    }
    for (let c = 0; c < s.crates.length && !on; c++) {
      const cr = s.crates[c]!;
      if (aabbOverlap(cr.x, cr.y, CRATE_SUB, CRATE_SUB, p.x, p.y, p.w, p.h)) {
        on = true;
      }
    }
    p.on = on;
  }
}

/** 버튼: 눌린 뒤 holdTicks 동안만 ON. 이게 "시간차"를 만든다 (SPEC §3-3). */
function updateButtons(s: SimState): void {
  for (let i = 0; i < s.buttons.length; i++) {
    const b = s.buttons[i]!;
    if (b.timer > 0) b.timer--;
    b.on = b.timer > 0;
  }
}

function updateLeverCooldowns(s: SimState): void {
  for (let i = 0; i < s.levers.length; i++) {
    const l = s.levers[i]!;
    if (l.cooldown > 0) l.cooldown--;
  }
}

// ── 소음 바닥 (grate) ──────────────────────────────────────────────────────

/**
 * 이 AABB 가 소음 바닥 위에 있는가. 상태가 없으므로 순수 질의다.
 * 소음 **발행** 자체는 world.ts 의 4단계(소음)에서 달리기/마이크와 한 경로로 합쳐진다 —
 * "한 몸은 한 틱에 소음 하나"를 지키려면 세 소스가 같은 지점에서 병합되어야 한다.
 */
export function rectOnGrate(s: SimState, x: number, y: number): boolean {
  for (let i = 0; i < s.grates.length; i++) {
    const g = s.grates[i]!;
    if (aabbOverlap(x, y, BODY_SUB, BODY_SUB, g.x, g.y, g.w, g.h)) return true;
  }
  return false;
}

// ── 주기 레이저 (laser) ────────────────────────────────────────────────────

/** 위상만으로 결정되는 ON/OFF. 난수도 부동소수도 없다. */
export function laserPhaseOn(tick: number, l: Laser): boolean {
  const p = l.periodTicks;
  if (p <= 0) return false;
  const t = (((tick + l.phase) % p) + p) % p;
  return t < l.onTicks;
}

/**
 * 선분 × AABB 교차 — 완전 정수 SAT.
 *
 * 축은 세 개면 충분하다: 박스의 X, 박스의 Y, 그리고 선분의 법선.
 * 선분 방향축은 검사할 필요가 없다 — 그 축에서 선분의 투영 범위는 자기 AABB 의
 * 투영 범위와 **정확히 같으므로**(양 끝점이 곧 극단 꼭짓점) X·Y 가 안 가르면
 * 방향축도 못 가른다.
 *
 * 좌표는 최대 수십만 서브픽셀이라 외적은 ~1e11 — 배정밀도의 정확 정수 범위
 * (2^53) 안이므로 반올림이 개입하지 않는다.
 */
export function segmentHitsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const rx1 = rx + rw;
  const ry1 = ry + rh;
  // 1) 박스 X / Y 축 (aabbOverlap 과 같은 반열린 규약 — 스치기만 하면 통과)
  if ((x0 < x1 ? x1 : x0) <= rx || (x0 < x1 ? x0 : x1) >= rx1) return false;
  if ((y0 < y1 ? y1 : y0) <= ry || (y0 < y1 ? y0 : y1) >= ry1) return false;

  // 2) 선분 법선 축 — 네 꼭짓점의 외적 부호가 모두 같으면 선 전체가 한쪽에 있다
  const dx = x1 - x0;
  const dy = y1 - y0;
  const c00 = dx * (ry - y0) - dy * (rx - x0);
  const c10 = dx * (ry - y0) - dy * (rx1 - x0);
  const c01 = dx * (ry1 - y0) - dy * (rx - x0);
  const c11 = dx * (ry1 - y0) - dy * (rx1 - x0);
  if (c00 > 0 && c10 > 0 && c01 > 0 && c11 > 0) return false;
  if (c00 < 0 && c10 < 0 && c01 < 0 && c11 < 0) return false;
  return true;
}

/**
 * 레이저 사망 판정. world.ts 의 **9단계(체포 판정)** 와 같은 지점에서 불린다.
 *
 * 규칙은 경비 체포와 동일하다 (guard.ts `resolveCapture`):
 * - 조작 몸(I) → 시체가 되고 루프 종료(CAPTURED), 알람 +1.
 * - 잔상 → **발각 처리만** 하고 재생은 계속된다. 잔상을 죽이면 미끼가 성립하지 않는다.
 * - 시체 → 판정 대상이 아니다.
 */
export function resolveLasers(s: SimState): {
  captured: boolean;
  ghostSpotted: boolean;
} {
  let ghostSpotted = false;
  for (let i = 0; i < s.lasers.length; i++) {
    const l = s.lasers[i]!;
    if (!l.on) continue;
    for (let b = 0; b < s.bodies.length; b++) {
      const body = s.bodies[b]!;
      if (!body.alive) continue;
      if (
        !segmentHitsRect(
          l.x0,
          l.y0,
          l.x1,
          l.y1,
          body.x,
          body.y,
          BODY_SUB,
          BODY_SUB,
        )
      ) {
        continue;
      }
      if (body.isLive) {
        body.alive = false;
        body.spotted = true;
        s.alerts++;
        s.outcome = 'CAPTURED';
        return { captured: true, ghostSpotted };
      }
      body.spotted = true;
      ghostSpotted = true;
    }
  }
  return { captured: false, ghostSpotted };
}

/** 채널이 확정된 뒤에 전원을 반영한다 — disableChannel 이 버스 중재까지 거친 값을 본다. */
function applyLaserPower(s: SimState): void {
  for (let i = 0; i < s.lasers.length; i++) {
    const l = s.lasers[i]!;
    const disabled =
      l.disableChannel !== undefined &&
      (s.channels.get(l.disableChannel) ?? false);
    l.on = !disabled && laserPhaseOn(s.tick, l);
  }
}

// ── 순차 버튼 (seqButton) ──────────────────────────────────────────────────

/** 레벨 정의에서 그룹 상태를 만든다. 그룹 이름 오름차순 — 순회 순서를 못 박는다. */
export function buildSeqGroups(
  defs: readonly { group: string; order: number }[],
): SeqGroup[] {
  const byGroup = new Map<string, number[]>();
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const list = byGroup.get(d.group);
    if (list === undefined) byGroup.set(d.group, [d.order]);
    else list.push(d.order);
  }
  const names = [...byGroup.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map((group) => ({
    group,
    orders: (byGroup.get(group) ?? []).slice().sort((a, b) => a - b),
    next: 0,
    done: false,
  }));
}

/**
 * 순차 버튼을 눌렀다. 맞는 순서면 진행, **틀리면 그룹이 0 으로 리셋**된다.
 * 완성된 그룹은 다시 눌러도 변하지 않는다 (영구 ON).
 *
 * "틀린 순서"에는 이미 지나간 order 를 다시 누르는 것도 포함된다 — 순서가
 * 자원이라는 말은 되돌릴 수 없다는 뜻이다.
 */
export function pressSeqButton(s: SimState, group: string, order: number): void {
  for (let i = 0; i < s.seqGroups.length; i++) {
    const g = s.seqGroups[i]!;
    if (g.group !== group) continue;
    if (g.done) return;
    if (g.orders[g.next] === order) {
      g.next++;
      if (g.next >= g.orders.length) g.done = true;
    } else {
      g.next = 0;
    }
    return;
  }
}

// ── 전력 채널 (powerBus) ───────────────────────────────────────────────────

/**
 * 한 버스에서 동시에 ON 일 수 있는 채널은 하나뿐이다.
 *
 * - 이번 틱에 **새로** ON 을 요청한 채널이 있으면 그쪽이 전력을 가져간다.
 *   (여럿이 동시에 새로 켜지면 `channels` 배열의 앞선 인덱스가 이긴다.)
 * - 아무도 새로 켜지 않았으면 쥐고 있던 채널이 유지되고, 그 채널이 요청을
 *   놓으면 남은 요청자 중 앞선 인덱스가 이어받는다.
 *
 * `prevOn` 에는 **강제 OFF 당한 결과가 아니라 원래 소스 요청**을 기록한다.
 * 그래야 밀려난 채널이 매 틱 "새로 켜짐"으로 오인되어 전력을 되뺏지 않는다.
 */
export function applyPowerBuses(s: SimState): void {
  for (let i = 0; i < s.powerBuses.length; i++) {
    const bus = s.powerBuses[i]!;
    const n = bus.channels.length;
    const raw: boolean[] = new Array<boolean>(n);
    for (let c = 0; c < n; c++) {
      raw[c] = s.channels.get(bus.channels[c]!) ?? false;
    }

    let winner = -1;
    for (let c = 0; c < n; c++) {
      if (raw[c] === true && bus.prevOn[c] !== true) {
        winner = c;
        break;
      }
    }
    if (winner < 0) {
      const held = bus.activeIndex;
      if (held >= 0 && raw[held] === true) {
        winner = held;
      } else {
        for (let c = 0; c < n; c++) {
          if (raw[c] === true) {
            winner = c;
            break;
          }
        }
      }
    }

    bus.activeIndex = winner;
    for (let c = 0; c < n; c++) {
      const name = bus.channels[c]!;
      if (s.channels.has(name)) s.channels.set(name, c === winner);
      bus.prevOn[c] = raw[c] === true;
    }
  }
}

/** 소스들을 모아 채널 ON/OFF 를 확정한다. */
export function evaluateChannels(s: SimState): void {
  const total = new Map<string, number>();
  const active = new Map<string, number>();

  const add = (channel: string, on: boolean): void => {
    total.set(channel, (total.get(channel) ?? 0) + 1);
    if (on) active.set(channel, (active.get(channel) ?? 0) + 1);
  };

  for (let i = 0; i < s.plates.length; i++) {
    const p = s.plates[i]!;
    add(p.channel, p.on);
  }
  for (let i = 0; i < s.buttons.length; i++) {
    const b = s.buttons[i]!;
    add(b.channel, b.on);
  }
  for (let i = 0; i < s.levers.length; i++) {
    const l = s.levers[i]!;
    add(l.channel, l.on);
  }
  // 완성된 순차 버튼 그룹은 그룹 이름을 채널로 쓰는 소스다.
  for (let i = 0; i < s.seqGroups.length; i++) {
    const g = s.seqGroups[i]!;
    add(g.group, g.done);
  }

  s.channels.clear();
  const modes = s.level.channelMode;
  for (const [channel, count] of total) {
    const hits = active.get(channel) ?? 0;
    const mode = modes?.[channel] ?? 'AND';
    s.channels.set(channel, mode === 'OR' ? hits > 0 : hits === count);
  }
}

/** 채널 반영. 게이트 개폐가 이번 틱에 바뀌었으면 true. */
function applyGates(s: SimState): boolean {
  let toggled = false;
  for (let i = 0; i < s.gates.length; i++) {
    const g = s.gates[i]!;
    const ch = s.channels.get(g.channel) ?? false;
    const open = g.invert ? !ch : ch;
    if (open !== g.open) {
      g.open = open;
      toggled = true;
    }
  }
  return toggled;
}

function applyCctvPower(s: SimState): void {
  for (let i = 0; i < s.cctvs.length; i++) {
    const c = s.cctvs[i]!;
    c.enabled =
      c.disableChannel === undefined
        ? true
        : !(s.channels.get(c.disableChannel) ?? false);
  }
}

/**
 * SPEC §4 의 7단계. 장치 상태 → 채널 → 게이트/CCTV/레이저 전원까지 한 번에.
 * 반환값 = 게이트 개폐 변화 여부 (렌더/사운드용).
 *
 * 버스 중재는 채널 확정 **직후**, 싱크 반영 **직전**이다. 그래야 게이트·CCTV·
 * 레이저가 모두 "전력을 실제로 받은" 채널만 본다.
 */
export function updateDevices(s: SimState): boolean {
  updatePlates(s);
  updateButtons(s);
  updateLeverCooldowns(s);
  evaluateChannels(s);
  applyPowerBuses(s);
  const toggled = applyGates(s);
  applyCctvPower(s);
  applyLaserPower(s);
  return toggled;
}

/** 스윕 위상 → facing. 삼각파(왕복)라 부동소수 없이 계산된다. */
function sweepFacing(s: SimState, camIndex: number): number {
  const c = s.cctvs[camIndex]!;
  const period = Math.max(2, c.sweepTicks);
  const t = ((s.tick + c.phase) % period + period) % period;
  const half = period / 2 | 0;
  const u = t <= half ? t : period - t; // 0..half
  const offset =
    half === 0 ? 0 : Math.floor((u * 2 * c.sweepArc) / half) - c.sweepArc;
  return (((c.baseFacing + offset) % DIR_STEPS) + DIR_STEPS) % DIR_STEPS;
}

/**
 * CCTV 갱신 (SPEC §4 의 6단계). 살아있는 바디를 CCTV_LOCK_TICKS 연속 포착하면
 * 알람: 모든 경비가 그 지점으로 CHASE 전환.
 * 반환값 = 이번 틱에 알람이 울렸는가.
 */
export function updateCctvs(s: SimState, blockers: readonly Rect[]): boolean {
  let alerted = false;
  for (let i = 0; i < s.cctvs.length; i++) {
    const c = s.cctvs[i]!;
    if (!c.enabled) {
      c.lockTimer = 0;
      continue;
    }
    c.facing = sweepFacing(s, i);
    const cx = c.x + TILE_SUB / 2;
    const cy = c.y + TILE_SUB / 2;

    let seenX = -1;
    let seenY = -1;
    for (let b = 0; b < s.bodies.length; b++) {
      const body = s.bodies[b]!;
      if (!body.alive) continue; // 시체는 이미 처리된 것으로 본다 (SPEC §5.3)
      const bx = body.x + BODY_SUB / 2;
      const by = body.y + BODY_SUB / 2;
      if (!inCone(bx - cx, by - cy, c.facing, CCTV_RANGE, CCTV_FOV_TAN)) continue;
      if (lineBlocked(s, blockers, cx, cy, bx, by)) continue;
      seenX = bx;
      seenY = by;
      body.spotted = true;
      break; // id 오름차순 첫 대상만 — 결정론
    }

    if (seenX < 0) {
      c.lockTimer = 0;
      continue;
    }
    c.lockTimer++;
    if (c.lockTimer < CCTV_LOCK_TICKS) continue;

    c.lockTimer = 0;
    s.alerts++;
    alerted = true;
    for (let g = 0; g < s.guards.length; g++) {
      const guard = s.guards[g]!;
      guard.state = 'CHASE';
      guard.detect = 100;
      guard.targetX = seenX;
      guard.targetY = seenY;
      guard.targetBodyId = -1;
      guard.stateTimer = 0;
    }
  }
  return alerted;
}
