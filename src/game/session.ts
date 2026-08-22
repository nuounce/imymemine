/**
 * I.MY.ME.MINE — 루프 진행과 스테이지 상태 (SPEC §1~§3).
 *
 * 세션은 **키 입력을 해석하지 않는다.** InputMask 와 아래 함수 호출만 받는다.
 * (`R`/`Q`/`Backspace` 같은 메타 키는 engine/input.ts 가 해석해 이 함수들을 부른다.)
 *
 * 잔상은 저장된 궤적이 아니라 저장된 입력 테이프이므로, 루프가 넘어갈 때마다
 * 월드를 통째로 새로 만들고(`createWorld`) 모든 잔상을 처음부터 다시 재생한다.
 */

import {
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  OVERWRITE_PER_STAGE,
  SLOT_NAMES,
} from '../sim/constants';
import type { InputMask, LevelDef, SimState, Tape, TickEvents } from '../sim/types';
import { createWorld, stepWorld, type GhostSpec } from '../sim/world';
import { STAGES } from './levels';

/**
 * `INTRO` 는 6컷 인트로 카툰 전용 페이즈다. 시뮬과 완전히 분리돼 있어
 * (`tickSession` 은 PLAY/TRANSITION 만 진행시킨다) 세션 상태를 건드리지 않는다.
 * `INTERLUDE`(막 사이 2컷 만화)도 같다 — 그래서 막간이 흐르는 동안
 * `elapsedTicks` 가 한 틱도 늘지 않는다(TIME_ATTACK 기록에 섞이지 않는다).
 */
export type Phase =
  | 'INTRO'
  | 'TITLE'
  | 'PLAY'
  | 'TRANSITION'
  | 'INTERLUDE'
  | 'CLEAR'
  | 'ALLCLEAR';

/**
 * `EASY` — 마이크를 쓰지 않는다. 입력 마스크의 마이크 비트가 항상 0 이라
 *   기존 동작과 완전히 동일하다.
 * `LISTEN` — 실제 마이크로 숨소리·주변 소음을 듣는다. 시끄러우면 간수가 온다.
 *
 * 모드는 **타이틀에서 고르는 세션 속성**이라 스테이지 진행이나 초기화로 바뀌지
 * 않는다 — `startStage` / `fullReset` 은 이 필드를 건드리지 않는다.
 */
export type Mode = 'EASY' | 'LISTEN';

/**
 * **플레이 방식**. `Mode`(EASY/LISTEN — 마이크를 쓰는가)와 완전히 직교한다:
 * 두 축은 자유롭게 조합된다(GAUNTLET + LISTEN 등).
 *
 * `STORY` — 지금까지의 동작. 스테이지를 하나씩 클리어하며 나아간다.
 * `GAUNTLET` — 1번부터 마지막까지 이어서 한 런. 누적 DEBT 가 성적이다.
 * `TIME_ATTACK` — 같이 이어서 하되 **누적 경과 시간**이 성적이다.
 *
 * 이 값은 **세션/표시 레이어 전용**이다. `SimState` 에 닿지 않고 `stepWorld` 의
 * 동작을 한 틱도 바꾸지 않는다 (tests/modes.test.ts 가 해시로 증명한다).
 */
export type PlayMode = 'STORY' | 'GAUNTLET' | 'TIME_ATTACK';

export const PLAY_MODES: readonly PlayMode[] = ['STORY', 'GAUNTLET', 'TIME_ATTACK'];

export interface Ghost {
  tape: Tape;
  corpse: boolean;
}

/** 클리어한 스테이지 하나의 성적. 런 결과 화면의 스플릿 행이 된다. */
export interface StageSplit {
  stageIndex: number;
  name: string;
  /** 그 스테이지에서 실제로 굴린 PLAY 틱(모든 루프 합). */
  ticks: number;
  afterimages: number;
  alerts: number;
  medal: boolean;
}

/** 이미 끝난 스테이지들의 누적치. 진행 중인 스테이지는 포함하지 않는다. */
export interface RunAccum {
  ticks: number;
  afterimages: number;
  alerts: number;
  medals: number;
  splits: StageSplit[];
}

/** 런 전체 성적(진행 중인 스테이지까지 포함한 현재값). */
export interface RunTotals {
  stages: number;
  ticks: number;
  afterimages: number;
  alerts: number;
  medals: number;
  debt: number;
}

/** localStorage 에 남는 모드별 최고 기록. */
export interface BestRecord {
  ticks: number;
  debt: number;
  afterimages: number;
  stages: number;
}

/** 런이 끝난 순간 확정되는 결과. 결과 화면은 이것만 읽는다. */
export interface RunResult {
  playMode: PlayMode;
  mode: Mode;
  totals: RunTotals;
  splits: StageSplit[];
  /** 이번 런 직전의 기록. 없으면 null. */
  previousBest: BestRecord | null;
  newBest: boolean;
  /** localStorage 저장 성공 여부. 실패해도 런 결과는 그대로 보여준다. */
  saved: boolean;
}

export interface Session {
  phase: Phase;
  mode: Mode;
  playMode: PlayMode;
  stageIndex: number;
  level: LevelDef;
  sim: SimState;
  ghosts: Ghost[];
  recording: number[];
  loopIndex: number;
  overwriteLeft: number;
  overwriteSlot: number | null;
  awaitingOverwritePick: boolean;
  debt: number;
  alerts: number;
  elapsedTicks: number;
  medal: boolean;
  transitionTimer: number;
  transitionMsg: string[];
  lastEvents: TickEvents;
  resetHold: number;
  paused: boolean;
  /** 런 누적치(끝난 스테이지들). 현재값은 `runTotals()` 로 읽는다. */
  run: RunAccum;
  /** 런이 끝났을 때만 채워진다. STORY 는 항상 null. */
  runResult: RunResult | null;
}

function emptyRun(): RunAccum {
  return { ticks: 0, afterimages: 0, alerts: 0, medals: 0, splits: [] };
}

function emptyEvents(): TickEvents {
  return {
    captured: false,
    cleared: false,
    lootTaken: false,
    gateToggled: false,
    interacted: false,
    alerted: false,
    footstep: false,
    ghostSpotted: false,
    flashFired: false,
  };
}

function stageAt(index: number): LevelDef {
  return STAGES[index] ?? STAGES[0]!;
}

/** 다음 루프에서 재생될 잔상 목록. 덮어쓰기 중인 슬롯은 빠진다. */
function activeGhosts(s: Session): GhostSpec[] {
  const out: GhostSpec[] = [];
  for (let i = 0; i < s.ghosts.length; i++) {
    if (s.overwriteSlot !== null && i === s.overwriteSlot - 1) continue;
    const g = s.ghosts[i]!;
    out.push({ tape: g.tape, corpse: g.corpse });
  }
  return out;
}

/** 월드를 틱 0으로 되돌리고 새 몸의 녹화를 시작한다. */
function beginLoop(s: Session): void {
  s.sim = createWorld(s.level, activeGhosts(s));
  s.recording = [];
  s.loopIndex = s.overwriteSlot !== null ? s.overwriteSlot - 1 : s.ghosts.length;
  s.lastEvents = emptyEvents();
  s.phase = 'PLAY';
}

export function createSession(): Session {
  const level = stageAt(0);
  return {
    phase: 'TITLE',
    mode: 'EASY',
    playMode: 'STORY',
    stageIndex: 0,
    level,
    sim: createWorld(level, []),
    ghosts: [],
    recording: [],
    loopIndex: 0,
    overwriteLeft: OVERWRITE_PER_STAGE,
    overwriteSlot: null,
    awaitingOverwritePick: false,
    debt: 0,
    alerts: 0,
    elapsedTicks: 0,
    medal: false,
    transitionTimer: 0,
    transitionMsg: [],
    lastEvents: emptyEvents(),
    resetHold: 0,
    paused: false,
    run: emptyRun(),
    runResult: null,
  };
}

/**
 * 스테이지를 처음부터 시작한다.
 * `mode`·`playMode`·`debt` 는 **일부러 건드리지 않는다** — 셋 다 스테이지가 아니라
 * 세션에 속한 값이다(모드는 타이틀에서 고른 것, 부채는 지울 수 없는 것).
 */
export function startStage(s: Session, stageIndex: number): void {
  // 떠나는 스테이지에서 실제로 쓴 시간·몸·알람을 런 누적치로 넘긴다.
  // 초기화(fullReset)로 같은 스테이지를 다시 시작해도 이 값은 남는다 —
  // 리셋은 부채를 얹을 뿐 이미 흘러간 시간을 되돌려주지 않는다.
  s.run.ticks += s.elapsedTicks;
  s.run.afterimages += s.ghosts.length;
  s.run.alerts += s.alerts;

  s.stageIndex = stageIndex;
  s.level = stageAt(stageIndex);
  s.ghosts = [];
  s.overwriteLeft = OVERWRITE_PER_STAGE;
  s.overwriteSlot = null;
  s.awaitingOverwritePick = false;
  s.alerts = 0;
  s.elapsedTicks = 0;
  s.medal = false;
  s.transitionTimer = 0;
  s.transitionMsg = [];
  s.resetHold = 0;
  s.paused = false;
  beginLoop(s);
}

/** 확정 사유별 전환 오버레이 카피 (SPEC §8). */
function transitionCopy(s: Session, reason: 'MANUAL' | 'CAPTURED' | 'TIMEUP'): string[] {
  const head =
    reason === 'CAPTURED'
      ? 'CAPTURED.'
      : reason === 'TIMEUP'
        ? 'TIME IS UP.'
        : 'COMMITTED.';
  const nextSlot = SLOT_NAMES[Math.min(s.ghosts.length, MAX_AFTERIMAGES)] ?? 'MINE';
  return [
    head,
    'YOUR ACTIONS WILL RETURN.',
    `LOOP ${s.ghosts.length + 1} — YOU ARE "${nextSlot}"`,
  ];
}

/**
 * 지금 녹화 중인 런을 잔상으로 확정한다.
 * 잔상 슬롯이 이미 가득 찼는데 또 확정하면 LOOP FAILED — 전체 초기화 + DEBT (SPEC §1.1).
 */
export function commitLoop(s: Session, reason: 'MANUAL' | 'CAPTURED' | 'TIMEUP'): void {
  if (s.phase !== 'PLAY') return;
  // 슬롯 선택 메뉴가 열린 채 TIMEUP/체포로 강제 확정될 수 있다 (선택 중에도
  // 세계는 흐른다). 플래그를 여기서 지우지 않으면 다음 루프가 오버레이 + 입력
  // 동결 상태로 시작하고, 1/2/3 이 스테이지당 1회뿐인 덮어쓰기를 오소모한다.
  // 확정은 사유가 무엇이든 선택 메뉴를 닫는다.
  s.awaitingOverwritePick = false;
  const tape = Uint16Array.from(s.recording);
  const corpse = reason === 'CAPTURED';

  if (s.overwriteSlot !== null) {
    s.ghosts[s.overwriteSlot - 1] = { tape, corpse };
    s.overwriteSlot = null;
  } else if (s.ghosts.length >= MAX_AFTERIMAGES) {
    // 4번째 몸까지 확정 = LOOP FAILED. fullReset 이 startStage 를 거치며 전환 상태를
    // 전부 지우므로, 오버레이 카피와 페이즈는 **초기화 뒤에** 얹어야 한다 (SPEC §1.1).
    fullReset(s);
    s.transitionMsg = ['NO ONE LEFT TO BECOME.', 'THE STAGE FORGETS YOU.'];
    s.phase = 'TRANSITION';
    s.transitionTimer = LOOP_TRANSITION_TICKS;
    return;
  } else {
    s.ghosts.push({ tape, corpse });
  }

  s.transitionMsg = transitionCopy(s, reason);
  s.phase = 'TRANSITION';
  s.transitionTimer = LOOP_TRANSITION_TICKS;
}

/** `Q` 로 덮어쓰기 모드 진입. 남은 횟수와 지울 잔상이 있어야 한다. */
export function beginOverwriteMode(s: Session): void {
  if (s.phase !== 'PLAY') return;
  if (s.overwriteLeft <= 0 || s.ghosts.length === 0) return;
  s.awaitingOverwritePick = true;
}

/** slot 은 1|2|3. 성공 시 true. 스테이지당 1회 제한 (SPEC §3-2). */
export function requestOverwrite(s: Session, slot: number): boolean {
  if (!s.awaitingOverwritePick) return false;
  if (s.overwriteLeft <= 0) return false;
  if (slot < 1 || slot > s.ghosts.length) return false;
  s.awaitingOverwritePick = false;
  s.overwriteLeft--;
  s.overwriteSlot = slot;
  beginLoop(s);
  return true;
}

/** `Backspace` 2초 홀드. 공짜가 아니다 — DEBT 는 세션 내내 남는다. */
export function fullReset(s: Session): void {
  const debt = s.debt + 1;
  const stage = s.stageIndex;
  startStage(s, stage);
  s.debt = debt;
}

export function nextStage(s: Session): void {
  if (isFinalStage(s.stageIndex)) {
    // 마지막 스테이지를 넘긴 순간이 곧 런의 끝이다. STORY 는 기록을 남기지 않는다.
    if (s.playMode !== 'STORY') finishRun(s);
    s.phase = 'ALLCLEAR';
    return;
  }
  startStage(s, s.stageIndex + 1);
}

// ── 엔딩 (STORY.md §6) ─────────────────────────────────────────────────────
//
// 마지막 스테이지를 나온 뒤 무엇을 보는가는 **DEBT 하나**로 갈린다. 전체 초기화로
// 지운 실수의 수가 곧 시설이 회수한 잔상의 수(수율)이기 때문이다 (STORY.md §2).
//
// 이 블록은 전부 **읽기 전용**이다. `Session` 도 `SimState` 도 한 비트 쓰지 않는다 —
// 엔딩은 화면일 뿐이고, 화면이 상태를 만지면 결정론이 무너진다 (SPEC §4).

/**
 * `TOGETHER`    DEBT 0 — 아무것도 두고 오지 않았다. 넷이 함께 나간다.
 * `LEFT_BEHIND` DEBT 1~2 — 나가지만 안쪽으로 회수반이 들어간다.
 * `YIELD`       DEBT 3+ — 나갔다. 안에서 다음 배치가 깨어난다.
 */
export type EndingId = 'TOGETHER' | 'LEFT_BEHIND' | 'YIELD';

/** 이 이상이면 시설 입장에서 수확이 성공한 것이다 (STORY.md §6). */
export const YIELD_DEBT = 3;

/** 경계는 0 과 `YIELD_DEBT` 딱 둘. 음수·소수는 0 쪽으로 눌러 방어한다. */
export function endingFor(debt: number): EndingId {
  const d = Number.isFinite(debt) ? Math.max(0, Math.floor(debt)) : 0;
  if (d === 0) return 'TOGETHER';
  if (d < YIELD_DEBT) return 'LEFT_BEHIND';
  return 'YIELD';
}

/**
 * 마지막 스테이지의 인덱스. **숫자를 박지 않는다** — 스테이지가 늘거나 줄어도
 * 엔딩이 뜨는 지점은 배열의 끝을 따라간다.
 *
 * `total` 인자는 그 유도를 테스트가 확인하기 위한 것이다. 게임은 언제나
 * 기본값(`STAGES.length`)으로 부른다.
 */
export function finalStageIndex(total: number = STAGES.length): number {
  return Math.max(0, total - 1);
}

/** 이 스테이지를 클리어하면 엔딩인가. 세 플레이 방식 모두 같은 기준을 쓴다. */
export function isFinalStage(
  stageIndex: number,
  total: number = STAGES.length,
): boolean {
  return stageIndex >= finalStageIndex(total);
}

/** 엔딩 화면이 읽는 전부. 여기 없는 값은 엔딩이 알 필요가 없다. */
export interface EndingView {
  id: EndingId;
  /** 시설이 회수한 잔상 수 = 이 배치의 수율. */
  debt: number;
  totals: RunTotals;
  playMode: PlayMode;
  mode: Mode;
}

/**
 * 런의 마지막 성적을 엔딩이 읽을 형태로 굳힌다.
 * `STORY` 는 `runResult` 를 만들지 않으므로(모드별 기록의 기준이 다르다)
 * 세 방식 모두 `runTotals` 에서 같은 방식으로 뽑는다.
 */
export function endingView(s: Session): EndingView {
  return {
    id: endingFor(s.debt),
    debt: s.debt,
    totals: runTotals(s),
    playMode: s.playMode,
    mode: s.mode,
  };
}

// ── 런 (GAUNTLET / TIME_ATTACK) ────────────────────────────────────────────

/**
 * 타이틀에서 새 런을 연다. 런 누적치와 **DEBT** 를 0 으로 되돌린다 —
 * 부채가 리셋되지 않는 범위는 "런 하나"이고, 그 경계가 여기다.
 */
export function startRun(s: Session, stageIndex = 0): void {
  s.run = emptyRun();
  s.runResult = null;
  s.debt = 0;
  s.elapsedTicks = 0;
  s.ghosts = [];
  s.alerts = 0;
  startStage(s, stageIndex);
}

/** 타이틀에서만 바꾼다 — 런 도중에 바뀌면 기록의 기준이 흔들린다. */
export function setPlayMode(s: Session, m: PlayMode): void {
  if (s.phase !== 'TITLE') return;
  s.playMode = m;
}

/** 진행 중인 스테이지까지 포함한 런의 현재 성적. */
export function runTotals(s: Session): RunTotals {
  return {
    stages: s.run.splits.length,
    ticks: s.run.ticks + s.elapsedTicks,
    afterimages: s.run.afterimages + s.ghosts.length,
    alerts: s.run.alerts + s.alerts,
    medals: s.run.medals,
    // DEBT 는 애초에 런 전체 누적값이다 (SPEC §3-2).
    debt: s.debt,
  };
}

// ── 기록 저장 (localStorage — 실패해도 게임은 죽지 않는다) ─────────────────
//
// 사파리 프라이빗 모드·쿠키 차단·용량 초과 환경에서 localStorage 는 접근만 해도
// 예외를 던진다. 기록 하나 때문에 런이 날아가면 안 되므로 전부 삼킨다.
// 네트워크로는 아무것도 보내지 않는다 — 로컬 전용이다.

const BEST_PREFIX = 'imm.best';

/** 두 축을 모두 키에 넣는다. LISTEN 런과 EASY 런은 난이도가 달라 같은 표에 못 올린다. */
function bestKey(playMode: PlayMode, mode: Mode): string {
  return `${BEST_PREFIX}.${playMode}.${mode}`;
}

function readNum(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

export function loadBest(playMode: PlayMode, mode: Mode): BestRecord | null {
  try {
    const ls = globalThis.localStorage as Storage | undefined;
    const raw = ls?.getItem(bestKey(playMode, mode)) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const ticks = readNum(r['ticks']);
    const debt = readNum(r['debt']);
    const afterimages = readNum(r['afterimages']);
    const stages = readNum(r['stages']);
    if (ticks === null || debt === null || afterimages === null || stages === null) {
      return null;
    }
    return { ticks, debt, afterimages, stages };
  } catch {
    return null;
  }
}

/** @returns 저장 성공 여부. false 여도 호출자는 그냥 진행한다. */
export function saveBest(playMode: PlayMode, mode: Mode, rec: BestRecord): boolean {
  try {
    const ls = globalThis.localStorage as Storage | undefined;
    if (ls === undefined || ls === null) return false;
    ls.setItem(bestKey(playMode, mode), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

/**
 * 이번 런이 기록을 갈아치웠는가.
 * TIME_ATTACK = 최단 시간. GAUNTLET = 최소 DEBT, 동률이면 최소 잔상.
 */
export function isBetterRun(
  playMode: PlayMode,
  totals: RunTotals,
  best: BestRecord | null,
): boolean {
  if (best === null) return true;
  if (playMode === 'TIME_ATTACK') return totals.ticks < best.ticks;
  if (totals.debt !== best.debt) return totals.debt < best.debt;
  return totals.afterimages < best.afterimages;
}

/** 런을 확정하고 기록을 갱신한다. `s.runResult` 가 결과 화면의 유일한 입력이다. */
export function finishRun(s: Session): void {
  const totals = runTotals(s);
  const previousBest = loadBest(s.playMode, s.mode);
  const newBest = isBetterRun(s.playMode, totals, previousBest);
  const saved = newBest
    ? saveBest(s.playMode, s.mode, {
        ticks: totals.ticks,
        debt: totals.debt,
        afterimages: totals.afterimages,
        stages: totals.stages,
      })
    : false;
  s.runResult = {
    playMode: s.playMode,
    mode: s.mode,
    totals,
    splits: s.run.splits.slice(),
    previousBest,
    newBest,
    saved,
  };
}

/** 1 틱 진행. TRANSITION/CLEAR 페이즈도 여기서 진행시킨다. */
export function tickSession(s: Session, input: InputMask): void {
  if (s.paused) return;

  if (s.phase === 'TRANSITION') {
    s.transitionTimer--;
    if (s.transitionTimer <= 0) beginLoop(s);
    return;
  }
  if (s.phase !== 'PLAY') return;

  s.recording.push(input);
  const ev = stepWorld(s.sim, input);
  s.lastEvents = ev;
  s.elapsedTicks++;
  s.alerts = s.sim.alerts;

  switch (s.sim.outcome) {
    case 'CLEARED': {
      s.medal = s.ghosts.length <= s.level.par;
      // 스플릿은 여기서 딱 한 번 쌓인다 — 다음 틱부터 페이즈가 PLAY 가 아니라
      // 이 분기에 다시 들어오지 않는다.
      s.run.splits.push({
        stageIndex: s.stageIndex,
        name: s.level.name,
        ticks: s.elapsedTicks,
        afterimages: s.ghosts.length,
        alerts: s.alerts,
        medal: s.medal,
      });
      if (s.medal) s.run.medals++;
      s.phase = 'CLEAR';
      break;
    }
    case 'CAPTURED':
      commitLoop(s, 'CAPTURED');
      break;
    case 'TIMEUP':
      commitLoop(s, 'TIMEUP');
      break;
    case 'RUNNING':
      break;
  }
}
