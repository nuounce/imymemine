/**
 * I.MY.ME.MINE — 상태 해시 (FNV-1a 32bit).
 *
 * 결정론 회귀 테스트의 판정 기준. 같은 입력열은 같은 해시를 내야 하고,
 * 한 엔티티의 좌표/상태/타이머가 1이라도 다르면 해시가 달라져야 한다.
 * 그래서 순회 순서를 전부 고정하고, 채널은 이름순으로 정렬해 섞는다.
 */

import type { SimState } from './types';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const GUARD_STATE_CODE: Record<string, number> = {
  PATROL: 1,
  SUSPICIOUS: 2,
  INVESTIGATE: 3,
  CHASE: 4,
  RETURN: 5,
};

const OUTCOME_CODE: Record<string, number> = {
  RUNNING: 1,
  CLEARED: 2,
  CAPTURED: 3,
  TIMEUP: 4,
};

class Fnv {
  h = FNV_OFFSET;

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME);
  }

  /** 부호 포함 32bit 정수를 리틀엔디언 4바이트로 섞는다. */
  int(v: number): void {
    const n = v | 0;
    this.byte(n);
    this.byte(n >>> 8);
    this.byte(n >>> 16);
    this.byte(n >>> 24);
  }

  bool(v: boolean): void {
    this.byte(v ? 0xa5 : 0x5a);
  }

  str(v: string): void {
    for (let i = 0; i < v.length; i++) this.byte(v.charCodeAt(i));
    this.byte(0);
  }
}

export function hashState(s: SimState): number {
  const f = new Fnv();
  f.str(s.level.id);
  f.int(s.tick);
  f.int(s.width);
  f.int(s.height);
  f.int(s.alerts);
  f.int(s.nextId);
  f.byte(OUTCOME_CODE[s.outcome] ?? 0);

  f.int(s.bodies.length);
  for (const b of s.bodies) {
    f.int(b.id);
    f.int(b.slot);
    f.int(b.x);
    f.int(b.y);
    f.int(b.facing);
    f.bool(b.isLive);
    f.bool(b.alive);
    f.bool(b.frozen);
    f.bool(b.carryingLoot);
    f.bool(b.spotted);
    f.int(b.lastInput);
    f.int(b.noiseTimer);
  }

  f.int(s.crates.length);
  for (const c of s.crates) {
    f.int(c.id);
    f.int(c.x);
    f.int(c.y);
  }

  f.int(s.guards.length);
  for (const g of s.guards) {
    f.int(g.id);
    f.int(g.x);
    f.int(g.y);
    f.int(g.facing);
    f.byte(GUARD_STATE_CODE[g.state] ?? 0);
    f.int(g.detect);
    f.int(g.pathIndex);
    f.int(g.waitTimer);
    f.int(g.targetX);
    f.int(g.targetY);
    f.int(g.targetBodyId);
    f.int(g.stateTimer);
  }

  f.int(s.cctvs.length);
  for (const c of s.cctvs) {
    f.int(c.id);
    f.int(c.facing);
    f.int(c.lockTimer);
    f.bool(c.enabled);
  }

  f.int(s.plates.length);
  for (const p of s.plates) {
    f.int(p.id);
    f.bool(p.on);
  }

  f.int(s.buttons.length);
  for (const b of s.buttons) {
    f.int(b.id);
    f.int(b.timer);
    f.bool(b.on);
  }

  f.int(s.levers.length);
  for (const l of s.levers) {
    f.int(l.id);
    f.bool(l.on);
    f.int(l.cooldown);
  }

  f.int(s.gates.length);
  for (const g of s.gates) {
    f.int(g.id);
    f.bool(g.open);
  }

  f.int(s.loot.x);
  f.int(s.loot.y);
  f.bool(s.loot.taken);
  f.int(s.loot.holderId);

  // Map 순회 순서에 의존하지 않도록 채널 이름을 정렬한다.
  const names = [...s.channels.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  f.int(names.length);
  for (const n of names) {
    f.str(n);
    f.bool(s.channels.get(n) ?? false);
  }

  f.int(s.noises.length);
  for (const n of s.noises) {
    f.int(n.x);
    f.int(n.y);
    f.int(n.radius);
    f.int(n.tick);
  }

  return f.h >>> 0;
}
