/**
 * 환경 단서 QA — `src/render/note.ts`.
 *
 * 이 파일이 지키는 것은 그림이 아니라 **경계**다. 단서는 레벨 데이터 + 렌더 전용
 * 레이어이고, 시뮬레이션에는 존재하지 않는다. 그 경계가 무너지면 테이프·결정론이
 * 통째로 흔들리므로 첫 두 블록이 그것을 정면으로 증명한다:
 *
 *   1. 단서를 **실제로 읽은** 실행과 읽기 레이어를 아예 부르지 않은 실행의
 *      상태 해시가 **매 틱** 같다.
 *   2. 단서 앞에서 `E` 를 눌러도 버튼·레버 판정이 일어나지 않는다.
 *      대조군: 같은 방의 진짜 레버 앞에서 같은 `E` 를 누르면 일어난다.
 *
 * 나머지는 배치(벽·장치·통로와의 관계)와 문구(`STORY.md` §5 원문 대조)다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STAGES } from '../src/game/levels';
import { hashState } from '../src/sim/hash';
import type { LevelDef, SimState, Tape } from '../src/sim/types';
import { createWorld, stepWorld } from '../src/sim/world';
import {
  ALL_NOTES,
  NOTES_BY_STAGE,
  notesFor,
  openNoteId,
  resetNotes,
  updateNotes,
  type NoteDef,
} from '../src/render/note';
import { driveWaypoints, type Waypoint } from './tapes';

// ── 공용 헬퍼 ──────────────────────────────────────────────────────────────

function stage(id: string): LevelDef {
  const lv = STAGES.find((s) => s.id === id);
  assert.ok(lv !== undefined, `스테이지 ${id} 가 없다`);
  return lv;
}

interface Run {
  /** 매 틱의 상태 해시. */
  hashes: number[];
  /** 어느 틱에라도 `interacted` 가 참이었는가. */
  interacted: boolean;
  /** 읽기 레이어를 켠 실행에서 실제로 펼쳐진 단서 id 들. */
  opened: string[];
  sim: SimState;
}

/**
 * 같은 테이프를 두 가지 방식으로 돌린다.
 * `notes` 가 참이면 매 틱 `updateNotes` 를 부른다 — 실제 렌더 루프와 같은 순서다
 * (`stepWorld` → `updateNotes`). 거짓이면 읽기 레이어가 아예 존재하지 않는 실행이다.
 */
function replay(level: LevelDef, t: Tape, notes: boolean): Run {
  if (notes) resetNotes();
  const sim = createWorld(level, []);
  const run: Run = { hashes: [], interacted: false, opened: [], sim };
  for (let i = 0; i < t.length; i++) {
    const ev = stepWorld(sim, t[i] ?? 0);
    if (ev.interacted) run.interacted = true;
    if (notes) {
      updateNotes(sim);
      const open = openNoteId();
      if (open !== null && !run.opened.includes(open)) run.opened.push(open);
    }
    run.hashes.push(hashState(sim));
  }
  return run;
}

/** 웨이포인트를 따라 몰아 만든 입력열. 사람이 실제로 녹화 가능한 한 루프다. */
function driveTape(level: LevelDef, wps: readonly Waypoint[]): Tape {
  return driveWaypoints(level, wps).tape;
}

// ── 타일맵 조회 ────────────────────────────────────────────────────────────

function rowOf(level: LevelDef, ty: number): string {
  return level.tiles[ty] ?? '';
}

function isWall(level: LevelDef, tx: number, ty: number): boolean {
  const row = rowOf(level, ty);
  const c = row[tx];
  return c === undefined || c === '#';
}

function charAt(level: LevelDef, tx: number, ty: number): string {
  return rowOf(level, ty)[tx] ?? '#';
}

function floorTiles(level: LevelDef): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < level.tiles.length; ty++) {
    const row = rowOf(level, ty);
    for (let tx = 0; tx < row.length; tx++) {
      if (!isWall(level, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** 단서가 놓인 칸을 **막힌 것으로 치고** 나머지 바닥이 여전히 하나로 이어지는가. */
function stillConnectedWithout(
  level: LevelDef,
  hole: { tx: number; ty: number },
): boolean {
  const open = floorTiles(level).filter(
    (t) => !(t.tx === hole.tx && t.ty === hole.ty),
  );
  if (open.length === 0) return true;
  const key = (tx: number, ty: number): string => `${tx},${ty}`;
  const openSet = new Set(open.map((t) => key(t.tx, t.ty)));
  const seen = new Set<string>();
  const start = open[0];
  assert.ok(start !== undefined);
  const stack = [start];
  seen.add(key(start.tx, start.ty));
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    const nbrs = [
      { tx: cur.tx + 1, ty: cur.ty },
      { tx: cur.tx - 1, ty: cur.ty },
      { tx: cur.tx, ty: cur.ty + 1 },
      { tx: cur.tx, ty: cur.ty - 1 },
    ];
    for (const n of nbrs) {
      const k = key(n.tx, n.ty);
      if (!openSet.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen.size === open.length;
}

/** 그 방에서 `E` 로 만지는 것들의 타일 좌표. 단서는 여기서 떨어져 있어야 한다. */
function interactiveTiles(level: LevelDef): { tx: number; ty: number }[] {
  return [
    ...(level.buttons ?? []),
    ...(level.levers ?? []),
    ...(level.seqButtons ?? []),
  ].map((d) => ({ tx: d.tx, ty: d.ty }));
}

/** 그 방에서 무언가가 이미 차지하고 있는 타일 전부. */
function occupiedTiles(level: LevelDef): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [...interactiveTiles(level)];
  for (const p of level.plates ?? []) out.push({ tx: p.tx, ty: p.ty });
  for (const c of level.crates ?? []) out.push({ tx: c.tx, ty: c.ty });
  for (const f of level.flashes ?? []) out.push({ tx: f.tx, ty: f.ty });
  for (const c of level.cctvs ?? []) out.push({ tx: c.tx, ty: c.ty });
  for (const g of level.gates ?? []) {
    for (let y = 0; y < (g.h ?? 1); y++) {
      for (let x = 0; x < (g.w ?? 1); x++) out.push({ tx: g.tx + x, ty: g.ty + y });
    }
  }
  for (const g of level.grates ?? []) {
    for (let y = 0; y < (g.h ?? 1); y++) {
      for (let x = 0; x < (g.w ?? 1); x++) out.push({ tx: g.tx + x, ty: g.ty + y });
    }
  }
  for (const g of level.guards ?? []) {
    for (const w of g.path) out.push({ tx: w.tx, ty: w.ty });
  }
  out.push({ tx: level.loot.tx, ty: level.loot.ty });
  for (let y = 0; y < (level.escape.h ?? 1); y++) {
    for (let x = 0; x < (level.escape.w ?? 1); x++) {
      out.push({ tx: level.escape.tx + x, ty: level.escape.ty + y });
    }
  }
  return out;
}

/** 레이저 선분이 지나는 타일(수직·수평만 쓰이므로 두 축 중 하나는 고정이다). */
function laserTiles(level: LevelDef): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (const l of level.lasers ?? []) {
    const dx = Math.sign(l.to.tx - l.from.tx);
    const dy = Math.sign(l.to.ty - l.from.ty);
    let { tx, ty } = l.from;
    for (let i = 0; i < 64; i++) {
      out.push({ tx, ty });
      if (tx === l.to.tx && ty === l.to.ty) break;
      tx += dx;
      ty += dy;
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. 읽어도 시뮬레이션은 한 비트도 움직이지 않는다
// ══════════════════════════════════════════════════════════════════════════

describe('단서 읽기는 시뮬레이션 밖에 있다', () => {
  const level = stage('13_MINE');
  const note = notesFor('13_MINE')[0];
  assert.ok(note !== undefined);

  /** 스폰(3,3) → 단서(9,1). 도착해서 `E` 1틱, 그 뒤 제자리 20틱. */
  const toNote: Waypoint[] = [
    { tx: 9, ty: 3 },
    { tx: note.tx, ty: note.ty, press: true, wait: 20 },
  ];
  const t = driveTape(level, toNote);

  it('단서를 실제로 펼친다 (아래 두 테스트의 전제)', () => {
    const withNotes = replay(level, t, true);
    assert.deepEqual(withNotes.opened, [note.id]);
  });

  it('상태 해시가 매 틱 같다 — 읽기 레이어의 유무와 무관하게', () => {
    const bare = replay(level, t, false);
    const withNotes = replay(level, t, true);
    assert.equal(withNotes.hashes.length, bare.hashes.length);
    assert.ok(bare.hashes.length > 0, '테이프가 비어 있다');
    for (let i = 0; i < bare.hashes.length; i++) {
      assert.equal(
        withNotes.hashes[i],
        bare.hashes[i],
        `틱 ${i} 에서 해시가 갈렸다 — 읽기 레이어가 SimState 를 건드렸다`,
      );
    }
  });

  it('두 번 읽어도, 닫았다 다시 읽어도 해시가 같다', () => {
    // `E` 를 두 번 누른다: 첫 번째로 열고, 두 번째로 닫는다.
    const twice: Waypoint[] = [
      { tx: 9, ty: 3 },
      { tx: note.tx, ty: note.ty, press: true, wait: 12 },
      { tx: note.tx, ty: note.ty, press: true, wait: 12 },
    ];
    const t2 = driveTape(level, twice);
    const bare = replay(level, t2, false);
    const withNotes = replay(level, t2, true);
    assert.deepEqual(withNotes.hashes, bare.hashes);
    // 두 번째 `E` 는 닫는 입력이다 — 마지막에는 아무것도 펼쳐져 있지 않다.
    assert.equal(openNoteId(), null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 단서 앞의 `E` 는 장치를 건드리지 않는다 (대조군 포함)
// ══════════════════════════════════════════════════════════════════════════

describe('단서 앞의 E 와 장치 앞의 E', () => {
  const level = stage('13_MINE');
  const note = notesFor('13_MINE')[0];
  const lever = (level.levers ?? [])[0];
  assert.ok(note !== undefined);
  assert.ok(lever !== undefined, '대조군으로 쓸 레버가 없다');

  it('단서 앞에서 누르면 버튼·레버·순차 버튼 어느 것도 반응하지 않는다', () => {
    const t = driveTape(level, [
      { tx: 9, ty: 3 },
      { tx: note.tx, ty: note.ty, press: true, wait: 20 },
    ]);
    const run = replay(level, t, true);

    assert.equal(run.interacted, false, 'E 가 장치 판정에 걸렸다');
    for (const l of run.sim.levers) assert.equal(l.on, false, '레버가 넘어갔다');
    for (const b of run.sim.buttons) assert.equal(b.on, false, '버튼이 눌렸다');
    for (const g of run.sim.seqGroups) assert.equal(g.next, 0, '순차 버튼이 진행됐다');
    // 그러면서 단서는 확실히 열렸다 — "아무 일도 안 일어남"이 아니라
    // "시뮬에서만 아무 일도 안 일어남"이라야 이 테스트가 뜻을 갖는다.
    assert.deepEqual(run.opened, [note.id]);
  });

  it('대조군 — 진짜 레버 앞에서 같은 E 를 누르면 넘어간다', () => {
    const t = driveTape(level, [
      { tx: lever.tx, ty: 3 },
      { tx: lever.tx, ty: lever.ty, press: true, wait: 20 },
    ]);
    const run = replay(level, t, true);

    assert.equal(run.interacted, true, '레버 앞의 E 가 먹지 않았다');
    assert.equal(run.sim.levers[0]?.on, true);
    // 레버 자리는 단서에서 멀다 — 같은 키가 두 가지를 뜻하지 않는다.
    assert.deepEqual(run.opened, []);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 배치 — 벽에 붙어 있고, 아무것과도 겹치지 않고, 길을 막지 않는다
// ══════════════════════════════════════════════════════════════════════════

describe('단서 배치', () => {
  const entries: { level: LevelDef; note: NoteDef }[] = [];
  for (const [id, defs] of Object.entries(NOTES_BY_STAGE)) {
    for (const note of defs) entries.push({ level: stage(id), note });
  }

  it('배치된 스테이지 id 가 전부 실재한다', () => {
    for (const id of Object.keys(NOTES_BY_STAGE)) {
      assert.ok(
        STAGES.some((s) => s.id === id),
        `${id} 라는 스테이지가 없다`,
      );
    }
    assert.equal(entries.length, ALL_NOTES.length);
  });

  it('id 와 자리가 겹치지 않는다', () => {
    const ids = new Set<string>();
    for (const { note } of entries) {
      assert.ok(!ids.has(note.id), `id 중복: ${note.id}`);
      ids.add(note.id);
    }
    for (const [id, defs] of Object.entries(NOTES_BY_STAGE)) {
      const spots = new Set<string>();
      for (const n of defs) {
        const k = `${n.tx},${n.ty}`;
        assert.ok(!spots.has(k), `${id} 안에서 같은 칸에 둘: ${k}`);
        spots.add(k);
      }
    }
  });

  for (const { level, note } of entries) {
    it(`${level.id} · ${note.id} — 바닥이고, 벽에 붙어 있고, 1타일 통로가 아니다`, () => {
      const { tx, ty } = note;
      assert.equal(isWall(level, tx, ty), false, '벽 안에 박혀 있다');
      assert.notEqual(charAt(level, tx, ty), 'S', '스폰 지점 위에 있다');

      const left = isWall(level, tx - 1, ty);
      const right = isWall(level, tx + 1, ty);
      const up = isWall(level, tx, ty - 1);
      const down = isWall(level, tx, ty + 1);

      assert.ok(left || right || up || down, '벽에서 떨어져 방 한가운데에 있다');
      assert.equal(left && right, false, '1타일 세로 통로 한복판이다');
      assert.equal(up && down, false, '1타일 가로 통로 한복판이다');
    });

    it(`${level.id} · ${note.id} — 장치·상자·격자·순찰 경유지와 겹치지 않는다`, () => {
      for (const o of occupiedTiles(level)) {
        assert.ok(
          !(o.tx === note.tx && o.ty === note.ty),
          `이미 무언가 있는 칸이다 (${o.tx},${o.ty})`,
        );
      }
      for (const o of laserTiles(level)) {
        assert.ok(
          !(o.tx === note.tx && o.ty === note.ty),
          `레이저 선분 위다 (${o.tx},${o.ty})`,
        );
      }
    });

    it(`${level.id} · ${note.id} — E 로 만지는 장치에서 2타일 이상 떨어져 있다`, () => {
      for (const d of interactiveTiles(level)) {
        const cheb = Math.max(Math.abs(d.tx - note.tx), Math.abs(d.ty - note.ty));
        assert.ok(
          cheb >= 2,
          `장치 (${d.tx},${d.ty}) 와 ${cheb}타일 — 같은 E 가 두 가지를 뜻하게 된다`,
        );
      }
    });

    it(`${level.id} · ${note.id} — 그 칸을 막아도 방이 갈라지지 않는다`, () => {
      assert.ok(
        stillConnectedWithout(level, note),
        '이 칸이 통로의 목이다 — 길을 막는 자리에는 둘 수 없다',
      );
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. 막별 분포
// ══════════════════════════════════════════════════════════════════════════

/** STAGES 인덱스 → 막. 4막 구성(01~04 / 05~08 / 09~12 / 13~15)을 그대로 쓴다. */
function actOf(levelId: string): number {
  const i = STAGES.findIndex((s) => s.id === levelId);
  assert.ok(i >= 0, `${levelId} 를 STAGES 에서 못 찾았다`);
  return Math.min(4, Math.floor(i / 4) + 1);
}

describe('막별 분포', () => {
  it('네 막 모두 단서를 최소 하나씩 갖는다', () => {
    const byAct = new Map<number, string[]>();
    for (const [id, defs] of Object.entries(NOTES_BY_STAGE)) {
      const a = actOf(id);
      const list = byAct.get(a) ?? [];
      for (const n of defs) list.push(n.id);
      byAct.set(a, list);
    }
    for (const a of [1, 2, 3, 4]) {
      const list = byAct.get(a) ?? [];
      assert.ok(list.length >= 1, `${a}막에 단서가 없다`);
    }
    // 2·3·4막은 두 장씩이다(인쇄물 + 낙서 / 상태 + 주의 / 요약 + 낙서).
    for (const a of [2, 3, 4]) {
      assert.ok((byAct.get(a) ?? []).length >= 2, `${a}막의 단서가 두 장이 아니다`);
    }
  });

  it('손글씨 낙서는 2막과 4막에만 있다', () => {
    for (const [id, defs] of Object.entries(NOTES_BY_STAGE)) {
      for (const n of defs) {
        if (n.kind !== 'SCRAWL') continue;
        assert.ok([2, 4].includes(actOf(id)), `${n.id} 가 ${actOf(id)}막에 있다`);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. 문구 — STORY.md §5 원문 대조
// ══════════════════════════════════════════════════════════════════════════

/**
 * `STORY.md` §5 의 일곱 줄을 **그대로** 옮긴 것. 이 배열과 `NOTES_BY_STAGE` 의
 * 문구 집합이 같지 않으면 둘 중 하나가 원문에서 떠내려간 것이다.
 */
const STORY_5: readonly string[] = [
  '점검표 — 잠금 해제 확인 / 조명 정상 / 대상 각성 확인',
  '배치 기록 — 회수 3. 손실 1. 손실분은 자재로 처리.',
  '여기까지 온 건 나만이 아니다',
  '코어 상태 — 축적률 정상. 대상 협조적.',
  '주의 — 대상이 코어를 인지할 경우 회수량이 급증함. 인지를 막지 말 것.',
  '공정 요약 — 배치당 평균 회수 2.7. 목표 3.0.',
  '문은 열려 있었다. 나는 그게 함정인 줄 알았다.',
];

/** `STORY.md` §8 "쓰지 말 것" — 이 이야기의 공포는 폭력이 아니라 회계다. */
const FORBIDDEN: readonly string[] = [
  '폭력',
  '고문',
  '유혈',
  '살해',
  '죽여',
  '죽음',
  '비명',
  '고통',
  '때린',
  '학대',
];

describe('단서 문구', () => {
  it('문구 목록이 상수로 있고 중복이 없다', () => {
    const texts = ALL_NOTES.map((n) => n.text);
    assert.equal(texts.length, STORY_5.length);
    assert.equal(new Set(texts).size, texts.length, '같은 문구가 두 번 쓰였다');
    for (const t of texts) assert.notEqual(t.trim(), '', '빈 문구가 있다');
  });

  it('STORY.md §5 와 집합이 같다 — 한 글자도 다르지 않게', () => {
    const got = [...ALL_NOTES.map((n) => n.text)].sort();
    const want = [...STORY_5].sort();
    assert.deepEqual(got, want);
  });

  it('§8 금지 항목(폭력·고문 묘사)이 없다', () => {
    for (const n of ALL_NOTES) {
      for (const bad of FORBIDDEN) {
        assert.ok(!n.text.includes(bad), `${n.id} 에 "${bad}" 가 들어 있다`);
      }
    }
  });

  it('핵심 단서가 3막에 있다', () => {
    const key = '주의 — 대상이 코어를 인지할 경우 회수량이 급증함. 인지를 막지 말 것.';
    let found: string | null = null;
    for (const [id, defs] of Object.entries(NOTES_BY_STAGE)) {
      if (defs.some((n) => n.text === key)) found = id;
    }
    assert.ok(found !== null, '핵심 단서가 어디에도 없다');
    assert.equal(actOf(found), 3);
  });
});
