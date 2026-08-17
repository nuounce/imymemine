/**
 * HUD · 오버레이 · 타이틀 (SPEC §8).
 *
 * 이 게임의 HUD는 장식이 아니라 **자원 표시기**다. 남은 시간·남은 몸·남은
 * 덮어쓰기·누적 부채가 곧 전략의 입력값이라, 넷 다 항상 화면에 있어야 한다.
 */
import {
  BODY_SUB,
  CANVAS_H,
  CANVAS_W,
  LOOP_TRANSITION_TICKS,
  MAX_AFTERIMAGES,
  MAX_TICKS,
  RESET_HOLD_TICKS,
  SLOT_NAMES,
  TICK_HZ,
} from '../sim/constants';
import {
  loadBest,
  runTotals,
  type BestRecord,
  type Mode,
  type PlayMode,
  type RunResult,
  type Session,
  type StageSplit,
} from '../game/session';
import { STAGES } from '../game/levels';
import { currentObjective, updateWhisper, type WhisperView } from '../game/whisper';
import type { MicView } from '../engine/mic';
import {
  A_SLOT,
  C_BG,
  C_CORPSE,
  C_DANGER,
  C_I_CORE,
  C_I_RING,
  C_LOOT,
  C_OFF,
  C_ON,
  C_PANEL,
  C_SLOT,
  C_TEXT,
  C_TEXT_DIM,
  font,
  MONO,
  withAlpha,
} from './palette';

const PAD = 14;

// ── 플레이 방식 문구 ───────────────────────────────────────────────────────
// 두 축은 직교한다: 여기(플레이 방식)와 EASY/LISTEN(감지 방식)은 서로를 모른다.

const PLAY_MODE_LABEL: Readonly<Record<PlayMode, string>> = {
  STORY: '[ STORY ]',
  GAUNTLET: '[ GAUNTLET ]',
  TIME_ATTACK: '[ TIME ATTACK ]',
};

/** 칩 아래 한 줄. 셋 다 항상 보인다 — 고르기 전에 뭔지 알아야 한다. */
const PLAY_MODE_CAPTION: Readonly<Record<PlayMode, string>> = {
  STORY: '한 판씩',
  GAUNTLET: '부채 누적',
  TIME_ATTACK: '총 시간',
};

const PLAY_MODE_LINE: Readonly<Record<PlayMode, string>> = {
  STORY: '스테이지를 하나씩 클리어한다. 처음이라면 이쪽.',
  GAUNTLET: '부채는 끝까지 따라온다 — 처음부터 끝까지 이어서, DEBT 는 지워지지 않는다',
  TIME_ATTACK: '모든 루프의 시간이 합산된다 — 조기 확정(R)이 곧 기록 단축',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 틱 → `mm:ss.ff`. */
export function formatTime(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  const totalSec = Math.floor(t / TICK_HZ);
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const ff = Math.floor(((t % TICK_HZ) * 100) / TICK_HZ);
  return `${pad2(m)}:${pad2(sec)}.${pad2(ff)}`;
}

function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight: 'normal' | 'bold' = 'normal',
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

function scrim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = withAlpha(C_BG, alpha);
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// ── 인게임 HUD ─────────────────────────────────────────────────────────────

export function drawHud(
  ctx: CanvasRenderingContext2D,
  s: Session,
  mic: MicView | null = null,
): void {
  ctx.textBaseline = 'alphabetic';

  // 상단/하단 밴드 — 월드와 HUD 를 시각적으로 분리한다.
  ctx.fillStyle = withAlpha(C_PANEL, 0.82);
  ctx.fillRect(0, 0, CANVAS_W, 50);
  ctx.fillRect(0, CANVAS_H - 40, CANVAS_W, 40);
  ctx.fillStyle = withAlpha(C_I_RING, 0.12);
  ctx.fillRect(0, 50, CANVAS_W, 1);
  ctx.fillRect(0, CANVAS_H - 41, CANVAS_W, 1);

  // ── 상단 좌: 스테이지 / par ──
  // 이어서 하는 모드(GAUNTLET/TIME_ATTACK)에서는 스테이지 번호가 곧 런 진행도다.
  const stageNo = s.stageIndex + 1;
  const runMode = s.playMode !== 'STORY';
  text(
    ctx,
    runMode
      ? `STAGE ${stageNo} / ${STAGES.length} — ${s.level.name.toUpperCase()}`
      : `STAGE ${stageNo} — ${s.level.name.toUpperCase()}`,
    PAD,
    22,
    13,
    C_TEXT,
    'left',
    'bold',
  );
  const used = s.ghosts.length;
  text(
    ctx,
    `PAR ${s.level.par}   AFTERIMAGES ${used}/${MAX_AFTERIMAGES}`,
    PAD,
    38,
    10,
    used > s.level.par ? C_DANGER : C_TEXT_DIM,
  );

  // ── 상단 중앙: 60초 게이지 + R ▸ COMMIT ──
  drawTimeGauge(ctx, s);

  // ── 상단 우: 슬롯 인디케이터 ──
  drawSlots(ctx, s);

  // ── 상단 중앙 아래: 지금의 목표 ──
  // 클리어 조건이 화면 어디에도 없으면 플레이어는 규칙이 아니라 우연을 배운다.
  drawObjective(ctx, s);

  // ── 하단 좌: OVERWRITE ──
  const owFull = s.overwriteLeft > 0;
  text(
    ctx,
    `OVERWRITE ${owFull ? '●' : '○'}`,
    PAD,
    CANVAS_H - 16,
    11,
    owFull ? C_ON : C_OFF,
    'left',
    'bold',
  );
  text(
    ctx,
    owFull ? 'Q ▸ REWRITE A SELF' : 'SPENT',
    PAD + 128,
    CANVAS_H - 16,
    9,
    C_TEXT_DIM,
  );

  // ── 하단 우: DEBT / ALERTS ──
  text(
    ctx,
    `ALERTS ${s.alerts}`,
    CANVAS_W - PAD - 132,
    CANVAS_H - 16,
    11,
    s.alerts > 0 ? C_LOOT : C_TEXT_DIM,
    'left',
    'bold',
  );
  text(
    ctx,
    `DEBT ${s.debt}`,
    CANVAS_W - PAD,
    CANVAS_H - 16,
    11,
    s.debt > 0 ? C_DANGER : C_TEXT_DIM,
    'right',
    'bold',
  );

  // ── LISTEN 배지 + 음량 미터 ──
  if (mic !== null) drawMicPanel(ctx, mic);

  // ── 주인공의 속말 ──
  // 상태 갱신과 그리기를 여기서 함께 한다. 세션은 읽기만 한다 (whisper.ts 참고).
  drawWhisper(ctx, updateWhisper(s));

  // ── 오버레이 ──
  if (s.awaitingOverwritePick) drawOverwritePicker(ctx, s);
  if (s.resetHold > 0) drawResetHold(ctx, s);
}

// ── 목표 / 속말 ────────────────────────────────────────────────────────────

/** 렌더 전용 프레임 카운터 (탈출구 강조 맥동). 시뮬 상태가 아니다. */
let objectiveClock = 0;

/**
 * `▸ 억제 코어를 손에 넣어라` → `▸ 탈출구로`.
 * 코어를 손에 넣는 순간 색이 초록으로 바뀌고 맥동하며, 탈출구 방향 화살표가 붙는다.
 */
function drawObjective(ctx: CanvasRenderingContext2D, s: Session): void {
  const obj = currentObjective(s);
  objectiveClock++;
  const col = obj.held ? C_ON : C_LOOT;
  const pulse = obj.held ? 0.6 + 0.4 * Math.abs(Math.sin(objectiveClock * 0.07)) : 1;

  const y = 68;
  ctx.font = font(12, 'bold');
  const boxW = ctx.measureText(obj.text).width + (obj.held ? 48 : 26);
  const x = Math.round((CANVAS_W - boxW) / 2);

  ctx.fillStyle = withAlpha(C_PANEL, 0.82);
  ctx.fillRect(x, y - 15, boxW, 23);
  ctx.strokeStyle = withAlpha(col, obj.held ? 0.3 + pulse * 0.5 : 0.4);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y - 14.5, boxW - 1, 22);
  text(ctx, obj.text, x + 13, y + 1, 12, withAlpha(col, obj.held ? 0.65 + pulse * 0.35 : 1), 'left', 'bold');

  if (obj.held) drawExitArrow(ctx, s, x + boxW - 21, y - 3, col, pulse);
}

/**
 * 탈출구가 어느 쪽인지 가리키는 작은 삼각형.
 * 월드 좌표가 아니라 **방향**만 쓰므로 카메라와 무관하다.
 */
function drawExitArrow(
  ctx: CanvasRenderingContext2D,
  s: Session,
  cx: number,
  cy: number,
  col: string,
  pulse: number,
): void {
  const live = s.sim.bodies.find((b) => b.isLive);
  if (live === undefined) return;
  const dx = s.sim.escape.x + s.sim.escape.w / 2 - (live.x + BODY_SUB / 2);
  const dy = s.sim.escape.y + s.sim.escape.h / 2 - (live.y + BODY_SUB / 2);
  if (dx === 0 && dy === 0) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.fillStyle = withAlpha(col, 0.55 + pulse * 0.45);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 속말 말풍선. 화면 하단 **좌측** 전용 자리에 둔다 — 조작 중인 몸 위에 띄우면
 * 정작 봐야 할 것을 가린다. 말꼬리가 있어야 자막이 아니라 생각으로 읽힌다.
 */
function drawWhisper(ctx: CanvasRenderingContext2D, w: WhisperView | null): void {
  if (w === null || w.alpha <= 0) return;

  const size = 12;
  ctx.font = `italic ${size}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const boxW = Math.round(ctx.measureText(w.text).width) + 26;
  const boxH = 26;
  const x = PAD + 0.5;
  const y = CANVAS_H - 54 - boxH + 0.5;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + boxW, y);
  ctx.lineTo(x + boxW, y + boxH);
  ctx.lineTo(x + 30, y + boxH);
  ctx.lineTo(x + 16, y + boxH + 9);
  ctx.lineTo(x + 14, y + boxH);
  ctx.lineTo(x, y + boxH);
  ctx.closePath();
  ctx.fillStyle = withAlpha(C_PANEL, 0.88 * w.alpha);
  ctx.fill();
  ctx.strokeStyle = withAlpha(C_I_RING, 0.2 * w.alpha);
  ctx.lineWidth = 1;
  ctx.stroke();

  // HUD 수치들보다 조용해야 한다 — 작고, 흐리고, 이탤릭.
  ctx.fillStyle = withAlpha(C_TEXT_DIM, 0.92 * w.alpha);
  ctx.fillText(w.text, x + 13, y + 17);
}

// ── LISTEN 모드 계기판 ─────────────────────────────────────────────────────

const METER_CELLS = 4;
const METER_CELL_W = 15;
const METER_CELL_H = 11;
const METER_GAP = 3;

/**
 * 렌더 전용 프레임 카운터(펄스 위상). 시뮬 상태가 아니다 — `Date.now()` 를 쓰면
 * 프레임레이트에 따라 위상이 달라지고, 시뮬 틱을 쓰면 TRANSITION 중에 멈춘다.
 */
let micPulseClock = 0;

/**
 * 4칸 음량 미터. 칸 경계(0.25 / 0.5 / 0.75)가 곧 레벨 1/2/3 임계라서,
 * "몇 칸이 찼는가"가 그대로 "지금 테이프에 녹화되는 값"이다.
 * 임계를 넘긴 동안(레벨 ≥ 1) 붉게 맥동한다 — 지금 내는 소리가 영구히 남는다는 경고.
 */
function drawMicPanel(ctx: CanvasRenderingContext2D, mic: MicView): void {
  const x = PAD;
  const y = 58;
  micPulseClock++;
  const over = mic.level > 0;
  const pulse = over ? 0.55 + 0.45 * Math.abs(Math.sin(micPulseClock * 0.16)) : 0;
  const accent = over ? C_DANGER : C_ON;

  const w = 284;
  const h = 24;
  ctx.fillStyle = withAlpha(C_PANEL, 0.72);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = withAlpha(accent, over ? 0.35 + pulse * 0.5 : 0.28);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  text(ctx, 'LISTEN', x + 8, y + 16, 10, accent, 'left', 'bold');

  let cx = x + 60;
  for (let i = 0; i < METER_CELLS; i++) {
    const fill = Math.max(0, Math.min(1, (mic.meter - i * 0.25) / 0.25));
    ctx.fillStyle = withAlpha(C_OFF, 0.45);
    ctx.fillRect(cx, y + 6, METER_CELL_W, METER_CELL_H);
    if (fill > 0) {
      // 첫 칸은 안전 구간(레벨 0)이라 초록, 나머지는 소음이 새어나가는 구간.
      const col = i === 0 ? C_ON : C_DANGER;
      ctx.fillStyle = withAlpha(col, i === 0 ? 0.85 : 0.55 + pulse * 0.45);
      ctx.fillRect(cx, y + 6, Math.round(METER_CELL_W * fill), METER_CELL_H);
    }
    ctx.strokeStyle = withAlpha(i === 0 ? C_ON : C_DANGER, 0.35);
    ctx.strokeRect(cx + 0.5, y + 6.5, METER_CELL_W - 1, METER_CELL_H - 1);
    cx += METER_CELL_W + METER_GAP;
  }

  text(ctx, `LV ${mic.level}`, cx + 10, y + 16, 9, over ? C_DANGER : C_TEXT_DIM, 'left', 'bold');
  text(
    ctx,
    `SENS ${mic.sensitivity}/${mic.sensitivitySteps}  − / =`,
    x + w - 9,
    y + 16,
    9,
    C_TEXT_DIM,
    'right',
  );
}

/**
 * 캘리브레이션 화면. 이 2초가 없으면 시끄러운 현장에서 절대 임계값에 걸려
 * 시작하자마자 레벨 3 으로 굳는다 — 그러면 플레이 자체가 불가능하다.
 */
export function drawCalibration(ctx: CanvasRenderingContext2D, mic: MicView): void {
  // 아래 화면(타이틀 로고 / 월드)이 비치면 글자가 겹쳐 읽히지 않는다. 완전히 덮는다.
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const waiting = mic.phase === 'REQUEST';

  const panelW = 560;
  const panelH = 200;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;
  ctx.fillStyle = C_PANEL;
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = withAlpha(waiting ? C_LOOT : C_I_RING, 0.6);
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, panelW - 2, panelH - 2);

  text(ctx, 'LISTEN MODE', CANVAS_W / 2, py + 30, 10, C_TEXT_DIM, 'center', 'bold');
  text(
    ctx,
    waiting ? '마이크 권한을 허용해 주세요' : '조용히 해주세요 — 환경음 측정 중',
    CANVAS_W / 2,
    py + 66,
    22,
    waiting ? C_LOOT : C_I_CORE,
    'center',
    'bold',
  );

  const w = panelW - 100;
  const h = 10;
  const x = (CANVAS_W - w) / 2;
  const y = py + 92;
  ctx.fillStyle = withAlpha(C_OFF, 0.55);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C_I_RING;
  ctx.fillRect(x, y, Math.round(w * mic.calibration), h);
  ctx.strokeStyle = withAlpha(C_I_RING, 0.4);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  text(
    ctx,
    waiting
      ? '브라우저의 마이크 요청을 허용하면 시작합니다.'
      : '지금 이 방의 소음을 바닥값으로 잡습니다.',
    CANVAS_W / 2,
    y + 32,
    11,
    C_TEXT,
    'center',
  );
  text(
    ctx,
    waiting
      ? '거부하거나 응답하지 않아도 EASY 모드로 계속 진행됩니다.'
      : '임계값은 이 바닥값 대비 상대치입니다 — 시끄러운 현장에서도 플레이할 수 있게.',
    CANVAS_W / 2,
    y + 50,
    10,
    C_TEXT_DIM,
    'center',
  );
  text(
    ctx,
    '오디오는 저장하지도 전송하지도 않습니다. 테이프에 남는 것은 틱당 2비트의 음량 레벨뿐입니다.',
    CANVAS_W / 2,
    y + 72,
    10,
    withAlpha(C_TEXT_DIM, 0.75),
    'center',
  );
}

function drawTimeGauge(ctx: CanvasRenderingContext2D, s: Session): void {
  const w = 300;
  const h = 8;
  const x = (CANVAS_W - w) / 2;
  const y = 16;
  const left = Math.max(0, MAX_TICKS - s.sim.tick);
  const frac = Math.max(0, Math.min(1, left / MAX_TICKS));

  ctx.fillStyle = withAlpha(C_OFF, 0.5);
  ctx.fillRect(x, y, w, h);

  // 마지막 10초는 붉게 — 60초는 상한일 뿐이지만, 소진은 곧 강제 확정이다.
  const urgent = left < TICK_HZ * 10;
  ctx.fillStyle = urgent ? C_DANGER : C_I_RING;
  ctx.fillRect(x, y, w * frac, h);
  ctx.strokeStyle = withAlpha(C_I_RING, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  text(ctx, formatTime(left), x - 10, y + h, 11, urgent ? C_DANGER : C_TEXT, 'right', 'bold');
  text(
    ctx,
    'R ▸ COMMIT',
    x + w + 10,
    y + h,
    11,
    C_I_RING,
    'left',
    'bold',
  );

  if (s.playMode === 'STORY') {
    text(ctx, `LOOP ${s.loopIndex + 1}`, CANVAS_W / 2, y + h + 15, 9, C_TEXT_DIM, 'center');
    return;
  }
  drawRunStrip(ctx, s, y + h + 15);
  // TIME ATTACK 의 성적은 이 숫자 하나다 — 게이지 위, 화면 맨 위 중앙에 상시 노출.
  if (s.playMode === 'TIME_ATTACK') drawTotalClock(ctx, s);
}

/**
 * 이어서 하는 모드의 상시 표시줄: `LOOP 2 · RUN 7/15 · GHOSTS 9 · DEBT 3`.
 * 조각마다 색이 달라 한 번에 그릴 수 없으므로 폭을 재서 직접 중앙 정렬한다.
 */
function drawRunStrip(ctx: CanvasRenderingContext2D, s: Session, y: number): void {
  const t = runTotals(s);
  const parts: [string, string][] = [
    [`LOOP ${s.loopIndex + 1}`, C_TEXT_DIM],
    [`RUN ${s.stageIndex + 1}/${STAGES.length}`, C_I_RING],
    [`GHOSTS ${t.afterimages}`, C_TEXT_DIM],
    // 누적 부채 — 런 전체를 관통하는 값이라 0 이 아니면 항상 붉다.
    [`DEBT ${t.debt}`, t.debt > 0 ? C_DANGER : C_TEXT_DIM],
  ];

  const SEP = '   ·   ';
  ctx.font = font(9, 'bold');
  const sepW = ctx.measureText(SEP).width;
  let total = sepW * (parts.length - 1);
  for (const p of parts) total += ctx.measureText(p[0]).width;

  let x = (CANVAS_W - total) / 2;
  parts.forEach((p, i) => {
    text(ctx, p[0], x, y, 9, p[1], 'left', 'bold');
    x += ctx.measureText(p[0]).width;
    if (i < parts.length - 1) {
      text(ctx, SEP, x, y, 9, withAlpha(C_TEXT_DIM, 0.5), 'left', 'bold');
      x += sepW;
    }
  });
}

/** 런 누적 시계. 루프를 넘고 스테이지를 넘어도 계속 올라간다. */
function drawTotalClock(ctx: CanvasRenderingContext2D, s: Session): void {
  const label = formatTime(runTotals(s).ticks);
  ctx.font = font(13, 'bold');
  const w = ctx.measureText(label).width;
  text(ctx, 'TOTAL', CANVAS_W / 2 - w / 2 - 8, 12, 9, C_TEXT_DIM, 'right', 'bold');
  text(ctx, label, CANVAS_W / 2, 12, 13, C_LOOT, 'center', 'bold');
}

function drawSlots(ctx: CanvasRenderingContext2D, s: Session): void {
  const boxW = 40;
  const boxH = 22;
  const gap = 4;
  const total = SLOT_NAMES.length * boxW + (SLOT_NAMES.length - 1) * gap;
  let x = CANVAS_W - PAD - total;
  const y = 14;

  for (let i = 0; i < SLOT_NAMES.length; i++) {
    const name = SLOT_NAMES[i] ?? '?';
    const ghost = i === 0 ? undefined : s.ghosts[i - 1];
    const filled = i === 0 || ghost !== undefined;
    const corpse = ghost !== undefined && ghost.corpse;
    const col = C_SLOT[i] ?? C_I_CORE;
    const a = A_SLOT[i] ?? 1;

    ctx.fillStyle = filled ? withAlpha(col, 0.2 + a * 0.2) : withAlpha(C_OFF, 0.2);
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = filled ? withAlpha(col, 0.95) : withAlpha(C_OFF, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

    const label = corpse ? `${name}✕` : name;
    text(
      ctx,
      label,
      x + boxW / 2,
      y + 15,
      9,
      corpse ? C_CORPSE : filled ? col : C_OFF,
      'center',
      'bold',
    );
    x += boxW + gap;
  }

  const left = MAX_AFTERIMAGES - s.ghosts.length;
  text(
    ctx,
    left > 0 ? `${left} SELVES LEFT` : 'NO ONE LEFT TO BECOME.',
    CANVAS_W - PAD,
    y + boxH + 12,
    9,
    left > 0 ? C_TEXT_DIM : C_DANGER,
    'right',
    left > 0 ? 'normal' : 'bold',
  );
}

function drawOverwritePicker(ctx: CanvasRenderingContext2D, s: Session): void {
  const h = 96;
  const y = (CANVAS_H - h) / 2;
  ctx.fillStyle = withAlpha(C_BG, 0.78);
  ctx.fillRect(0, y, CANVAS_W, h);
  ctx.fillStyle = withAlpha(C_LOOT, 0.5);
  ctx.fillRect(0, y, CANVAS_W, 1);
  ctx.fillRect(0, y + h - 1, CANVAS_W, 1);

  text(
    ctx,
    'PICK A SELF TO REWRITE — 1 / 2 / 3',
    CANVAS_W / 2,
    y + 30,
    16,
    C_LOOT,
    'center',
    'bold',
  );

  // 실제로 존재하는 잔상만 고를 수 있다는 걸 칩으로 보여준다.
  const chipW = 96;
  const gap = 12;
  const total = MAX_AFTERIMAGES * chipW + (MAX_AFTERIMAGES - 1) * gap;
  let x = (CANVAS_W - total) / 2;
  for (let i = 0; i < MAX_AFTERIMAGES; i++) {
    const ghost = s.ghosts[i];
    const has = ghost !== undefined;
    const col = C_SLOT[i + 1] ?? C_I_CORE;
    ctx.fillStyle = has ? withAlpha(col, 0.22) : withAlpha(C_OFF, 0.15);
    ctx.fillRect(x, y + 44, chipW, 30);
    ctx.strokeStyle = has ? col : withAlpha(C_OFF, 0.7);
    ctx.lineWidth = has ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 44.5, chipW - 1, 29);
    const nm = SLOT_NAMES[i + 1] ?? '?';
    text(
      ctx,
      `${i + 1} ▸ ${nm}${ghost !== undefined && ghost.corpse ? ' ✕' : ''}`,
      x + chipW / 2,
      y + 64,
      11,
      has ? col : C_OFF,
      'center',
      'bold',
    );
    x += chipW + gap;
  }

  text(ctx, 'Q ▸ CANCEL', CANVAS_W / 2, y + h - 8, 9, C_TEXT_DIM, 'center');
}

function drawResetHold(ctx: CanvasRenderingContext2D, s: Session): void {
  const frac = Math.max(0, Math.min(1, s.resetHold / RESET_HOLD_TICKS));
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H - 96;
  const r = 26;

  ctx.fillStyle = withAlpha(C_BG, 0.7);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = withAlpha(C_OFF, 0.8);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = C_DANGER;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();

  text(ctx, `${Math.round(frac * 100)}%`, cx, cy + 4, 12, C_DANGER, 'center', 'bold');
  text(ctx, 'HOLD ▸ FULL RESET   (DEBT +1)', cx, cy + r + 22, 10, C_DANGER, 'center', 'bold');
}

// ── 타이틀 ─────────────────────────────────────────────────────────────────

/**
 * 타이틀이 보여줘야 하는 것 전부. 두 축은 **각각 한 줄**을 차지한다:
 * 위가 플레이 방식(STORY / GAUNTLET / TIME ATTACK), 아래가 감지 방식(EASY / LISTEN).
 * `focusRow` 는 지금 ← → 가 조작하는 줄이다 (0 = 위, 1 = 아래).
 */
export interface TitleView {
  mode: Mode;
  playMode: PlayMode;
  focusRow: 0 | 1;
  notice: string | null;
}

/**
 * 타이틀의 세로 리듬. 각 줄은 칩(28) → 칩별 캡션(+12) → 설명 한 줄(+30) 을 쓴다.
 * 그 아래 조작 안내(432) · PLAY(444) · 인트로(496) · 키 목록(524~) 순으로 내려간다.
 */
const ROW1_Y = 288;
const ROW2_Y = 356;
const CHIP_H = 28;

/**
 * 제목이 곧 메커니즘이다: 네 개의 격(I / MY / ME / MINE)이 네 개의 몸이고,
 * 로고에 겹친 오프셋 고스트 텍스트가 곧 잔상이다.
 */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  t: number,
  view: TitleView,
): void {
  const { mode, playMode, focusRow, notice } = view;
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 배경 격자 — 게임 화면과 같은 세계임을 암시.
  ctx.strokeStyle = withAlpha(C_I_RING, 0.05);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= CANVAS_W; x += 32) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, CANVAS_H);
  }
  for (let y = 0; y <= CANVAS_H; y += 32) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(CANVAS_W, y + 0.5);
  }
  ctx.stroke();

  const size = 58;
  const baseY = 205;
  const parts = ['I', 'MY', 'ME', 'MINE'];

  ctx.font = font(size, 'bold');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 각 격의 폭을 먼저 재서 전체를 중앙 정렬한다.
  const dotW = ctx.measureText('.').width;
  const widths = parts.map((p) => ctx.measureText(p).width);
  const totalW =
    widths.reduce((a, b) => a + b, 0) + dotW * (parts.length - 1);
  const startX = (CANVAS_W - totalW) / 2;

  // 잔상 레이어: 뒤로 갈수록 옅고 멀리. 오른쪽에서 왼쪽으로 흘러 들어온다.
  for (let g = 3; g >= 1; g--) {
    const off = g * 7 + Math.sin(t * 0.02 + g) * 2;
    let x = startX;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] ?? '';
      const col = C_SLOT[g] ?? C_I_CORE;
      ctx.fillStyle = withAlpha(col, 0.22 / g + 0.06);
      ctx.fillText(p, x + off, baseY);
      x += (widths[i] ?? 0) + dotW;
    }
  }

  // 본체: 격은 흰색, 점은 슬롯 색 — 네 개로 쪼개져 있다는 사실을 점이 말한다.
  let x = startX;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? '';
    ctx.fillStyle = C_I_CORE;
    ctx.fillText(p, x, baseY);
    x += widths[i] ?? 0;
    if (i < parts.length - 1) {
      ctx.fillStyle = C_SLOT[i + 1] ?? C_I_RING;
      ctx.fillText('.', x, baseY);
      x += dotW;
    }
  }

  // 격 아래 작은 라벨 — I 는 지금의 나, 나머지는 잔상.
  {
    let lx = startX;
    const labels = ['NOW', 'LOOP 2', 'LOOP 3', 'LOOP 4'];
    for (let i = 0; i < parts.length; i++) {
      const w = widths[i] ?? 0;
      ctx.font = font(9, 'bold');
      ctx.textAlign = 'center';
      ctx.fillStyle = withAlpha(C_SLOT[i] ?? C_I_CORE, i === 0 ? 0.9 : 0.55);
      ctx.fillText(labels[i] ?? '', lx + w / 2, baseY + 22);
      lx += w + dotW;
    }
  }

  text(ctx, 'Fail now. Escape later.', CANVAS_W / 2, baseY + 48, 18, C_I_RING, 'center', 'bold');
  text(
    ctx,
    '실패할 때마다 과거의 내가 동료가 되는 60초 타임루프 탈출극',
    CANVAS_W / 2,
    baseY + 68,
    11,
    C_TEXT_DIM,
    'center',
  );

  // ── 두 축 — 위 줄: 플레이 방식 / 아래 줄: 감지 방식 ──
  // ↑ ↓ 로 줄을 옮기고 ← → (또는 숫자)로 그 줄의 항목을 고른다.
  drawPlayModeRow(ctx, playMode, mode, focusRow === 0, t);
  drawDetectRow(ctx, mode, focusRow === 1);
  text(
    ctx,
    '↑ ↓ 줄 이동    ← → 선택    ENTER 시작',
    CANVAS_W / 2,
    432,
    9,
    withAlpha(C_TEXT_DIM, 0.8),
    'center',
    'bold',
  );

  // [ PLAY ] — 맥동하는 CTA. 메뉴는 없다(SPEC §8).
  const pulse = 0.65 + Math.sin(t * 0.06) * 0.35;
  const btnW = 220;
  const btnH = 36;
  const bx = (CANVAS_W - btnW) / 2;
  const by = 444;
  ctx.fillStyle = withAlpha(C_I_RING, 0.1 + pulse * 0.12);
  ctx.fillRect(bx, by, btnW, btnH);
  ctx.strokeStyle = withAlpha(C_I_RING, 0.5 + pulse * 0.5);
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 1, by + 1, btnW - 2, btnH - 2);
  text(ctx, '[ PLAY ] — ENTER', CANVAS_W / 2, by + 24, 15, C_I_CORE, 'center', 'bold');

  // 인트로 재시청. main.ts 가 `S` keydown 을 받아 인트로로 되돌린다.
  // 플레이 방식 `STORY` 와 헷갈리지 않게 이름을 분리했다.
  text(ctx, 'S ▸ 인트로 다시보기', CANVAS_W / 2, 496, 11, C_TEXT_DIM, 'center', 'bold');

  // 마이크 폴백 같은 사건은 조용히 삼키지 않고 여기 한 줄로 남긴다.
  if (notice !== null) {
    text(ctx, notice, CANVAS_W / 2, 510, 10, C_DANGER, 'center', 'bold');
  }

  // 조작키 요약
  const keys: [string, string][] = [
    ['WASD / ARROWS', '이동'],
    ['SHIFT', '달리기 (소음 발생)'],
    ['E', '상호작용'],
    ['R', '루프 조기 확정 → 잔상'],
    ['Q → 1/2/3', '잔상 덮어쓰기 (1회)'],
    ['BACKSPACE (2초)', '전체 초기화 (DEBT +1)'],
    ['ESC / M', '일시정지 / 뮤트'],
    ['− / =', '마이크 감도 (LISTEN)'],
  ];
  const colX = [CANVAS_W / 2 - 250, CANVAS_W / 2 + 20];
  keys.forEach((entry, i) => {
    const cx = colX[i < 4 ? 0 : 1] ?? 0;
    const ry = CANVAS_H - 76 + (i % 4) * 17;
    text(ctx, entry[0], cx, ry, 10, C_I_RING, 'left', 'bold');
    text(ctx, entry[1], cx + 140, ry, 10, C_TEXT_DIM, 'left');
  });
}

/** 포커스된 줄임을 알리는 왼쪽 삼각형. 어느 줄을 ← → 가 조작하는지가 한눈에 보여야 한다. */
function drawRowCaret(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const pulse = 0.6 + Math.sin(t * 0.08) * 0.4;
  ctx.save();
  ctx.fillStyle = withAlpha(C_I_CORE, 0.55 + pulse * 0.45);
  ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  col: string,
  on: boolean,
  focused: boolean,
): void {
  // 고르지 않은 줄은 통째로 흐려진다 — 지금 조작 중인 줄이 어디인지가 먼저 읽혀야 한다.
  const dim = focused ? 1 : 0.5;
  ctx.fillStyle = on ? withAlpha(col, 0.18 * dim) : withAlpha(C_OFF, 0.12 * dim);
  ctx.fillRect(x, y, w, CHIP_H);
  ctx.strokeStyle = on ? withAlpha(col, dim) : withAlpha(C_OFF, 0.7 * dim);
  ctx.lineWidth = on ? 2 : 1;
  ctx.strokeRect(x + 1, y + 1, w - 2, CHIP_H - 2);
  text(
    ctx,
    label,
    x + w / 2,
    y + 19,
    13,
    on ? withAlpha(col, dim) : withAlpha(C_OFF, dim),
    'center',
    'bold',
  );
}

/**
 * 위 줄 — 플레이 방식. 칩마다 짧은 캡션이 붙고, 고른 것의 한 줄 설명과
 * 그 모드의 최고 기록이 아래에 붙는다.
 */
function drawPlayModeRow(
  ctx: CanvasRenderingContext2D,
  playMode: PlayMode,
  mode: Mode,
  focused: boolean,
  t: number,
): void {
  const chipW = 176;
  const gap = 12;
  const list: PlayMode[] = ['STORY', 'GAUNTLET', 'TIME_ATTACK'];
  const total = chipW * list.length + gap * (list.length - 1);
  const startX = (CANVAS_W - total) / 2;

  if (focused) drawRowCaret(ctx, startX - 22, ROW1_Y + CHIP_H / 2, t);

  list.forEach((pm, i) => {
    const x = startX + i * (chipW + gap);
    const on = playMode === pm;
    const col = pm === 'STORY' ? C_I_RING : pm === 'GAUNTLET' ? C_DANGER : C_LOOT;
    drawChip(ctx, x, ROW1_Y, chipW, PLAY_MODE_LABEL[pm], col, on, focused);
    text(
      ctx,
      `${i + 1} ▸ ${PLAY_MODE_CAPTION[pm]}`,
      x + chipW / 2,
      ROW1_Y + CHIP_H + 12,
      9,
      withAlpha(on ? col : C_TEXT_DIM, focused ? 0.9 : 0.45),
      'center',
      on ? 'bold' : 'normal',
    );
  });

  const line = PLAY_MODE_LINE[playMode];
  const best = playMode === 'STORY' ? null : titleBest(playMode, mode, t);
  text(
    ctx,
    best === null ? line : `${line}     BEST ${bestLabel(playMode, best)}`,
    CANVAS_W / 2,
    ROW1_Y + CHIP_H + 30,
    10,
    playMode === 'STORY' ? C_TEXT_DIM : C_TEXT,
    'center',
    playMode === 'STORY' ? 'normal' : 'bold',
  );
}

/** 아래 줄 — 감지 방식. 플레이 방식과 자유롭게 조합된다. */
function drawDetectRow(
  ctx: CanvasRenderingContext2D,
  mode: Mode,
  focused: boolean,
): void {
  const chipW = 200;
  const gap = 16;
  const list: Mode[] = ['EASY', 'LISTEN'];
  const total = chipW * list.length + gap;
  const startX = (CANVAS_W - total) / 2;

  if (focused) drawRowCaret(ctx, startX - 22, ROW2_Y + CHIP_H / 2, 0);

  list.forEach((m, i) => {
    const x = startX + i * (chipW + gap);
    const col = m === 'LISTEN' ? C_DANGER : C_I_RING;
    drawChip(ctx, x, ROW2_Y, chipW, `[ ${m} ]`, col, mode === m, focused);
    text(
      ctx,
      `${i + 1} ▸ ${m === 'LISTEN' ? '마이크 사용' : '키보드만'}`,
      x + chipW / 2,
      ROW2_Y + CHIP_H + 12,
      9,
      withAlpha(mode === m ? col : C_TEXT_DIM, focused ? 0.9 : 0.45),
      'center',
      mode === m ? 'bold' : 'normal',
    );
  });

  text(
    ctx,
    mode === 'LISTEN'
      ? '마이크를 씁니다. 숨소리도 들립니다 — 시끄러우면 간수가 옵니다'
      : '마이크를 쓰지 않습니다. 키보드만으로 플레이합니다',
    CANVAS_W / 2,
    ROW2_Y + CHIP_H + 30,
    10,
    mode === 'LISTEN' ? C_DANGER : C_TEXT_DIM,
    'center',
    mode === 'LISTEN' ? 'bold' : 'normal',
  );
}

// ── 최고 기록 캐시 ─────────────────────────────────────────────────────────
// 타이틀은 60fps 로 다시 그려진다. localStorage 를 프레임마다 읽을 이유는 없으므로
// (모드, 감지) 조합당 1초에 한 번만 읽는다 — 런이 끝나고 돌아와도 곧 갱신된다.

let bestKeyCache = '';
let bestCache: BestRecord | null = null;
let bestReadAt = -1e9;

function titleBest(playMode: PlayMode, mode: Mode, t: number): BestRecord | null {
  const key = `${playMode}|${mode}`;
  // 타이틀로 돌아오면 시계가 0 으로 되감긴다. 차이의 **절대값**을 봐야 방금 끝낸
  // 런의 기록이 즉시 반영된다 (t - bestReadAt 만 보면 영원히 옛 값을 돌려준다).
  if (key !== bestKeyCache || Math.abs(t - bestReadAt) > TICK_HZ) {
    bestKeyCache = key;
    bestReadAt = t;
    bestCache = loadBest(playMode, mode);
  }
  return bestCache;
}

/** 기록 한 줄. 모드마다 자랑하는 숫자가 다르다. */
function bestLabel(playMode: PlayMode, best: BestRecord): string {
  return playMode === 'TIME_ATTACK'
    ? formatTime(best.ticks)
    : `DEBT ${best.debt} · 잔상 ${best.afterimages}`;
}

// ── 루프 전환 ──────────────────────────────────────────────────────────────

export function drawTransition(
  ctx: CanvasRenderingContext2D,
  s: Session,
): void {
  // 전환은 1.5초. 들어올 때 빠르게 어두워지고 나갈 때 빠르게 걷힌다.
  const elapsed = LOOP_TRANSITION_TICKS - s.transitionTimer;
  const inA = Math.min(1, elapsed / 12);
  const outA = Math.min(1, s.transitionTimer / 12);
  const a = Math.min(inA, outA);
  scrim(ctx, 0.86 * a);

  const lines: string[] = s.transitionMsg;
  const startY = CANVAS_H / 2 - (lines.length - 1) * 20;
  lines.forEach((line: string, i: number) => {
    // 첫 줄은 사건(CAPTURED. / TIME'S UP. …), 마지막 줄은 새 정체성.
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    const size = isFirst ? 30 : isLast ? 18 : 14;
    const col = isFirst ? C_DANGER : isLast ? C_I_RING : C_TEXT;
    text(ctx, line, CANVAS_W / 2, startY + i * 40, size, withAlpha(col, a), 'center', 'bold');
  });
}

// ── 클리어 ─────────────────────────────────────────────────────────────────

export function drawClear(ctx: CanvasRenderingContext2D, s: Session): void {
  const all = s.phase === 'ALLCLEAR';
  // 이어서 하는 모드의 마지막 스테이지 = 런의 끝. 성적표가 다르다.
  if (all && s.playMode !== 'STORY' && s.runResult !== null) {
    drawRunResult(ctx, s.runResult);
    return;
  }
  scrim(ctx, 0.9);

  const panelW = 460;
  const panelH = all ? 330 : 300;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;
  ctx.fillStyle = withAlpha(C_PANEL, 0.95);
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = withAlpha(C_ON, 0.7);
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, panelW - 2, panelH - 2);

  text(
    ctx,
    all ? 'ALL ESCAPED' : 'ESCAPED',
    CANVAS_W / 2,
    py + 48,
    all ? 26 : 30,
    C_ON,
    'center',
    'bold',
  );
  const runMode = s.playMode !== 'STORY';
  text(
    ctx,
    runMode
      ? `STAGE ${s.stageIndex + 1} / ${STAGES.length} — ${s.level.name.toUpperCase()}`
      : `STAGE ${s.stageIndex + 1} — ${s.level.name.toUpperCase()}`,
    CANVAS_W / 2,
    py + 70,
    10,
    C_TEXT_DIM,
    'center',
  );

  const used = s.ghosts.length;
  const totals = runTotals(s);
  const rows: [string, string, string][] = [
    ['LOOPS', String(used + 1), C_TEXT],
    ['AFTERIMAGES', `${used} / PAR ${s.level.par}`, used <= s.level.par ? C_ON : C_TEXT],
    ['TIME', formatTime(s.elapsedTicks), C_TEXT],
    ['ALERTS', String(s.alerts), s.alerts > 0 ? C_LOOT : C_TEXT],
    ['DEBT', String(s.debt), s.debt > 0 ? C_DANGER : C_TEXT],
  ];
  // 이어서 하는 모드에서는 이 스테이지의 성적보다 런 누적치가 더 중요하다.
  if (runMode) {
    rows.splice(3, 0, [
      s.playMode === 'TIME_ATTACK' ? 'RUN TIME' : 'RUN GHOSTS',
      s.playMode === 'TIME_ATTACK'
        ? formatTime(totals.ticks)
        : String(totals.afterimages),
      C_LOOT,
    ]);
  }
  rows.forEach((r, i) => {
    const ry = py + 106 + i * 26;
    text(ctx, r[0], px + 40, ry, 12, C_TEXT_DIM, 'left');
    text(ctx, r[1], px + panelW - 40, ry, 13, r[2], 'right', 'bold');
  });

  const medalY = py + 250;
  if (s.medal) {
    ctx.fillStyle = withAlpha(C_LOOT, 0.14);
    ctx.fillRect(px + 30, medalY - 20, panelW - 60, 30);
    text(ctx, 'MINIMUM AFTERIMAGE ★', CANVAS_W / 2, medalY, 15, C_LOOT, 'center', 'bold');
  } else {
    text(
      ctx,
      `PAR ${s.level.par} 이하의 나로 다시 빠져나가 보라`,
      CANVAS_W / 2,
      medalY,
      11,
      C_TEXT_DIM,
      'center',
    );
  }

  text(
    ctx,
    all ? 'ENTER ▸ TITLE' : runMode ? 'ENTER ▸ 다음 스테이지로 계속' : 'ENTER ▸ NEXT',
    CANVAS_W / 2,
    py + panelH - 24,
    14,
    C_I_RING,
    'center',
    'bold',
  );
}

// ── 런 결과 (GAUNTLET / TIME ATTACK) ───────────────────────────────────────

/**
 * 런 성적표. 모드마다 자랑하는 숫자가 다르다 —
 * GAUNTLET 은 **끝까지 따라온 부채**, TIME ATTACK 은 **총 시간**.
 * 아래에는 스테이지별 스플릿을 두 열로 깐다.
 */
function drawRunResult(ctx: CanvasRenderingContext2D, r: RunResult): void {
  scrim(ctx, 0.92);

  const timed = r.playMode === 'TIME_ATTACK';
  const panelW = 700;
  const panelH = 452;
  const px = (CANVAS_W - panelW) / 2;
  const py = (CANVAS_H - panelH) / 2;

  ctx.fillStyle = withAlpha(C_PANEL, 0.96);
  ctx.fillRect(px, py, panelW, panelH);
  ctx.strokeStyle = withAlpha(timed ? C_LOOT : C_DANGER, 0.75);
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, panelW - 2, panelH - 2);

  text(ctx, 'RUN COMPLETE', CANVAS_W / 2, py + 40, 24, C_ON, 'center', 'bold');
  text(
    ctx,
    `${PLAY_MODE_LABEL[r.playMode]}  ·  ${r.mode}  ·  ${r.totals.stages} / ${STAGES.length} STAGES`,
    CANVAS_W / 2,
    py + 60,
    10,
    C_TEXT_DIM,
    'center',
  );

  // ── 히어로 숫자 ──
  const heroCol = timed ? C_LOOT : C_DANGER;
  text(ctx, timed ? 'TOTAL TIME' : 'TOTAL DEBT', CANVAS_W / 2, py + 92, 10, C_TEXT_DIM, 'center', 'bold');
  text(
    ctx,
    timed ? formatTime(r.totals.ticks) : String(r.totals.debt),
    CANVAS_W / 2,
    py + 134,
    38,
    heroCol,
    'center',
    'bold',
  );
  text(
    ctx,
    timed ? '모든 루프의 시간이 합산된 기록' : '한 런을 관통한, 지울 수 없는 부채',
    CANVAS_W / 2,
    py + 154,
    10,
    withAlpha(C_TEXT_DIM, 0.9),
    'center',
  );

  // ── NEW BEST / 이전 기록 ──
  if (r.newBest) {
    const bw = 260;
    ctx.fillStyle = withAlpha(C_LOOT, 0.16);
    ctx.fillRect(CANVAS_W / 2 - bw / 2, py + 166, bw, 26);
    ctx.strokeStyle = withAlpha(C_LOOT, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(CANVAS_W / 2 - bw / 2 + 0.5, py + 166.5, bw - 1, 25);
    text(ctx, 'NEW BEST ★', CANVAS_W / 2, py + 184, 14, C_LOOT, 'center', 'bold');
    if (!r.saved) {
      // 저장이 막힌 환경(프라이빗 모드 등)이라는 사실을 숨기지 않는다.
      text(ctx, '기록을 저장하지 못했습니다 (브라우저 저장소 차단)', CANVAS_W / 2, py + 204, 9, C_TEXT_DIM, 'center');
    }
  } else if (r.previousBest !== null) {
    text(
      ctx,
      `BEST ${bestLabel(r.playMode, r.previousBest)}`,
      CANVAS_W / 2,
      py + 184,
      12,
      C_TEXT_DIM,
      'center',
      'bold',
    );
  }

  // ── 누적 스탯 ──
  const stats: [string, string, string][] = [
    ['STAGES', `${r.totals.stages}`, C_TEXT],
    ['AFTERIMAGES', `${r.totals.afterimages}`, C_TEXT],
    [timed ? 'DEBT' : 'TIME', timed ? `${r.totals.debt}` : formatTime(r.totals.ticks),
      timed && r.totals.debt > 0 ? C_DANGER : C_TEXT],
    ['ALERTS', `${r.totals.alerts}`, r.totals.alerts > 0 ? C_LOOT : C_TEXT],
    ['MEDALS', `${r.totals.medals} ★`, r.totals.medals > 0 ? C_LOOT : C_TEXT],
  ];
  const statW = (panelW - 80) / stats.length;
  stats.forEach((st, i) => {
    const cx = px + 40 + statW * i + statW / 2;
    text(ctx, st[0], cx, py + 226, 9, C_TEXT_DIM, 'center');
    text(ctx, st[1], cx, py + 246, 15, st[2], 'center', 'bold');
  });

  drawSplits(ctx, r.splits, px + 40, py + 274, panelW - 80, timed);

  text(ctx, 'ENTER ▸ TITLE', CANVAS_W / 2, py + panelH - 20, 14, C_I_RING, 'center', 'bold');
}

/** 스테이지별 스플릿. 15개까지 두 열로 나눠 담는다. */
function drawSplits(
  ctx: CanvasRenderingContext2D,
  splits: readonly StageSplit[],
  x: number,
  y: number,
  w: number,
  timed: boolean,
): void {
  ctx.fillStyle = withAlpha(C_I_RING, 0.14);
  ctx.fillRect(x, y - 14, w, 1);
  text(ctx, timed ? 'SPLITS' : 'STAGES', x, y - 2, 9, C_TEXT_DIM, 'left', 'bold');

  if (splits.length === 0) return;

  const gap = 24;
  const colW = (w - gap) / 2;
  const perCol = Math.ceil(splits.length / 2);
  const rowH = 17;

  splits.forEach((sp, i) => {
    const col = i < perCol ? 0 : 1;
    const row = i - col * perCol;
    const cx = x + col * (colW + gap);
    const cy = y + 14 + row * rowH;
    const name = sp.name.length > 15 ? `${sp.name.slice(0, 14)}…` : sp.name;
    text(
      ctx,
      `${pad2(sp.stageIndex + 1)} ${sp.medal ? '★' : ' '} ${name}`,
      cx,
      cy,
      9,
      sp.medal ? C_LOOT : C_TEXT_DIM,
      'left',
    );
    text(
      ctx,
      timed ? formatTime(sp.ticks) : `잔상 ${sp.afterimages}`,
      cx + colW,
      cy,
      9,
      C_TEXT,
      'right',
      'bold',
    );
  });
}

// ── 일시정지 ───────────────────────────────────────────────────────────────

export function drawPause(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.82);
  text(ctx, 'PAUSED', CANVAS_W / 2, 150, 34, C_I_CORE, 'center', 'bold');
  text(ctx, 'ESC ▸ RESUME', CANVAS_W / 2, 176, 11, C_TEXT_DIM, 'center');

  const rows: [string, string][] = [
    ['WASD / ARROWS', '이동'],
    ['SHIFT', '달리기 — 12틱마다 소음, WARDEN 이 조사하러 온다'],
    ['E', '버튼 / 레버 상호작용'],
    ['R', '루프 조기 확정 → 지금까지의 나를 잔상으로 남긴다'],
    ['Q → 1/2/3', '잔상 하나를 지우고 재녹화 (스테이지당 1회)'],
    ['BACKSPACE 2초', '스테이지 전체 초기화 — DEBT +1, 절대 안 지워진다'],
    ['M', '뮤트'],
    ['− / =', 'LISTEN 모드 마이크 감도 — 현장이 시끄러우면 낮춰라'],
  ];
  rows.forEach((r, i) => {
    const y = 224 + i * 24;
    text(ctx, r[0], CANVAS_W / 2 - 250, y, 12, C_I_RING, 'left', 'bold');
    text(ctx, r[1], CANVAS_W / 2 - 80, y, 11, C_TEXT_DIM, 'left');
  });

  text(
    ctx,
    '잔상은 궤적이 아니라 입력 테이프다. 매 루프 세계는 틱 0으로 되감기고, 과거의 나는 같은 키를 다시 누른다.',
    CANVAS_W / 2,
    CANVAS_H - 46,
    10,
    C_TEXT_DIM,
    'center',
  );
}
