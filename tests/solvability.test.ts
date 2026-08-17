/**
 * Solvability 증명 (SPEC §10-2).
 *
 * 15개 스테이지 각각에 대해 **손으로 설계한 정답 입력 테이프 세트**를 헤드리스로 돌려
 *   (1) 마지막 루프에서 `outcome === 'CLEARED'`
 *   (2) 사용한 잔상 수 <= `level.par`
 * 를 확인한다. 이게 통과하지 않는 스테이지는 미완성이다.
 *
 * 각 루프는 그 시점까지 확정된 잔상만 가진 채 시뮬되므로, "그 순서로 실제 녹화가
 * 가능한가"(예: 아직 아무도 안 연 게이트를 지나갈 수 없다)까지 함께 검증된다.
 *
 * 걷기 한 타일 = 정확히 16틱이라 `tiles(n)` 으로 경로를 읽을 수 있게 적었다.
 * 각 해답의 `roles` 는 **설계 의도를 테스트가 문서화**하기 위한 것이다 —
 * 배열 길이가 곧 사용 잔상 수 + 1 이어야 하므로 주석이 아니라 검증 대상이다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import {
  beginOverwriteMode,
  commitLoop,
  createSession,
  fullReset,
  requestOverwrite,
  startStage,
  tickSession,
} from '../src/game/session';
import { BODY_SUB, LOOP_TRANSITION_TICKS, TILE_SUB } from '../src/sim/constants';
import type { LevelDef, Tape } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';
import { D, E, L, O, R, RUN, U, playSolution, seg, tape, tiles } from './tapes';

interface Solution {
  level: LevelDef;
  /** 루프 순서대로의 입력 테이프. 마지막 테이프가 클리어하는 몸(I). */
  loops: Tape[];
  /** 각 잔상이 맡은 역할 — 설계 의도를 테스트가 문서화한다. */
  roles: string[];
}

// ══════════════════════════════════════════════════════════════════════════
// 1막 수용
// ══════════════════════════════════════════════════════════════════════════

// ── 1. THE CELL — 발판 위에 남은 나 ───────────────────────────────────────
const S1: Solution = {
  level: STAGES[0]!,
  roles: ['MY: 발판 위에서 조기 확정 → 게이트를 계속 열어둔다', 'I: 게이트 통과 → loot → escape'],
  loops: [
    tape([seg(L, tiles(1)), seg(D, tiles(3)), seg(O, 4)]),
    tape([
      seg(D, tiles(1)),
      seg(R, tiles(11)),
      seg(U, tiles(2)),
      seg(D, tiles(4)),
    ]),
  ],
};

// ── 2. THE CLOCK — 잔상이 맡는 것은 자리가 아니라 순간이다 ────────────────
/** 잔상이 버튼(1,7)을 누르는 틱. 이때 I 는 이미 게이트 앞(18,4)에 서 있다. */
const S2_PRESS = 280;
const S2: Solution = {
  level: STAGES[1]!,
  roles: [
    `MY: 북서 구석 버튼까지 걸어가 ${S2_PRESS}틱에 누른다 — 게이트가 90틱 열린다`,
    'I: 먼저 게이트 앞에 가서 기다렸다가, 열리는 그 틱에 통과 → loot → escape',
  ],
  loops: [
    tape([
      seg(L, tiles(3)),
      seg(D, tiles(5)),
      seg(O, S2_PRESS - tiles(8)),
      seg(E, 1),
      seg(O, 4),
    ]),
    tape([
      seg(D, tiles(2)),
      seg(R, tiles(14)), // (18,4) — 게이트 바로 앞
      seg(O, S2_PRESS - tiles(16) + 1),
      seg(R, tiles(4)),
      seg(U, tiles(2)),
      seg(D, tiles(4)),
    ]),
  ],
};

// ── 3. THE WEIGHT — 상자가 한 몸을 대신한다 ───────────────────────────────
const S3: Solution = {
  level: STAGES[2]!,
  roles: [
    'MY: 상자를 발판 A 로 밀어넣고 자신은 발판 B 위에서 확정 — 한 몸이 두 발판을 채운다',
    'I: 경비가 남쪽 끝에서 대기하는 창을 이용해 복도 통과 → loot → escape',
  ],
  loops: [
    tape([
      seg(L, tiles(1)),
      seg(D, 66), // 18틱 접근 + 48틱(=3타일) 밀기
      seg(R, tiles(3)),
      seg(D, 14),
      seg(O, 4),
    ]),
    tape([
      seg(O, 34),
      seg(D, tiles(3)),
      seg(R, tiles(15)),
      seg(U, tiles(3)),
      seg(D, tiles(5)),
    ]),
  ],
};

// ── 4. THE ANTECHAMBER — 잔상에 순서가 생긴다 ─────────────────────────────
const S4: Solution = {
  level: STAGES[3]!,
  roles: [
    'MY: 발판(1,7) — 바깥 문(9,5)을 연다',
    'ME: 그 문으로 들어가 안쪽 발판(12,7) — 안쪽 문(17,5)을 연다. MY 없이는 이 루프가 성립하지 않는다',
    'I: 두 문을 모두 지나 → loot → escape',
  ],
  loops: [
    tape([seg(L, tiles(3)), seg(D, tiles(4)), seg(O, 4)]),
    tape([
      seg(O, 130), // MY 가 발판에 올라선 뒤에 출발한다
      seg(D, tiles(2)),
      seg(R, tiles(8)),
      seg(D, tiles(2)),
      seg(O, 4),
    ]),
    tape([
      seg(O, 340),
      seg(D, tiles(2)),
      seg(R, tiles(18)),
      seg(U, tiles(3)),
      seg(D, tiles(5)),
    ]),
  ],
};

// ══════════════════════════════════════════════════════════════════════════
// 2막 감시
// ══════════════════════════════════════════════════════════════════════════

// ── 5. THE CORRIDOR — 소음으로 끌어낸 발이 그대로 발판에 남는다 ───────────
/**
 * 금고 게이트(19,4)는 발판(22,8) AND 시간차 버튼(2,1) 이라야 열린다.
 * MY 는 그 발판까지 가는 길에 남쪽 방을 **달려** 경비를 복도 밖으로 끌어낸다.
 * 달리기 왕복은 좌우 대칭(40틱씩)이라 끝나면 정확히 x=12 로 돌아온다.
 */
const S5_DECOY = tape([
  seg(U, tiles(3)),
  seg(R, tiles(8)),
  seg(D, tiles(3)),
  seg(RUN | R, 40),
  seg(RUN | L, 40),
  seg(RUN | R, 40),
  seg(RUN | L, 40),
  seg(R, tiles(10)),
  seg(O, 4),
]);

/** I 가 복도를 다 건너 게이트 앞(19,5)에 서는 틱. 여기서 버튼이 눌려야 한다. */
const S5_START = 340;
const S5_BUTTON_TICK = S5_START + tiles(18) + 4;

const S5: Solution = {
  level: STAGES[4]!,
  roles: [
    'MY: 남쪽 방에서 달려 경비를 복도 밖으로 끌어낸 뒤 발판(22,8) 위에 정지 — 미끼와 발판 2역',
    `ME: 북서 구석의 시간차 버튼을 ${S5_BUTTON_TICK}틱에 눌러 금고 게이트를 90틱 연다`,
    'I: 경비가 비운 복도를 종주 → 게이트 통과 → loot → 금고 안 escape',
  ],
  loops: [
    S5_DECOY,
    tape([
      seg(L, tiles(2)),
      seg(U, tiles(7)),
      seg(O, S5_BUTTON_TICK - tiles(9)),
      seg(E, 1),
      seg(O, 10),
    ]),
    tape([
      seg(O, S5_START),
      seg(U, tiles(3)),
      seg(R, tiles(15)),
      seg(O, S5_BUTTON_TICK - S5_START - tiles(18)),
      seg(U, tiles(3)),
      seg(L, tiles(2)),
      seg(R, tiles(5)),
      seg(U, tiles(1)),
    ]),
  ],
};

// ── 6. THE GRATE — 빠른 길과 조용한 길, 둘 다 값이 있다 ───────────────────
/**
 * 두 경로가 실제로 **둘 다 성립**한다는 것이 이 스테이지의 설계 주장이다.
 * 그래서 아래 `S6`(내가 우회로) 와 `S6_ALT`(내가 격자) 를 **각각** 돌려 증명한다.
 * 격자 4타일을 지나면 10틱마다 소음이 나고, 경비(12,5)~(19,5)가 그것을 듣는다.
 */
const S6_PRESS = 760;
const S6_PLATE = tape([seg(D, tiles(8)), seg(L, tiles(3)), seg(O, 4)]);
/** 버튼(11,7)까지 격자 지름길 12타일. */
const s6BtnGrate = (t: number): Tape =>
  tape([
    seg(O, t - tiles(12)),
    seg(D, tiles(3)),
    seg(R, tiles(7)),
    seg(D, tiles(2)),
    seg(E, 1),
    seg(O, 4),
  ]);
/** 같은 버튼까지 남쪽 우회로 36타일. 완전 무음. */
const s6BtnSouth = (t: number): Tape =>
  tape([
    seg(O, t - tiles(36)),
    seg(D, tiles(8)),
    seg(R, tiles(16)),
    seg(U, tiles(2)),
    seg(L, tiles(9)),
    seg(U, tiles(1)),
    seg(E, 1),
    seg(O, 4),
  ]);
/** 게이트를 지난 뒤의 공통 꼬리 — 금고 안 loot(26,2) → escape(26,10). */
const S6_TAIL = [seg(R, tiles(6)), seg(U, tiles(3)), seg(D, tiles(8))];
const s6LiveGrate = (t: number): Tape =>
  tape([seg(O, t - tiles(19)), seg(D, tiles(3)), seg(R, tiles(16)), ...S6_TAIL]);
const s6LiveSouth = (t: number): Tape =>
  tape([
    seg(O, t - tiles(29)),
    seg(D, tiles(8)),
    seg(R, tiles(16)),
    seg(U, tiles(5)),
    ...S6_TAIL,
  ]);

/** 기다림 없이 굴렸을 때 조작 몸이 게이트 앞 타일(20,5)에 처음 닿는 틱. 못 닿으면 -1. */
function ticksToGateFront(t: Tape): number {
  const sim = createWorld(STAGES[5]!, []);
  for (let i = 0; i < t.length && sim.outcome === 'RUNNING'; i++) {
    stepWorld(sim, t[i]!);
    const b = sim.bodies[0]!;
    const tx = Math.floor((b.x + BODY_SUB / 2) / TILE_SUB);
    const ty = Math.floor((b.y + BODY_SUB / 2) / TILE_SUB);
    if (tx === 20 && ty === 5) return i + 1;
  }
  return -1;
}

const S6: Solution = {
  level: STAGES[5]!,
  roles: [
    'MY: 남쪽 발판(1,10) — 금고 채널의 절반',
    `ME: 격자를 밟고 지름길로 버튼(11,7) → ${S6_PRESS}틱에 누른다. 소음은 경비를 서쪽으로 끌어당긴다`,
    'I: 값을 치르지 않는 쪽 — 남쪽 우회로로 192틱을 더 걷고, 조용히 게이트 앞에 선다',
  ],
  loops: [S6_PLATE, s6BtnGrate(S6_PRESS), s6LiveSouth(S6_PRESS)],
};

const S6_ALT: Solution = {
  level: STAGES[5]!,
  roles: [
    'MY: 남쪽 발판(1,10)',
    'ME: 조용한 우회로로 버튼까지 — 경비는 순찰을 계속한다',
    'I: 이번엔 내가 격자를 밟는다. 빠르지만 경비의 순찰 창을 정확히 맞춰야 한다',
  ],
  loops: [S6_PLATE, s6BtnSouth(S6_PRESS), s6LiveGrate(S6_PRESS)],
};

// ── 7. THE SEAL — 한 잔상이 레버와 발판을 겸한다 ──────────────────────────
const S7: Solution = {
  level: STAGES[6]!,
  roles: [
    'MY: 레버로 CCTV 를 끄고 이어서 발판으로 이동 — 2역',
    'ME: 130틱에 시간차 버튼',
    'I: 게이트 통과 → 남쪽 loot → 북쪽 escape',
  ],
  loops: [
    tape([seg(D, tiles(4)), seg(E, 1), seg(R, tiles(3)), seg(O, 4)]),
    tape([seg(U, tiles(2)), seg(O, 98), seg(E, 1), seg(O, 10)]),
    tape([
      seg(O, 20),
      seg(D, tiles(2)),
      seg(R, tiles(19)),
      seg(D, tiles(3)),
      seg(L, tiles(11)),
      seg(U, tiles(7)),
    ]),
  ],
};

// ── 8. THE VIGIL — 조용히 갈 수 없는 곳에 스위치가 있다 ───────────────────
const S8: Solution = {
  level: STAGES[7]!,
  roles: [
    'MY: 북서 발판(1,1) — 금고문을 계속 열어 둔다',
    'ME: 격자판을 밟고 레버(14,6)까지 — 감시안은 꺼지지만 그 발소리가 경비를 부른다',
    'I: 소리가 잦아들기를 기다렸다가 눈이 감긴 복도를 종주 → loot → escape',
  ],
  loops: [
    tape([seg(L, tiles(2)), seg(U, tiles(1)), seg(O, 4)]),
    tape([seg(D, tiles(4)), seg(R, tiles(11)), seg(E, 1), seg(O, 4)]),
    tape([
      seg(O, 500), // 경비가 소음 수색을 끝내고 순찰로 돌아갈 때까지 기다린다
      seg(D, tiles(4)),
      seg(R, tiles(21)),
      seg(U, tiles(4)),
      seg(D, tiles(8)),
    ]),
  ],
};

// ══════════════════════════════════════════════════════════════════════════
// 3막 통제
// ══════════════════════════════════════════════════════════════════════════

// ── 9. THE ORDER — 순서를 밟으려면 문을 잡아 줄 사람이 있어야 한다 ────────
const S9: Solution = {
  level: STAGES[8]!,
  roles: [
    'MY: 서쪽 발판(2,11) — 벽장 B 의 문(12,4)을 붙잡는다',
    'ME: 동쪽 발판(21,11) — 벽장 C 의 문(19,4)을 붙잡는다. 두 발판은 지도 양끝이라 한 몸으로는 못 겹친다',
    'I: 0 → 1 → 2 를 순서대로 눌러 금고문을 열고 → loot → escape',
  ],
  loops: [
    tape([seg(D, tiles(5)), seg(O, 4)]),
    tape([seg(D, tiles(5)), seg(R, tiles(19)), seg(O, 4)]),
    tape([
      seg(R, tiles(3)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 0 (5,3)
      seg(D, tiles(2)), seg(R, tiles(7)), seg(U, tiles(2)), seg(E, 1), seg(O, 1), // order 1 (12,3)
      seg(D, tiles(2)), seg(R, tiles(7)), seg(U, tiles(2)), seg(E, 1), seg(O, 1), // order 2 (19,3)
      seg(D, tiles(6)), seg(R, tiles(4)), seg(R, tiles(3)), // 금고문(23,9) 통과
      seg(U, tiles(2)), seg(D, tiles(4)),
    ]),
  ],
};

// ── 10. THE BEAM — 통과할 시각을 고른다 ───────────────────────────────────
/** 레이저는 140틱 주기에 50틱만 켜진다. 아래 세 지연값이 각 몸의 통과 위상이다. */
const S10_D_BUTTON = 20;
const S10_D_LIVE = 40;
const S10_PRESS = S10_D_LIVE + tiles(17) + 80;
const S10: Solution = {
  level: STAGES[9]!,
  roles: [
    'MY: 서쪽 발판(2,8) — 금고 채널의 절반. 레이저를 건널 필요가 없는 자리다',
    `ME: ${S10_D_BUTTON}틱 늦게 출발해 레이저가 꺼진 위상에 복도를 건너고, ${S10_PRESS}틱에 버튼(17,2)`,
    `I: ${S10_D_LIVE}틱 늦게 출발 — 나만의 통과 위상으로 복도를 건너 게이트 앞에 선다`,
  ],
  loops: [
    tape([seg(L, tiles(1)), seg(D, tiles(4)), seg(O, 4)]),
    tape([
      seg(O, S10_D_BUTTON),
      seg(D, tiles(1)), seg(R, tiles(14)), seg(U, tiles(3)),
      seg(O, S10_PRESS - S10_D_BUTTON - tiles(18)),
      seg(E, 1), seg(O, 4),
    ]),
    tape([
      seg(O, S10_D_LIVE),
      seg(D, tiles(1)), seg(R, tiles(16)),
      seg(O, S10_PRESS - S10_D_LIVE - tiles(17)),
      seg(R, tiles(4)), seg(U, tiles(3)), seg(D, tiles(6)),
    ]),
  ],
};

// ── 11. THE TIMETABLE — 잔상들이 시각표를 나눠 갖는다 ─────────────────────
const S11_DELAY = 250;
const S11_A = S11_DELAY + 200; // 벽장 A 의 문이 열리는 틱
const S11_B = S11_DELAY + 445; // 벽장 B 의 문이 열리는 틱
const S11: Solution = {
  level: STAGES[10]!,
  roles: [
    `MY: 남동쪽 버튼(24,11) — ${S11_A}틱에 벽장 A 의 문(6,4)을 90틱 연다`,
    `ME: 서쪽 버튼(2,5) — ${S11_B}틱에 벽장 B 의 문(15,4)을 90틱 연다`,
    'MINE: 발판(1,11) — 탈출 게이트 채널의 나머지 절반',
    'I: 0(10,6) → 열린 A 에서 1 → 열린 B 에서 2 → 금고문 → loot → escape',
  ],
  loops: [
    tape([
      seg(D, tiles(5)), seg(R, tiles(22)),
      seg(O, S11_A - tiles(27)), seg(E, 1), seg(O, 4),
    ]),
    tape([seg(U, tiles(1)), seg(O, S11_B - tiles(1)), seg(E, 1), seg(O, 4)]),
    tape([seg(D, tiles(5)), seg(L, tiles(1)), seg(O, 4)]),
    tape([
      seg(O, S11_DELAY),
      seg(R, tiles(8)), seg(E, 1), seg(O, 1), // order 0
      seg(L, tiles(4)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 1 (6,3)
      seg(D, tiles(3)), seg(R, tiles(9)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 2 (15,3)
      seg(D, tiles(3)), seg(D, tiles(4)), seg(R, tiles(11)), seg(R, tiles(3)),
      seg(U, tiles(2)), seg(D, tiles(3)),
    ]),
  ],
};

// ── 12. THE THRESHOLD — 네 개의 몸, 네 개의 일 ────────────────────────────
const S12_BUTTON_TICK = 700;
const S12_DECOY = (() => {
  const osc: ReturnType<typeof seg>[] = [];
  for (let i = 0; i < 12; i++) {
    osc.push(seg(RUN | R, 30));
    osc.push(seg(RUN | L, 30));
  }
  return tape([
    seg(O, 180), // CCTV 가 꺼질 때까지 대기 — 알람이 울리면 미끼가 무의미해진다
    seg(D, tiles(2)),
    seg(RUN | R, 230),
    seg(RUN | D, 55),
    seg(RUN | L, 145),
    ...osc,
  ]);
})();

const S12: Solution = {
  level: STAGES[11]!,
  roles: [
    'MY: 상자를 서쪽 벽까지 밀어 발판(1,2)에 얹고, 자신은 발판(1,8)에 남는다 — 한 몸이 발판 둘',
    'ME: 레버로 CCTV 차단 + 700틱에 탈출 게이트 버튼 — 2역 (걷기만: 소음을 내면 경비가 복도로 온다)',
    'MINE: 남쪽 방 미끼 — 경비2 를 서쪽 끝에 묶는다',
    'I: 복도 종주 → 남쪽 loot → 탈출 게이트 → escape',
  ],
  loops: [
    // (3,3)→(7,3)→(7,2) 로 돌아 상자 오른쪽에 붙고, 왼쪽으로 밀어 서쪽 벽에 박는다
    // (18틱 접근 + 64틱 밀기 = 82 < 90). 그대로 남쪽으로 내려가 발판(1,8) 위에 선다.
    tape([
      seg(R, tiles(4)),
      seg(U, tiles(1)),
      seg(L, 90),
      seg(D, tiles(6)),
      seg(L, 20),
      seg(O, 4),
    ]),
    tape([
      seg(D, tiles(2)),
      seg(R, tiles(9)),
      seg(E, 1), // 레버
      seg(R, tiles(4)),
      seg(O, S12_BUTTON_TICK - (tiles(2) + tiles(9) + 1 + tiles(4))),
      seg(E, 1), // 시간차 버튼
      seg(O, 10),
    ]),
    S12_DECOY,
    tape([
      seg(O, 200),
      seg(D, tiles(2)),
      seg(R, tiles(23)),
      seg(D, tiles(3)),
      seg(L, tiles(2)),
      seg(R, tiles(2)),
      seg(U, tiles(6)),
    ]),
  ],
};

// ══════════════════════════════════════════════════════════════════════════
// 4막 경계
// ══════════════════════════════════════════════════════════════════════════

// ── 13. THE BREAKER — 문과 눈 중 하나 ─────────────────────────────────────
/** 잔상 셋이 **동시에** 발판을 채우는 틱. 이때 전력이 눈에서 문으로 넘어간다. */
const S13_CLOSE = 560;
const S13: Solution = {
  level: STAGES[12]!,
  roles: [
    'MY: 레버(8,8)로 먼저 감시안을 끈다 — 그리고 남쪽 발판(1,8)으로 이동해 대기 (2역)',
    'ME: 북서 발판(1,1)',
    `MINE: 마지막 발판(1,5)을 ${S13_CLOSE}틱에 밟는다 — 문이 열리는 대신 눈이 다시 뜬다`,
    'I: 눈이 감긴 동안 복도를 건너 게이트 앞(19,5)에 서 있다가, 열리는 즉시 들어간다',
  ],
  loops: [
    tape([
      seg(D, tiles(5)), seg(R, tiles(5)), seg(E, 1),
      seg(L, tiles(7)), seg(O, 4),
    ]),
    tape([seg(L, tiles(2)), seg(U, tiles(2)), seg(O, 4)]),
    tape([seg(O, S13_CLOSE - tiles(4)), seg(L, tiles(2)), seg(D, tiles(2)), seg(O, 4)]),
    tape([
      seg(O, 200), // 레버가 내려간 뒤에 출발한다
      seg(D, tiles(2)), seg(R, tiles(16)),
      seg(O, S13_CLOSE - 200 - tiles(18)),
      seg(R, tiles(1)), seg(R, tiles(4)),
      seg(U, tiles(3)), seg(D, tiles(6)),
    ]),
  ],
};

// ── 14. THE JUNCTION — 셋을 시간으로 나눠 지나간다 ────────────────────────
const S14_EYE = 380; // 레버 eye 를 켜 전력을 빼앗는 틱 (= 레이저가 되살아나는 틱)
const S14_DOOR = 600; // 발판 셋이 채워져 문이 전력을 가져가는 틱
const S14: Solution = {
  level: STAGES[13]!,
  roles: [
    'MY: 레버(7,1)로 레이저를 끈다 → 발판(1,1) 로 이동 (2역)',
    `ME: ${S14_EYE}틱에 레버(7,8)로 감시안을 끈다 — 그 순간 레이저가 되살아난다 → 발판(1,8) (2역)`,
    `MINE: ${S14_DOOR}틱에 마지막 발판(1,5) — 문이 전력을 가져가고 눈이 다시 뜬다`,
    'I: 레이저가 죽은 동안 x13 을 건너고, 눈이 감긴 동안 CCTV 구간을 지나 게이트 앞에 선다',
  ],
  loops: [
    tape([seg(U, tiles(2)), seg(R, tiles(4)), seg(E, 1), seg(L, tiles(6)), seg(O, 4)]),
    tape([
      seg(D, tiles(5)), seg(R, tiles(4)),
      seg(O, S14_EYE - tiles(9)), seg(E, 1),
      seg(L, tiles(6)), seg(O, 4),
    ]),
    tape([seg(O, S14_DOOR - tiles(4)), seg(L, tiles(2)), seg(D, tiles(2)), seg(O, 4)]),
    tape([
      seg(O, 150),
      seg(D, tiles(2)), seg(R, tiles(24)),
      seg(O, S14_DOOR - 150 - tiles(26)),
      seg(R, tiles(1)), seg(R, tiles(3)),
      seg(U, tiles(3)), seg(D, tiles(6)),
    ]),
  ],
};

// ── 15. THE LAST DOOR — 문이 열리면 지나온 길이 닫힌다 ────────────────────
const S15_DOOR = 800;
/** 순차 버튼 → 레이저 통과 → 게이트 앞까지의 길이. 여기서 남는 만큼만 기다린다. */
const S15_RUN =
  tiles(3) + tiles(10) + tiles(4) + 2 + tiles(8) + tiles(4) + 2 +
  tiles(7) + tiles(1) + 2 + tiles(3) + tiles(6);
const S15: Solution = {
  level: STAGES[14]!,
  roles: [
    'MY: 발판(1,1)',
    'ME: 발판(1,6)',
    'MINE: 발판(1,10) — 셋이 동시에 눌리는 800틱에 전력이 exit 으로 넘어간다',
    'I: 순차 버튼 0→1→2 로 레이저와 감시안을 죽이고, 그 사이에 레이저 동쪽으로 건너가 기다린다',
  ],
  loops: [
    tape([seg(O, S15_DOOR - tiles(4)), seg(L, tiles(2)), seg(U, tiles(2)), seg(O, 4)]),
    tape([seg(O, S15_DOOR - tiles(5)), seg(L, tiles(2)), seg(D, tiles(3)), seg(O, 4)]),
    tape([seg(O, S15_DOOR - tiles(9)), seg(L, tiles(2)), seg(D, tiles(7)), seg(O, 4)]),
    tape([
      seg(D, tiles(3)), seg(R, tiles(7)), seg(R, tiles(3)),
      seg(U, tiles(4)), seg(E, 1), seg(O, 1), // order 0 (13,2)
      seg(D, tiles(8)), seg(R, tiles(4)), seg(E, 1), seg(O, 1), // order 1 (17,10)
      seg(U, tiles(7)), seg(R, tiles(1)), seg(E, 1), seg(O, 1), // order 2 (18,3) → seq 완성
      seg(D, tiles(3)), seg(R, tiles(6)), // 죽은 레이저(x20)를 건너 게이트 앞(24,6)
      seg(O, S15_DOOR - S15_RUN),
      seg(R, tiles(1)), seg(R, tiles(4)),
      seg(U, tiles(3)), seg(D, tiles(7)),
    ]),
  ],
};

const SOLUTIONS: Solution[] = [
  S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15,
];

describe('Solvability: 15개 스테이지 전부 par 이내로 클리어 가능하다', () => {
  it('SOLUTIONS 가 STAGES 를 하나도 빠짐없이 덮는다', () => {
    assert.equal(SOLUTIONS.length, STAGES.length);
    for (let i = 0; i < STAGES.length; i++) {
      assert.equal(SOLUTIONS[i]!.level.id, STAGES[i]!.id, `${i}번 해답이 다른 스테이지를 가리킨다`);
    }
  });

  for (const sol of SOLUTIONS) {
    const { level } = sol;
    it(`${level.id} ${level.name} — par ${level.par} 이내 클리어`, () => {
      const res = playSolution(level, sol.loops);
      assert.equal(
        res.outcome,
        'CLEARED',
        `${level.id}: 클리어 실패 (outcome=${res.outcome}, tick=${res.sim.tick})`,
      );
      assert.ok(
        res.ghostsUsed <= level.par,
        `${level.id}: 잔상 ${res.ghostsUsed}개 사용, par ${level.par} 초과`,
      );
      assert.equal(res.ghostsUsed, sol.roles.length - 1);
      assert.equal(res.sim.bodies[0]!.carryingLoot, true);
    });
  }

  it('06_MY — 격자 지름길로도 par 안에서 클리어된다 (두 경로가 둘 다 성립)', () => {
    const res = playSolution(S6_ALT.level, S6_ALT.loops);
    assert.equal(res.outcome, 'CLEARED', `outcome=${res.outcome}, tick=${res.sim.tick}`);
    assert.ok(res.ghostsUsed <= S6_ALT.level.par);
    assert.equal(res.ghostsUsed, S6_ALT.roles.length - 1);
    // "빠른 길"이라는 말이 성립하려면 실제로 더 빨리 도착해야 한다.
    // 두 경로를 기다림 없이 굴려 게이트 앞(20,5)에 닿는 틱을 재 비교한다.
    const grateTicks = ticksToGateFront(s6LiveGrate(tiles(19)));
    const southTicks = ticksToGateFront(s6LiveSouth(tiles(29)));
    assert.ok(grateTicks > 0 && southTicks > 0, '두 경로 모두 게이트 앞에 닿아야 한다');
    assert.ok(
      grateTicks < southTicks,
      `격자 경로(${grateTicks}틱)가 우회로(${southTicks}틱)보다 빠르지 않다 — 트레이드오프가 없는 설계다`,
    );
  });

  it('모든 스테이지가 4바디(잔상 3) 상한 안에 있다', () => {
    for (const level of STAGES) {
      assert.ok(level.par >= 1 && level.par <= 3, `${level.id}: par ${level.par}`);
    }
  });

  it('난이도 곡선: 막이 넘어갈 때 par 가 뒤로 가지 않는다', () => {
    const pars = STAGES.map((s) => s.par);
    assert.deepEqual(pars, [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  });

  it('세션 API 로도 1번 스테이지가 클리어되고 메달이 붙는다', () => {
    const s = createSession();
    startStage(s, 0);

    for (const t of S1.loops) {
      for (const mask of t) tickSession(s, mask);
      if (s.phase === 'CLEAR') break;
      commitLoop(s, 'MANUAL');
      // 전환 오버레이가 끝나야 다음 루프가 시작된다.
      for (let i = 0; i < LOOP_TRANSITION_TICKS; i++) tickSession(s, 0);
    }

    assert.equal(s.phase, 'CLEAR');
    assert.equal(s.medal, true);
    assert.equal(s.ghosts.length, 1);
    assert.equal(s.debt, 0);
  });

  it('덮어쓰기는 스테이지당 1회, 전체 초기화는 DEBT 를 남긴다', () => {
    const s = createSession();
    startStage(s, 0);

    for (let i = 0; i < 30; i++) tickSession(s, 0);
    commitLoop(s, 'MANUAL');
    for (let i = 0; i < LOOP_TRANSITION_TICKS; i++) tickSession(s, 0);
    assert.equal(s.ghosts.length, 1);

    beginOverwriteMode(s);
    assert.equal(requestOverwrite(s, 1), true);
    assert.equal(s.loopIndex, 0);
    // 소진되면 두 번째 요청은 거부된다.
    beginOverwriteMode(s);
    assert.equal(s.awaitingOverwritePick, false);
    assert.equal(requestOverwrite(s, 1), false);

    fullReset(s);
    assert.equal(s.debt, 1);
    assert.equal(s.ghosts.length, 0);
    assert.equal(s.overwriteLeft, 1);
  });

  it('타일맵이 직사각형이고 스폰 지점이 있다', () => {
    for (const level of STAGES) {
      const w = level.tiles[0]!.length;
      for (const row of level.tiles) assert.equal(row.length, w, level.id);
      assert.ok(
        level.tiles.some((r) => r.includes('S')),
        `${level.id}: 스폰 'S' 없음`,
      );
    }
  });
});
