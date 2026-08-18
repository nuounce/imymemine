/**
 * 전수 QA — 15 스테이지가 **실제로 클리어되는가**, 그리고 그 클리어가
 * 사람이 손으로 재현할 만한 여유를 가지고 있는가.
 *
 * `solvability.test.ts` 는 "정답이 존재한다"만 묻는다. 이 파일은 그 위에
 * QA 관점의 질문을 얹는다:
 *   A. 클리어까지 몇 틱 걸렸나 — 60초(3600틱) 대비 여유가 얼마인가
 *   B. 새로 들어온 요소(경비 4종·눈뽕)가 실제로 배치되어 쓰이는가
 *   C. "잔상 0개로는 못 깬다" 라는 설계 전제가 여전히 서는가
 *
 * ## 무엇을 실패로 잡고 무엇을 경고로 흘리는가
 * 실패(테스트 깨짐)는 **게임이 망가진 것**에만 쓴다 — 클리어 불능, par 초과,
 * 안 쓰이는 경비 유형, 설계 전제 붕괴, 도피로 없는 BRUTE, 단독 WATCHER.
 * "여유가 5% 미만" 같은 난이도 판정은 **경고 출력**이다. 빡빡한 것은 고장이 아니라
 * 판단 대상이고, 레벨을 손볼 때마다 테스트가 깨지면 아무도 안 읽게 되기 때문이다.
 *
 * 눈뽕은 예외로 **실패**다. 한때는 배치가 0개라 경고로 흘렸지만, 지금은 3막의 세
 * 스테이지에 하나씩 놓여 있고 정답 경로에서 잔상이 그것을 터뜨린다. 그러니 여기서
 * 묻는 것은 "놓였는가"가 아니라 **"놓인 것이 정답에서 실제로 쓰이는가"** 이며,
 * 그게 무너지면 아이템이 다시 장식으로 돌아간 것이므로 고장으로 친다.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { STAGES } from '../src/game/levels';
import { GUARD_KINDS, IN_FLASH, MAX_TICKS, TILE, TILE_SUB } from '../src/sim/constants';
import type { GuardKind, LevelDef, SimOutcome, Tape } from '../src/sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../src/sim/world';
import { S6_ALT, SOLUTIONS, type Solution } from './solutions';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 여유가 이 비율 미만이면 "손으로는 사실상 불가능" 경고를 낸다. */
const TIGHT_RATIO = 0.05;
const TIGHT_TICKS = Math.floor(MAX_TICKS * TIGHT_RATIO); // 180
/** 관용 폭을 재는 최대 지연 (±틱). 24틱 = 0.4초. */
const TOLERANCE_PROBE = 24;
/** 관용 폭이 이 이하면 "프레임 단위 정밀도" 경고. 6틱 = 0.1초. */
const TOLERANCE_WARN = 6;

const ALL_KINDS: GuardKind[] = ['SENTRY', 'HOUND', 'BRUTE', 'WATCHER'];

// ══════════════════════════════════════════════════════════════════════════
// 계측
// ══════════════════════════════════════════════════════════════════════════

interface Measured {
  outcome: SimOutcome;
  /** 클리어한 루프에서 사용된 잔상 수. */
  ghostsUsed: number;
  /** 클리어가 확정된 틱. */
  clearTick: number;
  /** 각 루프가 실제로 소비한 틱 (테이프가 중간에 끝나면 그 길이). */
  loopTicks: number[];
  /** 클리어 순간까지 울린 경보 수. */
  alerts: number;
  carryingLoot: boolean;
  /** 클리어한 루프 시점에 확정돼 있던 잔상들. 관용 폭 측정에 쓴다. */
  ghosts: GhostSpec[];
  /** 클리어하는 루프에서 경비가 눈이 멀어 있던 틱 수 (눈뽕이 실제로 터졌는가). */
  dazedTicks: number;
}

/**
 * `tapes.ts` 의 `playSolution` 과 같은 방식으로 루프를 순서대로 돌리되,
 * **루프마다 소비한 틱**과 클리어 시점의 `alerts` 를 함께 남긴다.
 * (playSolution 은 그 값들을 돌려주지 않아 QA 표를 만들 수 없다.)
 */
function measure(level: LevelDef, loops: readonly Uint16Array[]): Measured {
  const ghosts: GhostSpec[] = [];
  const loopTicks: number[] = [];

  for (let i = 0; i < loops.length; i++) {
    const t = loops[i]!;
    const sim = createWorld(level, ghosts.slice());
    let used = 0;
    let dazedTicks = 0;
    while (used < t.length && sim.outcome === 'RUNNING') {
      stepWorld(sim, t[used]!);
      used++;
      if (sim.guards.some((g) => g.dazed > 0)) dazedTicks++;
    }
    loopTicks.push(used);

    if (sim.outcome === 'CLEARED') {
      return {
        outcome: 'CLEARED',
        ghostsUsed: i,
        clearTick: sim.tick,
        loopTicks,
        alerts: sim.alerts,
        carryingLoot: sim.bodies[0]!.carryingLoot,
        ghosts,
        dazedTicks,
      };
    }
    ghosts.push({ tape: t.slice(0, used), corpse: sim.outcome === 'CAPTURED' });

    if (i === loops.length - 1) {
      return {
        outcome: sim.outcome,
        ghostsUsed: i,
        clearTick: sim.tick,
        loopTicks,
        alerts: sim.alerts,
        carryingLoot: sim.bodies[0]!.carryingLoot,
        ghosts,
        dazedTicks,
      };
    }
  }
  throw new Error(`${level.id}: 루프가 하나도 없다`);
}

/**
 * 마지막(클리어하는) 테이프를 `d` 틱만큼 밀어서 다시 돌린다.
 * `d > 0` = 그만큼 늦게 출발, `d < 0` = 그만큼 일찍. 잔상은 그대로 둔다 —
 * 즉 "과거의 나는 정확히 그대로인데, 지금의 내 손만 d 틱 어긋났다"의 재현이다.
 */
function clearsWithDelay(level: LevelDef, ghosts: GhostSpec[], live: Tape, d: number): boolean {
  const sim = createWorld(level, ghosts.map((g) => ({ ...g })));
  const len = live.length + Math.max(0, d);
  for (let i = 0; i < len && sim.outcome === 'RUNNING'; i++) {
    const j = i - d;
    stepWorld(sim, j >= 0 && j < live.length ? live[j]! : 0);
  }
  return sim.outcome === 'CLEARED';
}

/**
 * 정답이 견디는 **손 어긋남의 폭**. 0 을 포함한 연속 구간만 센다 —
 * 멀리 떨어진 곳에서 우연히 다시 통하는 지연은 사람이 노릴 수 있는 값이 아니다.
 *
 * 이것이 "60초 중 몇 틱 남았나"보다 실제 난이도에 가깝다. 남은 시간이 넉넉해도
 * 통과 창이 3틱이면 손으로는 못 친다.
 */
function tolerance(level: LevelDef, m: Measured, loops: readonly Uint16Array[]): {
  lo: number;
  hi: number;
  width: number;
} {
  const live = loops[m.ghostsUsed]!;
  let lo = 0;
  let hi = 0;
  while (lo > -TOLERANCE_PROBE && clearsWithDelay(level, m.ghosts, live, lo - 1)) lo--;
  while (hi < TOLERANCE_PROBE && clearsWithDelay(level, m.ghosts, live, hi + 1)) hi++;
  return { lo, hi, width: hi - lo + 1 };
}

/** 스테이지별 계측 결과. 표와 개별 검사가 같은 값을 쓰도록 한 번만 돌린다. */
const RESULTS: { sol: Solution; m: Measured; tol: ReturnType<typeof tolerance> }[] =
  SOLUTIONS.map((sol) => {
    const m = measure(sol.level, sol.loops);
    return { sol, m, tol: tolerance(sol.level, m, sol.loops) };
  });

function kindsOf(level: LevelDef): GuardKind[] {
  return (level.guards ?? []).map((g) => g.kind ?? 'SENTRY');
}

// ══════════════════════════════════════════════════════════════════════════
// A. 전수 클리어 검증
// ══════════════════════════════════════════════════════════════════════════

describe('A. 15 스테이지 전수 클리어', () => {
  it('요약 표', () => {
    const rows = [
      '',
      '  ┌── QA 요약 (실측) ' + '─'.repeat(70),
      '  스테이지              par 사용 클리어틱  여유틱  여유%  알람  관용폭  경비',
    ];
    for (const { sol, m, tol } of RESULTS) {
      const slack = MAX_TICKS - m.clearTick;
      const pct = ((slack / MAX_TICKS) * 100).toFixed(1);
      const flags =
        (slack < TIGHT_TICKS ? ' ◀시간빡빡' : '') +
        (tol.width <= TOLERANCE_WARN ? ' ◀손빡빡' : '');
      rows.push(
        `  ${sol.level.id.padEnd(16)} ${String(sol.level.par).padStart(4)}` +
          `${String(m.ghostsUsed).padStart(5)}` +
          `${String(m.clearTick).padStart(9)}` +
          `${String(slack).padStart(8)}` +
          `${pct.padStart(7)}` +
          `${String(m.alerts).padStart(6)}` +
          `${`${tol.lo}~+${tol.hi}`.padStart(8)}` +
          `  ${kindsOf(sol.level).join('+') || '-'}${flags}`,
      );
    }
    rows.push('  └' + '─'.repeat(88));
    rows.push(
      `  관용폭 = 마지막 테이프를 몇 틱 늦거나 이르게 쳐도 여전히 클리어되는가 ` +
        `(탐색 범위 ±${TOLERANCE_PROBE}틱 = ±0.4초)`,
    );
    console.log(rows.join('\n'));
  });

  for (const { sol, m } of RESULTS) {
    const { level } = sol;
    it(`${level.id} ${level.name} — 클리어되고 par(${level.par}) 이내다`, () => {
      assert.equal(
        m.outcome,
        'CLEARED',
        `${level.id}: 클리어 실패 (outcome=${m.outcome}, tick=${m.clearTick})`,
      );
      assert.equal(m.carryingLoot, true, `${level.id}: 코어를 안 들고 탈출했다`);
      // C-11: par 를 초과하지 않는다.
      assert.ok(
        m.ghostsUsed <= level.par,
        `${level.id}: 잔상 ${m.ghostsUsed}개 사용, par ${level.par} 초과`,
      );
      // 역할 서술과 실제 사용 잔상 수가 어긋나면 문서가 거짓말을 하는 것이다.
      assert.equal(m.ghostsUsed, sol.roles.length - 1, `${level.id}: roles 와 사용 잔상 수 불일치`);
    });
  }

  it('어떤 루프도 60초(3600틱)를 넘지 않는다 — 넘으면 애초에 녹화가 불가능하다', () => {
    for (const { sol, m } of RESULTS) {
      for (let i = 0; i < m.loopTicks.length; i++) {
        assert.ok(
          m.loopTicks[i]! <= MAX_TICKS,
          `${sol.level.id}: ${i}번 루프가 ${m.loopTicks[i]}틱 — 한 루프(${MAX_TICKS}틱)를 넘는다`,
        );
      }
    }
  });

  it('타이밍 여유 — 5% 미만이면 경고 (실패가 아니다)', () => {
    const tight: string[] = [];
    for (const { sol, m } of RESULTS) {
      const slack = MAX_TICKS - m.clearTick;
      if (slack < TIGHT_TICKS) {
        tight.push(
          `${sol.level.id}: 클리어 ${m.clearTick}틱 / 여유 ${slack}틱 ` +
            `(${((slack / MAX_TICKS) * 100).toFixed(1)}%)`,
        );
      }
      // 정답 테이프가 시간 안에 들어온다는 것 자체는 사실로 못 박는다.
      assert.ok(m.clearTick <= MAX_TICKS, `${sol.level.id}: 클리어가 제한 시간을 넘겼다`);
    }
    if (tight.length > 0) {
      console.warn(
        `\n  [경고] 여유 ${TIGHT_RATIO * 100}% 미만 — 손으로 플레이하면 사실상 불가능할 수 있다:\n` +
          tight.map((s) => `    - ${s}`).join('\n'),
      );
    } else {
      console.log(`  [OK] 여유 ${TIGHT_RATIO * 100}% 미만인 스테이지 없음`);
    }
  });

  it('손 정밀도 관용 폭 — 좁으면 경고 (실패가 아니다)', () => {
    const narrow: string[] = [];
    for (const { sol, tol } of RESULTS) {
      // 0 틱 어긋남에서 클리어된다는 것은 위에서 이미 못 박았다. 여기서는 폭만 본다.
      assert.ok(tol.width >= 1, `${sol.level.id}: 관용 폭이 0 이다`);
      if (tol.width <= TOLERANCE_WARN) {
        narrow.push(
          `${sol.level.id}: ${tol.lo}~+${tol.hi}틱 (폭 ${tol.width}틱 = ` +
            `${((tol.width / 60) * 1000).toFixed(0)}ms)`,
        );
      }
    }
    if (narrow.length > 0) {
      console.warn(
        `\n  [경고] 정답 입력을 ${TOLERANCE_WARN}틱(${((TOLERANCE_WARN / 60) * 1000).toFixed(0)}ms) 이내로 맞춰야 하는 스테이지 —\n` +
          '         남은 시간과 무관하게 손으로는 어렵다:\n' +
          narrow.map((s) => `    - ${s}`).join('\n'),
      );
    } else {
      console.log(`  [OK] 관용 폭 ${TOLERANCE_WARN}틱 이하인 스테이지 없음`);
    }
  });

  it('알람 없이 깨지는 스테이지 집계 (경고 없음 — 정보)', () => {
    const noisy = RESULTS.filter(({ m }) => m.alerts > 0);
    console.log(
      noisy.length === 0
        ? '  [정보] 15 스테이지 전부 알람 0회로 클리어된다'
        : '  [정보] 알람이 울리는 채로 클리어되는 스테이지: ' +
            noisy.map(({ sol, m }) => `${sol.level.id}(${m.alerts})`).join(', '),
    );
    for (const { sol, m } of RESULTS) {
      assert.ok(m.alerts >= 0, sol.level.id);
    }
  });

  it('06_MY 는 격자 지름길 배정으로도 par 안에 클리어된다', () => {
    const alt = measure(S6_ALT.level, S6_ALT.loops);
    assert.equal(alt.outcome, 'CLEARED', `06_MY(ALT): outcome=${alt.outcome}`);
    assert.ok(alt.ghostsUsed <= S6_ALT.level.par);
    console.log(
      `  [정보] 06_MY 두 배정 — 기본 ${RESULTS[5]!.m.clearTick}틱 / 격자 ${alt.clearTick}틱`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. 새 요소가 실제로 쓰이는가
// ══════════════════════════════════════════════════════════════════════════

describe('B. 경비 4종과 눈뽕이 실제로 배치되어 있는가', () => {
  it('경비 4종이 각각 최소 한 스테이지에 나온다', () => {
    const byKind = new Map<GuardKind, string[]>(ALL_KINDS.map((k) => [k, []]));
    for (const level of STAGES) {
      for (const k of new Set(kindsOf(level))) byKind.get(k)!.push(level.id);
    }
    console.log(
      '\n  경비 유형별 등장 스테이지:\n' +
        ALL_KINDS.map(
          (k) =>
            `    ${k.padEnd(8)} ${byKind.get(k)!.length}개 — ` +
            (byKind.get(k)!.join(', ') || '(없음)'),
        ).join('\n'),
    );
    for (const k of ALL_KINDS) {
      assert.ok(
        byKind.get(k)!.length > 0,
        `${k} 가 어느 스테이지에도 배치되지 않았다 — 만들어 놓고 안 쓰는 유형이다`,
      );
    }
  });

  it('눈뽕(flashes)이 배치돼 있고, 바닥 위이며, 한 스테이지에 하나씩이다', () => {
    const placed = STAGES.filter((l) => (l.flashes ?? []).length > 0);
    console.log(
      `  [정보] 눈뽕 배치 스테이지: ` +
        placed.map((l) => `${l.id}(${(l.flashes ?? []).length}개)`).join(', '),
    );
    assert.ok(
      placed.length >= 3,
      `눈뽕이 ${placed.length}개 스테이지에만 있다 — 시뮬은 되는데 플레이 중에 등장하지 않는 아이템이 된다`,
    );
    for (const level of placed) {
      assert.equal(
        (level.flashes ?? []).length,
        1,
        `${level.id}: 한 스테이지에 눈뽕이 둘 이상이다 — 모든 퍼즐이 "눈뽕으로 밀기"가 된다`,
      );
      for (const f of level.flashes ?? []) {
        assert.notEqual(
          level.tiles[f.ty]![f.tx],
          '#',
          `${level.id}: 눈뽕 (${f.tx},${f.ty}) 이 벽 안에 있다`,
        );
      }
    }
    // 1~2막은 코어 루프와 경비 유형을 배우는 구간이다. 아이템이 끼면 산만해진다.
    const ACT3_FROM = 8; // 09_ME 부터
    for (const level of placed) {
      assert.ok(
        STAGES.indexOf(level) >= ACT3_FROM,
        `${level.id}: 3막(09_ME) 이전에 눈뽕이 놓였다`,
      );
    }
  });

  /**
   * 배치만으로는 부족하다. 이 아이템의 설계 의도는 **"과거의 내가 정확한 순간에
   * 터뜨려 주고 지금의 내가 그 틈으로 지나간다"** 이므로, 정답 경로에서
   *   (1) 눈뽕 비트를 실은 것은 **잔상의 테이프**여야 하고 (조작 몸의 만능 탈출 버튼이 아니다)
   *   (2) 그 결과 클리어하는 루프에서 실제로 **눈이 먼 경비가 생겨야** 한다
   * 둘 다 실측으로 확인한다.
   */
  it('배치된 눈뽕은 정답 경로에서 잔상이 터뜨린다 — 조작 몸이 쓰는 게 아니다', () => {
    const report: string[] = [];
    for (const { sol, m } of RESULTS) {
      if ((sol.level.flashes ?? []).length === 0) continue;
      const firing: number[] = [];
      sol.loops.forEach((t, i) => {
        for (const mask of t) {
          if ((mask & IN_FLASH) !== 0) {
            firing.push(i);
            break;
          }
        }
      });
      assert.ok(
        firing.length > 0,
        `${sol.level.id}: 눈뽕을 놓아 놓고 정답 테이프 어디에서도 쓰지 않는다`,
      );
      assert.ok(
        !firing.includes(m.ghostsUsed),
        `${sol.level.id}: 조작 몸(마지막 테이프)이 눈뽕을 쓴다 — 만능 탈출 버튼이 되면 설계가 죽는다`,
      );
      assert.ok(
        m.dazedTicks > 0,
        `${sol.level.id}: 잔상이 눈뽕을 터뜨렸는데 클리어 루프에서 눈이 먼 경비가 없다 — 아무 일도 안 하는 연출이다`,
      );
      report.push(
        `    ${sol.level.id.padEnd(16)} 잔상 ${firing.join(',')}번 루프가 사용 · ` +
          `클리어 루프에서 경비 실명 ${m.dazedTicks}틱`,
      );
    }
    console.log('\n  눈뽕 사용 실측:\n' + report.join('\n'));
  });

  it('WATCHER 가 단독으로 서 있는 스테이지가 없다 (혼자면 무해하다)', () => {
    const lone: string[] = [];
    for (const level of STAGES) {
      const kinds = kindsOf(level);
      if (kinds.length > 0 && kinds.every((k) => k === 'WATCHER')) lone.push(level.id);
    }
    console.log(
      lone.length === 0
        ? '  [OK] WATCHER 는 항상 다른 경비와 함께 배치되어 있다'
        : `  [발견] WATCHER 단독 스테이지: ${lone.join(', ')}`,
    );
    assert.deepEqual(
      lone,
      [],
      `WATCHER 는 직접 잡지 않는다 — 부를 경비가 없으면 아무 일도 일어나지 않는다: ${lone.join(', ')}`,
    );
  });

  it('WATCHER 의 경보가 닿는 거리에 다른 경비가 있다', () => {
    // ALERT_RADIUS = 224 서브픽셀단위 = 7타일. 순찰 경로의 어느 점이든 7타일 안에
    // 들어올 수 있으면 "부를 수 있는 경비"로 본다.
    const REACH = 7;
    for (const level of STAGES) {
      const guards = level.guards ?? [];
      for (const w of guards.filter((g) => g.kind === 'WATCHER')) {
        const wp = w.path[0]!;
        const canCall = guards.some((g) => {
          if (g === w || g.kind === 'WATCHER') return false;
          return g.path.some(
            (p) => Math.abs(p.tx - wp.tx) <= REACH && Math.abs(p.ty - wp.ty) <= REACH,
          );
        });
        assert.ok(
          canCall,
          `${level.id}: WATCHER (${wp.tx},${wp.ty}) 의 경보 반경 ${REACH}타일 안에 순찰 경비가 없다`,
        );
      }
    }
  });
});

// ── BRUTE 도피로 ───────────────────────────────────────────────────────────

/**
 * BRUTE 는 40px 라 32px 통로에 물리적으로 못 들어간다. 그러니 이 유형을 쓰는 방에는
 *   (1) 순찰 지점마다 40px 가 설 수 있고
 *   (2) 그 **가까이에** 40px 는 못 들어가는데 몸(24px)은 들어가는 칸이 있어야 한다.
 *
 * (2)가 멀면 도피로로 쓸 수 없다. `solvability.test.ts` 는 반경 12타일 · 순찰
 * **웨이포인트**만 기준으로 느슨하게 보므로, 여기서는 두 군데를 조인다:
 *   · 거리 기준을 BRUTE 자신의 시야 거리(192px = 6타일)로 낮춘다 — "덩치가 나를
 *     볼 수 있는 범위 안에 덩치가 못 들어오는 칸이 있다" 가 도피로의 정의다.
 *   · 웨이포인트가 아니라 **순찰선 위의 모든 타일**에서 재기 때문에, 왕복 중간에서만
 *     닿는 도피로도 정확히 잡힌다.
 */
const BRUTE_PX = 40;
const REFUGE_RADIUS = GUARD_KINDS.BRUTE.viewRange / TILE_SUB; // 6

function tileIsWall(level: LevelDef, tx: number, ty: number): boolean {
  if (ty < 0 || ty >= level.tiles.length) return true;
  const row = level.tiles[ty]!;
  if (tx < 0 || tx >= row.length) return true;
  return row[tx] === '#';
}

/** 40px 박스의 중심이 이 타일 안인 위치가 하나라도 벽에 닿지 않는가. */
function bruteCanStand(level: LevelDef, tx: number, ty: number): boolean {
  if (tileIsWall(level, tx, ty)) return false;
  const half = BRUTE_PX / 2;
  for (let ox = 0; ox < TILE; ox++) {
    for (let oy = 0; oy < TILE; oy++) {
      const x0 = tx * TILE + ox - half;
      const y0 = ty * TILE + oy - half;
      let ok = true;
      for (let gx = Math.floor(x0 / TILE); gx <= Math.floor((x0 + BRUTE_PX - 1) / TILE); gx++) {
        for (let gy = Math.floor(y0 / TILE); gy <= Math.floor((y0 + BRUTE_PX - 1) / TILE); gy++) {
          if (tileIsWall(level, gx, gy)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (ok) return true;
    }
  }
  return false;
}

/** 웨이포인트를 이은 순찰선 위의 타일 전부 (경비는 점이 아니라 선 위를 오간다). */
function patrolLine(
  path: readonly { tx: number; ty: number }[],
): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % path.length]!;
    const n = Math.max(Math.abs(b.tx - a.tx), Math.abs(b.ty - a.ty));
    for (let k = 0; k <= n; k++) {
      out.push({
        tx: a.tx + Math.round(((b.tx - a.tx) * k) / (n || 1)),
        ty: a.ty + Math.round(((b.ty - a.ty) * k) / (n || 1)),
      });
    }
  }
  return out;
}

/** 순찰선에서 `REFUGE_RADIUS` 안에 있으면서 40px 가 못 들어가는 바닥 칸 전부. */
function refugesNear(
  level: LevelDef,
  path: readonly { tx: number; ty: number }[],
): { tile: { tx: number; ty: number }; dist: number }[] {
  const line = patrolLine(path);
  const out: { tile: { tx: number; ty: number }; dist: number }[] = [];
  for (let ty = 0; ty < level.tiles.length; ty++) {
    for (let tx = 0; tx < level.tiles[ty]!.length; tx++) {
      if (tileIsWall(level, tx, ty)) continue;
      if (bruteCanStand(level, tx, ty)) continue;
      let d = Infinity;
      for (const p of line) {
        d = Math.min(d, Math.max(Math.abs(p.tx - tx), Math.abs(p.ty - ty)));
      }
      if (d <= REFUGE_RADIUS) out.push({ tile: { tx, ty }, dist: d });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

describe('B. BRUTE 가 있는 방마다 1타일 도피로가 실제로 붙어 있다', () => {
  it(`순찰 지점마다 40px 가 서고, 순찰선에서 ${REFUGE_RADIUS}타일(BRUTE 시야) 안에 좁은 칸이 있다`, () => {
    const report: string[] = [];
    let staged = 0;
    for (const level of STAGES) {
      const brutes = (level.guards ?? []).filter((g) => g.kind === 'BRUTE');
      if (brutes.length === 0) continue;
      staged++;
      for (const g of brutes) {
        for (const p of g.path) {
          assert.ok(
            bruteCanStand(level, p.tx, p.ty),
            `${level.id}: BRUTE 순찰 지점 (${p.tx},${p.ty}) 에 40px 가 서지 못한다`,
          );
        }
        const refuges = refugesNear(level, g.path);
        assert.ok(
          refuges.length > 0,
          `${level.id}: BRUTE 순찰 구간(${g.path.map((p) => `${p.tx},${p.ty}`).join(' → ')}) ` +
            `반경 ${REFUGE_RADIUS}타일 안에 40px 가 못 들어가는 칸이 없다 — 그냥 느린 경비다`,
        );
        const shown = refuges
          .slice(0, 3)
          .map((r) => `(${r.tile.tx},${r.tile.ty})@${r.dist}`)
          .join(' ');
        report.push(
          `    ${level.id.padEnd(16)} 순찰 ${g.path.map((p) => `(${p.tx},${p.ty})`).join('→')}` +
            ` · 도피 칸 ${refuges.length}개, 최근접 ${shown}${refuges.length > 3 ? ' …' : ''}`,
        );
      }
    }
    console.log('\n  BRUTE 도피로 실측:\n' + report.join('\n'));
    assert.ok(staged >= 4, `BRUTE 를 쓴 스테이지가 ${staged}개뿐이다`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. 설계 전제 재확인
// ══════════════════════════════════════════════════════════════════════════

describe('C. 설계 전제 — 잔상 없이는 어느 스테이지도 깨지지 않는다', () => {
  /**
   * `rules.test.ts` 는 손으로 짠 **단독 공략 시도**가 실패함을 보인다.
   * 여기서는 반대편에서 같은 것을 확인한다 — **정답 그 자체**에서 잔상만 빼면
   * 클리어가 사라지는가. 정답 테이프는 par 안에서 실제로 통하는 유일한 경로이므로,
   * 그것조차 잔상 없이는 안 된다는 것이 전제의 가장 직접적인 증거다.
   */
  for (const { sol, m } of RESULTS) {
    it(`${sol.level.id} — 정답의 마지막 테이프를 잔상 0개로 돌리면 클리어되지 않는다`, () => {
      const clearing = sol.loops[m.ghostsUsed]!;
      const sim = createWorld(sol.level, []);
      for (let i = 0; i < clearing.length && sim.outcome === 'RUNNING'; i++) {
        stepWorld(sim, clearing[i]!);
      }
      assert.notEqual(
        sim.outcome,
        'CLEARED',
        `${sol.level.id}: 잔상 없이도 같은 입력으로 클리어된다 — 잔상이 하는 일이 없다`,
      );
    });
  }

  it('par 는 1~3, 막이 넘어갈 때 뒤로 가지 않는다', () => {
    let prev = 0;
    for (const level of STAGES) {
      assert.ok(level.par >= 1 && level.par <= 3, `${level.id}: par ${level.par}`);
      assert.ok(level.par >= prev, `${level.id}: par 가 ${prev} → ${level.par} 로 낮아졌다`);
      prev = level.par;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 사본 무결성 — tests/solutions.ts 가 원본에서 어긋나지 않았는가
// ══════════════════════════════════════════════════════════════════════════

/**
 * 주석을 통째로 지운다. 설명 문장은 사본과 원본이 달라도 되고(이 파일 자체가
 * 주석 안에서 `tape([...])` 같은 표기를 쓴다), 비교 대상은 값뿐이기 때문이다.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** 공백을 하나로 접는다. 서식 차이만 무시하고 값은 그대로 본다. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `open` 에서 시작해 짝이 맞는 닫힘까지 잘라 낸다. */
function sliceBalanced(src: string, from: number): string {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (pairs[c] !== undefined) stack.push(pairs[c]!);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error('괄호가 닫히지 않았다');
}

/** `marker` 가 나올 때마다 그 뒤의 균형 잡힌 블록을 모아 정규화한다. */
function blocksAfter(src: string, marker: string, openAt: number): string[] {
  const out: string[] = [];
  let i = src.indexOf(marker);
  while (i >= 0) {
    out.push(norm(sliceBalanced(src, i + openAt)));
    i = src.indexOf(marker, i + marker.length);
  }
  return out;
}

/** `const NAME ... = <본문>;` 의 본문. 중첩 괄호 안의 `;` 는 건너뛴다. */
function declBody(src: string, name: string): string {
  const at = src.search(new RegExp(`const ${name}\\b`));
  assert.ok(at >= 0, `선언 ${name} 을 찾지 못했다`);
  const eq = src.indexOf('=', at);
  let depth = 0;
  for (let i = eq + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return norm(src.slice(eq + 1, i));
  }
  throw new Error(`${name}: 선언이 끝나지 않았다`);
}

const COPIED_DECLS = [
  'S2_PRESS', 'S5_DECOY', 'S5_START', 'S5_BUTTON_TICK',
  'S6_PRESS', 'S6_ARRIVE', 'S6_PLATE', 's6BtnGrate', 's6BtnSouth',
  'S6_TAIL', 's6LiveGrate', 's6LiveSouth',
  'S9_START', 'S9_W1', 'S9_W2', 'S9_FLASH',
  'S10_D_BUTTON', 'S10_D_LIVE', 'S10_PRESS', 'S10_FLASH',
  'S11_DELAY', 'S11_A', 'S11_B', 'S11_FLASH',
  'S12_BUTTON_TICK', 'S12_DECOY',
  'S13_CLOSE',
  'S14_EYE', 'S14_DOOR', 'S14_W1', 'S14_W2',
  'S15_DOOR', 'S15_W1', 'S15_W2', 'S15_W3', 'S15_W4', 'S15_W5', 'S15_HEAD', 'S15_RUN',
  'SOLUTIONS',
];

describe('tests/solutions.ts 는 solvability.test.ts 정답 테이프의 정확한 사본이다', () => {
  const origin = stripComments(readFileSync(join(HERE, 'solvability.test.ts'), 'utf8'));
  const copy = stripComments(readFileSync(join(HERE, 'solutions.ts'), 'utf8'));

  it('모든 tape([...]) 본문이 원본에 그대로 있다', () => {
    const mine = blocksAfter(copy, 'tape([', 'tape('.length);
    const theirs = new Set(blocksAfter(origin, 'tape([', 'tape('.length));
    assert.ok(mine.length >= 30, `사본에서 찾은 테이프가 ${mine.length}개뿐이다`);
    for (const t of mine) {
      assert.ok(theirs.has(t), `사본의 테이프가 원본에 없다 — 어긋났다:\n    ${t}`);
    }
  });

  it('모든 loops: [...] 블록이 원본에 그대로 있다', () => {
    const mine = blocksAfter(copy, 'loops: [', 'loops: '.length);
    const theirs = new Set(blocksAfter(origin, 'loops: [', 'loops: '.length));
    assert.equal(mine.length, 16, 'loops 블록 수가 16(15 스테이지 + S6_ALT)이 아니다');
    for (const t of mine) {
      assert.ok(theirs.has(t), `사본의 loops 가 원본에 없다 — 어긋났다:\n    ${t}`);
    }
  });

  it('타이밍 상수와 파생 테이프 선언이 원본과 같다', () => {
    for (const name of COPIED_DECLS) {
      assert.equal(
        declBody(copy, name),
        declBody(origin, name),
        `${name} 이 원본과 다르다`,
      );
    }
  });
});
