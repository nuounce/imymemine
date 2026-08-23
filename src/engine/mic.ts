/**
 * LISTEN 모드 — 실제 마이크 레이어.
 *
 * **이 파일은 시뮬레이션 밖이다.** `src/sim/` 은 마이크의 존재를 모르고, 앞으로도
 * 몰라야 한다(헤드리스 테스트가 거기 걸려 있다). 여기서 하는 일은 딱 하나:
 * 지금 이 순간의 주변 음량을 **0~3 정수**로 양자화해 주는 것.
 *
 * 그 정수를 입력 마스크의 비트 6~7 에 실어 **테이프에 녹화**하는 건 `main.ts` 이고,
 * 잔상은 실시간 마이크가 아니라 그 녹화된 비트를 재생한다. 그래서 마이크를 켜도
 * 잔상 재생 오차는 여전히 정확히 0 이다. 대신 이런 일이 벌어진다 —
 * **과거의 나의 숨소리가 지금의 나를 배신한다.** 3루프에서 낸 기침은 영원히
 * 그 자리에 남아 매 루프 같은 순간에 경비를 부른다.
 *
 * ── 개인정보 ──────────────────────────────────────────────────────────────
 * 오디오를 저장하지도 전송하지도 않는다. 네트워크 호출 0.
 * AnalyserNode 에서 읽은 RMS 는 그 자리에서 0~3 정수가 되고 즉시 버려진다.
 * 녹음 버퍼도, 파일도, 서버도 없다. 테이프에 남는 것은 **틱당 2비트**뿐이다.
 * 마이크 스트림은 모드를 빠져나갈 때 `stop()` 으로 반드시 반납한다(표시등 소등).
 *
 * ── 캘리브레이션 ──────────────────────────────────────────────────────────
 * 해커톤 현장은 시끄럽다. 절대 임계값을 쓰면 시작하자마자 레벨 3 으로 굳어
 * 플레이가 불가능해진다. 그래서 시작 시 2초간 환경음을 재고, 모든 임계값을
 * 그 **바닥값 대비 상대치**로 잡는다.
 */

// ── 튜닝 상수 ──────────────────────────────────────────────────────────────

/** 환경음 측정 시간. 60Hz 틱 기준 2초. */
export const CALIBRATION_TICKS = 120;
/** 권한 응답이 없을 때 포기하는 시간(30초). 무한 대기로 게임이 얼면 안 된다. */
const REQUEST_TIMEOUT_TICKS = 1800;

const FFT_SIZE = 1024;

/** 어택은 빠르게(기침을 놓치지 않게), 릴리즈는 느리게(딸깍임 방지). */
const ATTACK = 0.55;
const RELEASE = 0.06;
/** 레벨이 오르면 최소 이만큼 유지한다 — 미터와 소음이 떨리지 않게. */
const LEVEL_HOLD_TICKS = 8;

/** 감도 단계. 값이 작을수록 임계가 낮아져 **예민**해진다. */
const SENS_SCALE: readonly number[] = [2.2, 1.7, 1.3, 1.0, 0.76, 0.56, 0.4];
export const SENS_STEPS = SENS_SCALE.length;
const SENS_DEFAULT = 4; // 1-based

/** 임계 = 바닥값 + unit × 이 배수. 레벨 1 / 2 / 3 순. */
const STEP: readonly number[] = [1.0, 2.4, 4.6];
/** unit 의 하한들 — 바닥이 0 에 가까운 방음실에서도 임계가 0 이 되지 않게. */
const UNIT_FLOOR_RATIO = 0.7;
const UNIT_MIN = 0.0035;

// ── 공개 타입 ──────────────────────────────────────────────────────────────

export type MicPhase =
  | 'IDLE' // 꺼져 있음
  | 'REQUEST' // 권한 요청 중
  | 'CALIBRATING' // 환경음 측정 중
  | 'READY' // 정상 동작
  | 'FAILED'; // 권한 거부 / 미지원 / 장치 오류 → 호출부가 EASY 로 폴백한다

/** HUD 가 읽는 스냅샷. 렌더 레이어가 Mic 구현에 직접 묶이지 않게 한다. */
export interface MicView {
  phase: MicPhase;
  /** 미터 표시용 0..1. 0.25 / 0.5 / 0.75 가 정확히 레벨 1 / 2 / 3 임계다. */
  meter: number;
  /** 지금 시뮬에 실릴 레벨 0..3. */
  level: number;
  /** 캘리브레이션 진행도 0..1. */
  calibration: number;
  /** 1..SENS_STEPS */
  sensitivity: number;
  sensitivitySteps: number;
  /** 실패 사유 한 줄. 없으면 null. */
  error: string | null;
}

export interface Mic {
  /**
   * 마이크를 연다. **반드시 사용자 제스처(keydown/pointerdown) 안에서** 부를 것 —
   * rAF 콜백에서 부르면 브라우저가 제스처로 인정하지 않는다.
   * 이미 열려 있으면 아무 일도 하지 않는다.
   */
  start(): void;
  /** 스트림·컨텍스트를 모두 반납하고 IDLE 로 돌아간다. 마이크 표시등이 꺼진다. */
  stop(): void;
  /** 매 틱 1회. 캘리브레이션 진행과 음량 추적을 여기서 한다. */
  sample(): void;
  /** 지금 틱의 마이크 레벨 0..3. READY 가 아니면 항상 0. */
  level(): number;
  phase(): MicPhase;
  error(): string | null;
  /** delta = -1 / +1. 범위를 벗어나면 클램프된다. */
  adjustSensitivity(delta: number): void;
  view(): MicView;
}

// ── 구현 ───────────────────────────────────────────────────────────────────

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | undefined {
  const w = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/** DOMException 이름을 사람이 읽는 한 줄로. 화면에 그대로 나간다. */
function reasonOf(err: unknown): string {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '마이크 권한이 꺼져 있어. 브라우저 설정에서 허용해 봐.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '연결된 마이크가 없어. 연결하고 다시 해 봐.';
    case 'NotReadableError':
    case 'TrackStartError':
      return '다른 앱이 마이크를 잡고 있어. 그 앱을 끄고 다시 해 봐.';
    case 'OverconstrainedError':
      return '이 마이크는 쓸 수 없어. 다른 마이크로 바꿔 봐.';
    default:
      return '마이크를 켜지 못했어. 다시 시도해 봐.';
  }
}

export function createMic(): Mic {
  let phase: MicPhase = 'IDLE';
  let errorMsg: string | null = null;

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let buf: Uint8Array = new Uint8Array(0);

  /** 스무딩된 음량(RMS 포락선). */
  let env = 0;
  /** 캘리브레이션으로 잡은 환경음 바닥값과 그때의 피크. */
  let floorRms = 0;
  let floorPeak = 0;

  let calTicks = 0;
  let calSum = 0;
  let calPeak = 0;
  let requestTicks = 0;

  let sens = SENS_DEFAULT;
  let curLevel = 0;
  let hold = 0;

  /** 자원만 반납한다. phase 는 호출부가 정한다(stop → IDLE, fail → FAILED). */
  function release(): void {
    try {
      if (stream !== null) {
        for (const t of stream.getTracks()) {
          t.onended = null;
          t.stop();
        }
      }
    } catch {
      /* 이미 죽은 트랙 — 무시 */
    }
    try {
      analyser?.disconnect();
    } catch {
      /* 무시 */
    }
    try {
      void ctx?.close();
    } catch {
      /* 무시 */
    }
    stream = null;
    analyser = null;
    ctx = null;
    buf = new Uint8Array(0);
    env = 0;
    curLevel = 0;
    hold = 0;
  }

  function fail(msg: string): void {
    release();
    errorMsg = msg;
    phase = 'FAILED';
  }

  function beginCalibration(): void {
    calTicks = 0;
    calSum = 0;
    calPeak = 0;
    env = 0;
    curLevel = 0;
    hold = 0;
    phase = 'CALIBRATING';
  }

  function onStream(s: MediaStream): void {
    // 기다리는 동안 stop() 이 불렸을 수도 있다 — 그러면 즉시 반납한다.
    if (phase !== 'REQUEST' || ctx === null) {
      for (const t of s.getTracks()) t.stop();
      return;
    }
    try {
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = FFT_SIZE;
      // 스무딩은 우리가 직접 한다(어택/릴리즈 분리). 여기서 또 뭉개면 기침을 놓친다.
      an.smoothingTimeConstant = 0;
      src.connect(an);
      // destination 에는 절대 연결하지 않는다 — 스피커로 나가면 하울링이 난다.
      analyser = an;
      buf = new Uint8Array(an.fftSize);
      stream = s;
      for (const t of s.getTracks()) {
        t.onended = (): void => fail('마이크 연결이 끊겼어. 다시 연결해 봐.');
      }
      if (ctx.state === 'suspended') void ctx.resume();
      beginCalibration();
    } catch {
      for (const t of s.getTracks()) t.stop();
      fail('마이크 소리를 처리할 수 없어. 새로고침해 봐.');
    }
  }

  function unit(): number {
    // 바닥값 자체와 "바닥의 흔들림" 중 큰 쪽을 기준으로 삼는다. 시끄러운 현장에서
    // 바닥이 이미 높으면 임계도 같이 올라가야 플레이가 가능하다.
    const base = Math.max(
      floorRms * UNIT_FLOOR_RATIO,
      (floorPeak - floorRms) * 0.9,
      UNIT_MIN,
    );
    return base * (SENS_SCALE[sens - 1] ?? 1);
  }

  /** 음량 → 0..1 미터. 0.25 / 0.5 / 0.75 에 레벨 임계가 정확히 오도록 접는다. */
  function meterOf(v: number): number {
    const u = unit();
    const t1 = floorRms + u * (STEP[0] ?? 1);
    const t2 = floorRms + u * (STEP[1] ?? 2);
    const t3 = floorRms + u * (STEP[2] ?? 3);
    const span = (a: number, b: number): number => Math.max(1e-6, b - a);
    if (v <= floorRms) return 0;
    if (v < t1) return (0.25 * (v - floorRms)) / span(floorRms, t1);
    if (v < t2) return 0.25 + (0.25 * (v - t1)) / span(t1, t2);
    if (v < t3) return 0.5 + (0.25 * (v - t2)) / span(t2, t3);
    return Math.min(1, 0.75 + (0.25 * (v - t3)) / span(t2, t3));
  }

  return {
    start(): void {
      if (phase !== 'IDLE' && phase !== 'FAILED') return;
      errorMsg = null;
      requestTicks = 0;

      const md = navigator.mediaDevices as MediaDevices | undefined;
      if (md === undefined || typeof md.getUserMedia !== 'function') {
        // 대부분 http:// 로 열어서 보안 컨텍스트가 아닌 경우다.
        fail('이 주소에서는 마이크를 못 써. 보안 연결(https) 주소로 열어 봐.');
        return;
      }
      const Ctor = audioCtor();
      if (Ctor === undefined) {
        fail('이 브라우저로는 소리를 들을 수 없어. 크롬이나 사파리 최신 버전으로 열어 봐.');
        return;
      }
      try {
        ctx = new Ctor();
      } catch {
        fail('소리 기능을 켜지 못했어. 새로고침해 봐.');
        return;
      }
      phase = 'REQUEST';

      // 자동 이득 조절(AGC)과 노이즈 억제는 반드시 끈다 — 켜면 브라우저가 음량을
      // 평탄화해서 "조용함 vs 시끄러움"이라는 이 모드의 전제 자체가 사라진다.
      md.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      }).then(onStream, (err: unknown) => fail(reasonOf(err)));
    },

    stop(): void {
      if (phase === 'IDLE') return;
      release();
      errorMsg = null;
      phase = 'IDLE';
    },

    sample(): void {
      if (phase === 'REQUEST') {
        requestTicks++;
        if (requestTicks >= REQUEST_TIMEOUT_TICKS) {
          fail('마이크 허용 창에 응답이 없었어. 새로고침하고 허용을 눌러 봐.');
        }
        return;
      }
      if (analyser === null || (phase !== 'CALIBRATING' && phase !== 'READY')) {
        return;
      }

      let rms = 0;
      try {
        // 타입 정의가 Uint8Array<ArrayBuffer> 를 요구하는 lib.dom 버전이 있어 캐스트한다.
        analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = ((buf[i] ?? 128) - 128) / 128;
          sum += d * d;
        }
        rms = Math.sqrt(sum / Math.max(1, buf.length));
      } catch {
        fail('마이크 소리가 안 들어와. 연결을 확인해 봐.');
        return;
      }

      if (phase === 'CALIBRATING') {
        calSum += rms;
        calPeak = Math.max(calPeak, rms);
        calTicks++;
        if (calTicks >= CALIBRATION_TICKS) {
          floorRms = calSum / calTicks;
          floorPeak = calPeak;
          env = floorRms;
          phase = 'READY';
        }
        return;
      }

      env += (rms > env ? ATTACK : RELEASE) * (rms - env);

      const raw = Math.min(3, Math.floor(meterOf(env) * 4));
      if (raw >= curLevel) {
        curLevel = raw;
        hold = LEVEL_HOLD_TICKS;
      } else if (hold > 0) {
        hold--;
      } else {
        curLevel = raw;
      }
    },

    level(): number {
      return phase === 'READY' ? curLevel : 0;
    },

    phase(): MicPhase {
      return phase;
    },

    error(): string | null {
      return errorMsg;
    },

    adjustSensitivity(delta: number): void {
      const next = sens + (delta > 0 ? 1 : delta < 0 ? -1 : 0);
      sens = Math.max(1, Math.min(SENS_STEPS, next));
    },

    view(): MicView {
      return {
        phase,
        meter: phase === 'READY' ? Math.max(0, Math.min(1, meterOf(env))) : 0,
        level: phase === 'READY' ? curLevel : 0,
        calibration:
          phase === 'CALIBRATING'
            ? Math.max(0, Math.min(1, calTicks / CALIBRATION_TICKS))
            : phase === 'READY'
              ? 1
              : 0,
        sensitivity: sens,
        sensitivitySteps: SENS_STEPS,
        error: errorMsg,
      };
    },
  };
}
