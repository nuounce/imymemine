/**
 * 15개 스테이지의 정답 입력 테이프 — QA 계측용 사본.
 *
 * 원본은 `tests/solvability.test.ts` 안에 있고 그 파일은 이 QA 작업에서 수정 금지라,
 * 같은 데이터를 여기에 **한 글자도 바꾸지 않고** 옮겨 왔다. 사본이므로 원본과
 * 어긋나면 의미가 없어진다 — `tests/qa.test.ts` 의 "정답 테이프 사본이 원본과 일치한다"
 * 테스트가 두 파일의 소스를 직접 읽어 `tape([...])` 본문과 `const S*_* = <숫자>`
 * 선언이 전부 동일한지 검사한다. 원본을 고치면 그 테스트가 먼저 깨진다.
 *
 * 언젠가 solvability.test.ts 를 손댈 수 있게 되면, 그쪽이 이 파일을 import 하도록
 * 바꾸고 사본 검사를 지우는 것이 옳다.
 */

import { STAGES } from '../src/game/levels';
import { IN_FLASH } from '../src/sim/constants';
import type { LevelDef, Tape } from '../src/sim/types';
import { D, E, L, O, R, RUN, U, seg, tape, tiles, type Seg } from './tapes';

export interface Solution {
  level: LevelDef;
  /** 루프 순서대로의 입력 테이프. 마지막 테이프가 클리어하는 몸(I). */
  loops: Tape[];
  /** 각 잔상이 맡은 역할 — 설계 의도를 테스트가 문서화한다. */
  roles: string[];
}

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

// ── 2. THE CLOCK ──────────────────────────────────────────────────────────
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

// ── 3. THE WEIGHT ─────────────────────────────────────────────────────────
const S3: Solution = {
  level: STAGES[2]!,
  roles: [
    'MY: 상자를 발판 A 로 밀어넣고 자신은 발판 B 위에서 확정 — 한 몸이 두 발판을 채운다',
    'I: 열린 복도를 통과 → loot → escape (1막에는 경비가 없다)',
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

// ── 4. THE ANTECHAMBER ────────────────────────────────────────────────────
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

// ── 5. THE CORRIDOR ───────────────────────────────────────────────────────
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
      seg(O, S5_START + 28),
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

// ── 6. THE GRATE ──────────────────────────────────────────────────────────
const S6_PRESS = 820;
/** 조작 몸이 게이트 앞(20,5)에 서는 틱. 버튼 뒤 240틱(holdTicks) 안이면 된다. */
const S6_ARRIVE = 980;
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

const S6: Solution = {
  level: STAGES[5]!,
  roles: [
    'MY: 남쪽 발판(1,10) — 금고 채널의 절반',
    // 실측: 이 루프의 개는 INVESTIGATE 까지만 가고 CHASE 에 한 번도 들어가지 않는다.
    `ME: 격자를 밟고 지름길로 버튼(11,7) → ${S6_PRESS}틱에 누른다. 그 소리에 사냥개가 수색을 나와 2.73타일까지 붙지만 추격에는 들어가지 않고 이 몸은 잡히지 않는다 — 미끼값은 체포가 아니라 개를 서쪽 수색에 붙들어 두는 것이다`,
    'I: 값을 치르지 않는 쪽 — 남쪽 우회로로 160틱을 더 걷고, 개가 서쪽에 붙어 있는 동안 조용히 게이트 앞에 선다',
  ],
  loops: [S6_PLATE, s6BtnGrate(S6_PRESS), s6LiveSouth(S6_ARRIVE)],
};

export const S6_ALT: Solution = {
  level: STAGES[5]!,
  roles: [
    'MY: 남쪽 발판(1,10)',
    'ME: 조용한 우회로로 버튼까지 — 개는 순찰을 계속한다',
    'I: 이번엔 내가 격자를 밟는다. 빠르지만 개가 남북 끝에서 쉬는 창을 정확히 맞춰야 한다',
  ],
  loops: [S6_PLATE, s6BtnSouth(S6_PRESS), s6LiveGrate(S6_ARRIVE)],
};

// ── 7. THE SEAL ───────────────────────────────────────────────────────────
const S7: Solution = {
  level: STAGES[6]!,
  roles: [
    'MY: 레버로 CCTV 를 끄고 이어서 발판으로 이동 — 2역',
    'ME: 130틱에 시간차 버튼',
    'I: 게이트 통과 → 세로 통로 x22 로 올라가 코어(22,1) → 덩치가 덮치기 전에 같은 통로로 떨어져 남쪽 escape(11,8)',
  ],
  loops: [
    tape([seg(D, tiles(4)), seg(E, 1), seg(R, tiles(3)), seg(O, 4)]),
    tape([seg(U, tiles(2)), seg(O, 98), seg(E, 1), seg(O, 10)]),
    tape([
      seg(O, 100),
      seg(D, tiles(2)),
      seg(R, tiles(19)),
      seg(U, tiles(4)),
      seg(D, tiles(7)),
      seg(L, tiles(11)),
    ]),
  ],
};

// ── 8. THE VIGIL ──────────────────────────────────────────────────────────
const S8: Solution = {
  level: STAGES[7]!,
  roles: [
    'MY: 북서 발판(1,1) — 금고문을 계속 열어 둔다',
    'ME: 격자판을 밟고 레버(14,6)까지 — 감시안은 꺼지지만 그 발소리가 덩치를 부른다',
    'I: 격자방을 가로질러 (20,6) 한 칸으로 탈출 → 금고 안 SENTRY 를 앞질러 loot → escape',
  ],
  loops: [
    tape([seg(L, tiles(2)), seg(U, tiles(1)), seg(O, 4)]),
    tape([seg(D, tiles(4)), seg(R, tiles(11)), seg(E, 1), seg(O, 4)]),
    tape([
      seg(O, 274), // 덩치가 남쪽 끝으로 내려가는 창을 기다린다
      seg(D, tiles(4)),
      seg(R, tiles(21)),
      seg(U, tiles(4)),
      seg(D, tiles(8)),
    ]),
  ],
};

// ── 9. THE ORDER ──────────────────────────────────────────────────────────
const S9_START = 40;
/** 문줄 y5 의 순찰을 흘려보내는 두 박자. */
const S9_W1 = 224;
const S9_W2 = 16;
/** ME 가 눈뽕을 터뜨리는 틱. */
const S9_FLASH = 620;
const S9: Solution = {
  level: STAGES[8]!,
  roles: [
    'MY: 서쪽 발판(2,11) — 벽장 B 의 문(12,4)을 붙잡는다',
    `ME: 남쪽 길에서 눈뽕(14,11)을 주워 동쪽 발판(21,11)에 선다 — 벽장 C 의 문(19,4)을 붙잡되, ` +
      `순찰이 저를 잡으러 내려오는 ${S9_FLASH}틱에 그것을 터뜨려 경비와 금고문 앞 감시자를 함께 150틱 재운다. ` +
      '두 발판은 지도 양끝이라 한 몸으로는 못 겹친다',
    'I: 눈이 먼 문줄(y5)을 건너며 0 → 1 → 2 를 누르고, 경보가 울리기 전에 금고 안으로 → loot → escape',
  ],
  loops: [
    tape([seg(D, tiles(5)), seg(O, 4)]),
    tape([
      seg(D, tiles(5)), seg(R, tiles(19)),
      seg(O, S9_FLASH - tiles(24)),
      seg(IN_FLASH, 1), seg(O, 4),
    ]),
    tape([
      seg(O, S9_START),
      seg(R, tiles(3)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 0 (5,3)
      seg(D, tiles(2)), seg(O, S9_W1), // 순찰이 동쪽으로 지나갈 때까지 벽장 앞에서 죽는다
      seg(R, tiles(7)), seg(U, tiles(2)), seg(E, 1), seg(O, 1), // order 1 (12,3)
      seg(D, tiles(2)), seg(O, S9_W2),
      seg(R, tiles(7)), seg(U, tiles(2)), seg(E, 1), seg(O, 1), // order 2 (19,3)
      seg(D, tiles(6)), seg(R, tiles(4)), seg(R, tiles(3)), // 금고문(23,9) 통과
      seg(U, tiles(2)), seg(D, tiles(4)),
    ]),
  ],
};

// ── 10. THE BEAM ──────────────────────────────────────────────────────────
const S10_D_BUTTON = 20;
const S10_D_LIVE = 40;
const S10_PRESS = S10_D_LIVE + tiles(17) + 80;
/** ME 가 버튼 앞(17,2)에 올라선 다음 틱 = 이 스테이지의 눈뽕 사용 시각. */
const S10_FLASH = S10_D_BUTTON + tiles(18) + 1;
const S10: Solution = {
  level: STAGES[9]!,
  roles: [
    'MY: 서쪽 발판(2,8) — 금고 채널의 절반. 레이저를 건널 필요가 없는 자리다',
    `ME: ${S10_D_BUTTON}틱 늦게 출발해 레이저가 꺼진 위상에 복도를 건너고, 올라오는 길(17,3)에서 눈뽕을 줍는다. ` +
      `버튼 앞에 서는 ${S10_FLASH}틱에 그것을 터뜨려 바로 아래(17,5)의 감시자를 150틱 재우고, ${S10_PRESS}틱에 버튼(17,2)`,
    `I: ${S10_D_LIVE}틱 늦게 출발 — 나만의 통과 위상으로 복도를 건너, 눈이 먼 감시자 옆에서 게이트가 열리기를 기다린다`,
  ],
  loops: [
    tape([seg(L, tiles(1)), seg(D, tiles(4)), seg(O, 4)]),
    tape([
      seg(O, S10_D_BUTTON),
      seg(D, tiles(1)), seg(R, tiles(14)), seg(U, tiles(3)),
      seg(IN_FLASH, 1),
      seg(O, S10_PRESS - S10_FLASH),
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

// ── 11. THE TIMETABLE ─────────────────────────────────────────────────────
const S11_DELAY = 250;
const S11_A = S11_DELAY + 200; // 벽장 A 의 문이 열리는 틱
const S11_B = S11_DELAY + 445; // 벽장 B 의 문이 열리는 틱
/** MY 가 눈뽕을 터뜨리는 틱 — 조작 몸이 금고문으로 붙는 순간 감시자를 재운다. */
const S11_FLASH = 1020;
const S11: Solution = {
  level: STAGES[10]!,
  roles: [
    `MY: 오는 길에 눈뽕(18,11)을 줍고 남동쪽 버튼(24,11) — ${S11_A}틱에 벽장 A 의 문(6,4)을 90틱 연다. ` +
      `그리고 그 자리에 남아 ${S11_FLASH}틱에 눈뽕을 터뜨려 금고문 앞 감시자를 재운다`,
    `ME: 서쪽 버튼(2,5) — ${S11_B}틱에 벽장 B 의 문(15,4)을 90틱 연다`,
    'MINE: 발판(1,11) — 탈출 게이트 채널의 나머지 절반',
    'I: 0(10,6) → 열린 A 에서 1 → 열린 B 에서 2 → 사냥개가 북쪽으로 올라간 창을 기다렸다가 금고문 → loot → escape',
  ],
  loops: [
    tape([
      seg(D, tiles(5)), seg(R, tiles(22)),
      seg(O, S11_A - tiles(27)), seg(E, 1),
      seg(O, S11_FLASH - S11_A - 1),
      seg(IN_FLASH, 1), seg(O, 4),
    ]),
    tape([seg(U, tiles(1)), seg(O, S11_B - tiles(1)), seg(E, 1), seg(O, 4)]),
    tape([seg(D, tiles(5)), seg(L, tiles(1)), seg(O, 4)]),
    tape([
      seg(O, S11_DELAY),
      seg(R, tiles(8)), seg(E, 1), seg(O, 1), // order 0
      seg(L, tiles(4)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 1 (6,3)
      seg(D, tiles(3)), seg(R, tiles(9)), seg(U, tiles(3)), seg(E, 1), seg(O, 1), // order 2 (15,3)
      seg(D, tiles(3)), seg(D, tiles(4)),
      seg(O, 150), // 금고문 앞 목이 비기를 기다린다 — 여기서 보이면 개가 붙는다
      seg(R, tiles(11)), seg(R, tiles(3)),
      seg(U, tiles(2)), seg(D, tiles(3)),
    ]),
  ],
};

// ── 12. THE THRESHOLD ─────────────────────────────────────────────────────
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

// ── 13. THE BREAKER ───────────────────────────────────────────────────────
const S13_CLOSE = 520;
const S13: Solution = {
  level: STAGES[12]!,
  roles: [
    'MY: 레버(8,8)로 먼저 감시안을 끈다 — 그리고 남쪽 발판(1,8)으로 이동해 대기 (2역)',
    'ME: 북서 발판(1,1)',
    `MINE: 마지막 발판(1,5)을 ${S13_CLOSE}틱에 밟는다 — 문이 열리는 대신 눈이 다시 뜬다`,
    'I: 눈이 감긴 동안 복도를 건너 게이트 앞(19,5)에 서 있다가, 가운데 줄(24,5)에서 한 박자 죽인 뒤 북쪽 띠의 코어를 찌르고 곧장 남쪽 띠의 탈출구로 내려간다',
  ],
  loops: [
    tape([
      seg(D, tiles(5)), seg(R, tiles(5)), seg(E, 1),
      seg(L, tiles(7)), seg(O, 4),
    ]),
    tape([seg(L, tiles(2)), seg(U, tiles(2)), seg(O, 4)]),
    tape([seg(O, S13_CLOSE - tiles(4)), seg(L, tiles(2)), seg(D, tiles(2)), seg(O, 4)]),
    tape([
      seg(O, 219), // 레버가 내려간 뒤에 출발한다
      seg(D, tiles(2)), seg(R, tiles(16)),
      seg(O, S13_CLOSE - 200 - tiles(18)),
      seg(R, tiles(1)), seg(R, tiles(4)),
      seg(O, 50), // 덩치가 동쪽 끝으로 물러날 때까지 가운데 줄에서 기다린다
      seg(U, tiles(3)), seg(D, tiles(3)), seg(D, tiles(3)),
    ]),
  ],
};

// ── 14. THE JUNCTION ──────────────────────────────────────────────────────
const S14_EYE = 380; // 레버 eye 를 켜 전력을 빼앗는 틱 (= 레이저가 되살아나는 틱)
const S14_DOOR = 660; // 발판 셋이 채워져 문이 전력을 가져가는 틱
/** 문칸(26,5)에서 죽이는 박자. 금고 안쪽 끝의 덩치가 물러나기를 기다린다. */
const S14_W1 = 240;
const S14_W2 = 20;
const S14: Solution = {
  level: STAGES[13]!,
  roles: [
    'MY: 레버(7,1)로 레이저를 끈다 → 발판(1,1) 로 이동 (2역)',
    `ME: ${S14_EYE}틱에 레버(7,8)로 감시안을 끈다 — 그 순간 레이저가 되살아난다 → 발판(1,8) (2역)`,
    `MINE: ${S14_DOOR}틱에 마지막 발판(1,5) — 문이 전력을 가져가고 눈이 다시 뜬다`,
    'I: 레이저가 죽은 동안 x13 을 건너고, 눈이 감긴 동안 분기실(x17~21)의 사냥개를 흘려보내며 CCTV 구간을 지나 ' +
      '문칸(26,5)에 선다. 거기서 코어(27,2)와 탈출구(27,8)를 한 번씩 찌르고 매번 그 한 칸으로 물러난다',
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
      seg(D, tiles(2)), seg(R, tiles(22)),
      seg(O, S14_DOOR - 150 - tiles(24)),
      seg(R, tiles(1)), seg(O, S14_W1), // 문칸(26,5)
      seg(R, tiles(1)), seg(U, tiles(3)), seg(D, tiles(3)), seg(L, tiles(1)), // 코어(27,2)
      seg(O, S14_W2),
      seg(R, tiles(1)), seg(D, tiles(3)), // 탈출구(27,8)
    ]),
  ],
};

// ── 15. THE LAST DOOR ─────────────────────────────────────────────────────
const S15_DOOR = 1500;
const S15_W1 = 100;
const S15_W2 = 120;
const S15_W3 = 40;
const S15_W4 = 60;
const S15_W5 = 20;
/** 순차 버튼 0→1→2 를 밟고 죽은 레이저(x20)를 건너 게이트 앞(24,6)에 서기까지. */
const S15_HEAD: Seg[] = [
  seg(D, tiles(3)), seg(R, tiles(7)), seg(R, tiles(3)),
  seg(U, tiles(4)), seg(E, 1), seg(O, 1), // order 0 (13,2)
  seg(O, S15_W1),
  seg(D, tiles(8)), seg(R, tiles(4)), seg(E, 1), seg(O, 1), // order 1 (17,10)
  seg(O, S15_W2),
  seg(U, tiles(7)), seg(R, tiles(1)), seg(E, 1), seg(O, 1), // order 2 (18,3) → seq 완성
  seg(O, S15_W3),
  seg(D, tiles(3)), seg(R, tiles(6)),
];
const S15_RUN = S15_HEAD.reduce((n, s) => n + s.ticks, 0);
const S15: Solution = {
  level: STAGES[14]!,
  roles: [
    'MY: 발판(1,1)',
    'ME: 발판(1,6)',
    `MINE: 발판(1,10) — 셋이 동시에 눌리는 ${S15_DOOR}틱에 전력이 exit 으로 넘어간다`,
    'I: 순차 버튼 0→1→2 로 레이저와 감시안을 죽이고, 사냥개가 비운 x22 를 건너 문 앞에 선다. ' +
      '문칸(25,6)은 40px 가 못 들어오는 자리라, 코어와 탈출구를 한 번씩 찌르고 그 칸으로 물러난다',
  ],
  loops: [
    tape([seg(L, tiles(2)), seg(U, tiles(2)), seg(O, 4)]),
    tape([seg(L, tiles(2)), seg(D, tiles(3)), seg(O, 4)]),
    tape([seg(O, S15_DOOR - tiles(9)), seg(L, tiles(2)), seg(D, tiles(7)), seg(O, 4)]),
    tape([
      seg(O, 41), // 출발을 늦춰도 되는 여유 — 문은 마지막 발판이 눌리는 순간에만 열린다
      ...S15_HEAD,
      seg(O, S15_DOOR - S15_RUN - 41),
      seg(R, tiles(1)), seg(O, S15_W4), // 문칸(25,6)
      seg(R, tiles(1)), seg(U, tiles(3)), seg(D, tiles(3)), seg(L, tiles(1)), // 코어(26,3)
      seg(O, S15_W5), // 다시 문칸에서 한 박자
      seg(R, tiles(1)), seg(D, tiles(4)), // 탈출구(26,10)
    ]),
  ],
};

export const SOLUTIONS: Solution[] = [
  S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15,
];
