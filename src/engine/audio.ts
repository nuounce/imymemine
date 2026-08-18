/**
 * WebAudio 절차 생성 SFX (SPEC §7 사운드).
 *
 * 오디오 파일 0개 — 모든 소리를 오실레이터/노이즈 버퍼로 그 자리에서 만든다.
 * 원칙: **오디오는 절대 게임을 죽이지 않는다.** AudioContext 미지원, 자동재생 차단,
 * 하드웨어 오류 등 모든 경로를 try/catch 로 삼키고 무음으로 계속 진행한다.
 *
 * ── 두 개의 층 ────────────────────────────────────────────────────────────
 * 1. **사건음** (`footstep` … `clear`): 화면 중앙에서 나는 UI 성격의 소리. 예전 그대로다.
 * 2. **정위음** (`playCues`): 세계 안의 어느 지점에서 나는 소리. 좌우 패닝·거리 감쇠·
 *    벽 너머 로우패스가 걸린다. 무엇을 언제 낼지는 `soundscape.ts` 가 정하고,
 *    이 파일은 그 `Cue` 를 실제 노드 그래프로 옮기기만 한다.
 *
 * ── 마이크 되먹임 ─────────────────────────────────────────────────────────
 * LISTEN 모드는 마이크로 플레이어 소리를 듣는다. 스피커로 게임 소리를 크게 내면
 * **그 소리가 마이크로 돌아와 게임이 스스로를 발각시킨다.** 그래서 이어폰이
 * 분위기가 아니라 기능 요구사항이고, 안 낀 사람을 위한 완충이 `calibrationSample`
 * 이다 — 환경음 측정 2초 동안 게임의 대표 소리를 함께 내보내 그 수준이 바닥값에
 * 포함되게 한다.
 */

import type { Cue } from './soundscape';

export interface Sfx {
  /** 달릴 때만 난다 — 소음은 경비를 부르는 게임 메커닉이라 청각 피드백이 필수다. */
  footstep(): void;
  interact(): void;
  door(): void;
  /** 경비 발각 — 하강 2음. */
  alert(): void;
  /** loot 획득 — 상승 아르페지오. */
  loot(): void;
  /** 잔상 확정 — 리버스 스윕(빨려 들어가는 느낌). */
  commit(): void;
  capture(): void;
  /** 스테이지 클리어 — 4음 팡파레. */
  clear(): void;
  /**
   * 이번 틱의 정위음을 전부 발음한다. 목록은 `soundscape.updateSoundscape` 가 만들며
   * 이미 동시 재생 상한이 적용돼 있다. 빈 배열이면 아무 일도 하지 않는다.
   */
  playCues(cues: readonly Cue[]): void;
  /**
   * 캘리브레이션 중 매 틱 호출. 게임의 대표 소리(발소리·경보)를 스피커로 내보내
   * **환경음 바닥값에 게임 소리가 포함되게** 한다 → 이어폰 없이도 자기 발소리에
   * 자기가 들키는 사고가 줄어든다.
   * @param progress 캘리브레이션 진행도 0..1 (`MicView.calibration`).
   */
  calibrationSample(progress: number): void;
  /** @returns 토글 후의 뮤트 상태. */
  toggleMute(): boolean;
  muted(): boolean;
  /** 첫 사용자 제스처에서 호출. suspended 컨텍스트를 깨운다. */
  resume(): void;
}

type Wave = OscillatorType;

/**
 * 정위음 전체 게인. 사건음과 나란히 울려도 마스터가 포화하지 않는 선.
 * 상한(12) 이 전부 동시에 터져도 클리핑하지 않도록 여유를 둔 값이다.
 */
const CUE_MASTER = 0.55;

export function createAudio(): Sfx {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let isMuted = false;
  /** 컨텍스트 생성이 한 번 실패하면 매 틱 재시도하지 않는다. */
  let dead = false;
  /** 직전 캘리브레이션 진행도. 되감기면 새 캘리브레이션으로 본다. */
  let calLast = -1;

  function ensure(): AudioContext | null {
    if (dead) return null;
    if (ctx !== null) return ctx;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor === undefined) {
        dead = true;
        return null;
      }
      const c = new Ctor();
      const g = c.createGain();
      g.gain.value = 0.5;
      g.connect(c.destination);
      ctx = c;
      master = g;
      return c;
    } catch {
      dead = true;
      return null;
    }
  }

  /** 화이트노이즈 1초 버퍼. 발소리/체포음의 재료. */
  function noise(c: AudioContext): AudioBuffer | null {
    if (noiseBuf !== null) return noiseBuf;
    try {
      const len = Math.floor(c.sampleRate);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      // 재생 위치를 매번 랜덤하게 잡으므로 시드 없는 난수로 충분하다
      // (오디오는 시뮬 밖이라 결정론 제약을 받지 않는다).
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBuf = buf;
      return buf;
    } catch {
      return null;
    }
  }

  /**
   * 한 음: freq0 → freq1 로 미끄러지며 gain 이 attack 후 지수 감쇠.
   * `dest` 를 주면 그쪽으로 나간다(정위 체인). 없으면 마스터 직결.
   */
  function tone(
    wave: Wave,
    freq0: number,
    freq1: number,
    dur: number,
    gain: number,
    delay = 0,
    dest: AudioNode | null = null,
  ): void {
    const c = ensure();
    const out = dest ?? master;
    if (c === null || out === null || isMuted) return;
    try {
      const t = c.currentTime + delay;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq0, t);
      if (freq1 !== freq0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* 오디오 실패는 무시한다 — 게임은 계속된다. */
    }
  }

  /** 노이즈 버스트. 밴드패스로 재질(발소리 / 굉음)을 만든다. */
  function burst(
    centerHz: number,
    q: number,
    dur: number,
    gain: number,
    delay = 0,
    dest: AudioNode | null = null,
  ): void {
    const c = ensure();
    const out = dest ?? master;
    if (c === null || out === null || isMuted) return;
    const buf = noise(c);
    if (buf === null) return;
    try {
      const t = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // 매번 다른 지점에서 읽어 반복감을 없앤다.
      const offset = Math.random() * Math.max(0, buf.duration - dur - 0.05);
      const filt = c.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = centerHz;
      filt.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(out);
      src.start(t, offset);
      src.stop(t + dur + 0.02);
    } catch {
      /* 무시 */
    }
  }

  // ── 사람 소리 ────────────────────────────────────────────────────────────

  /**
   * 숨을 **들이키는** 소리. 밴드패스 중심이 위로 훑고 게인이 끝에서 뚝 끊긴다 —
   * 내쉬는 소리와 뒤집힌 포락선이라 귀가 "헉"으로 읽는다.
   */
  function inhale(dur: number, gain: number, dest: AudioNode | null): void {
    const c = ensure();
    const out = dest ?? master;
    if (c === null || out === null || isMuted) return;
    const buf = noise(c);
    if (buf === null) return;
    try {
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.5;
      bp.frequency.setValueAtTime(480, t);
      bp.frequency.exponentialRampToValueAtTime(2100, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.82);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    } catch {
      /* 무시 */
    }
  }

  /**
   * 숨을 **내쉬는** 소리. `harsh` 가 높을수록 중심이 위로 올라가고 거칠어진다 —
   * 그게 곧 "지금 보이고 있다"는 신호다.
   */
  function exhale(dur: number, gain: number, harsh: number, dest: AudioNode | null): void {
    const c = ensure();
    const out = dest ?? master;
    if (c === null || out === null || isMuted) return;
    const buf = noise(c);
    if (buf === null) return;
    try {
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9 + harsh * 1.4;
      const top = 620 + harsh * 900;
      bp.frequency.setValueAtTime(top, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, top * 0.45), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    } catch {
      /* 무시 */
    }
  }

  /**
   * 고함. 실제 말이 아니라 **포먼트 흉내**다 — 성대 대용 톱니파를 세 개의
   * 밴드패스(F1/F2/F3)로 걸러 모음처럼 만든다. 이 셋이 없으면 그냥 삐 소리가 되고,
   * 있으면 "사람이 지른 소리"로 들린다.
   */
  function shout(gain: number, dest: AudioNode | null): void {
    const c = ensure();
    const out = dest ?? master;
    if (c === null || out === null || isMuted) return;
    try {
      const t = c.currentTime;
      const dur = 0.38;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(172, t);
      osc.frequency.exponentialRampToValueAtTime(112, t + dur);
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + 0.028);
      env.gain.setValueAtTime(gain, t + dur * 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env);
      const formants = [700, 1180, 2600];
      const amps = [1, 0.45, 0.18];
      for (let i = 0; i < formants.length; i++) {
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = formants[i]!;
        bp.Q.value = 7;
        const fg = c.createGain();
        fg.gain.value = amps[i]!;
        env.connect(bp);
        bp.connect(fg);
        fg.connect(out);
      }
      osc.start(t);
      osc.stop(t + dur + 0.03);
    } catch {
      /* 무시 */
    }
  }

  // ── 정위 체인 ────────────────────────────────────────────────────────────

  /**
   * 좌우 정위 노드. `StereoPannerNode` 가 없는 브라우저(구형 Safari 등)에서는
   * 게인 2채널 + 머저로 폴백한다. 등출력 팬 법칙(sin/cos)이라 중앙에서 음량이
   * 꺼지지 않는다 — 선형 팬으로 하면 정면 소리가 3dB 죽는다.
   */
  function panChain(c: AudioContext, pan: number): { input: AudioNode; output: AudioNode } {
    const p = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    const maybe = c as AudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof maybe.createStereoPanner === 'function') {
      const node = maybe.createStereoPanner();
      node.pan.value = p;
      return { input: node, output: node };
    }
    const merger = c.createChannelMerger(2);
    const input = c.createGain();
    const l = c.createGain();
    const r = c.createGain();
    const a = ((p + 1) * Math.PI) / 4;
    l.gain.value = Math.cos(a);
    r.gain.value = Math.sin(a);
    input.connect(l);
    input.connect(r);
    l.connect(merger, 0, 0);
    r.connect(merger, 0, 1);
    return { input, output: merger };
  }

  /** 한 큐의 입력단을 만든다: [로우패스?] → 게인 → 팬 → 마스터. */
  function cueInput(c: AudioContext, cue: Cue): AudioNode | null {
    if (master === null) return null;
    const pan = panChain(c, cue.pan);
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, cue.gain)) * CUE_MASTER;
    g.connect(pan.input);
    pan.output.connect(master);
    if (cue.cutoffHz === null) return g;
    // 벽 너머 = 저역만 남는다. 이 한 줄이 "보이지 않는 곳"을 귀로 알려준다.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cue.cutoffHz;
    lp.Q.value = 0.7;
    lp.connect(g);
    return lp;
  }

  /** 큐 하나를 소리로. 각 유형의 음색은 SPEC §7 의 "보기 전에 귀로 판단" 표를 따른다. */
  function voice(c: AudioContext, cue: Cue): void {
    const dest = cueInput(c, cue);
    if (dest === null) return;
    switch (cue.kind) {
      case 'FOOT_SENTRY':
      case 'GHOST_FOOT':
        // 규칙적인 구둣발 — 중역의 짧은 탁음.
        burst(440 + Math.random() * 90, 1.7, 0.05, 0.9, 0, dest);
        tone('triangle', 200, 130, 0.05, 0.4, 0, dest);
        break;
      case 'FOOT_BRUTE':
        // 무겁고 느린 저역 쿵. 몸이 크다는 걸 주파수로 알린다.
        tone('sine', 96, 44, 0.17, 0.95, 0, dest);
        burst(120, 0.8, 0.13, 0.5, 0, dest);
        break;
      case 'FOOT_HOUND':
        // 빠르고 가벼운 발톱. 짧고 높다.
        burst(1750 + Math.random() * 350, 2.4, 0.028, 0.75, 0, dest);
        break;
      case 'SNIFF':
        // 킁킁 — 짧은 들숨 두 번.
        inhale(0.075, 0.8, dest);
        burst(760, 1.1, 0.055, 0.45, 0.095, dest);
        break;
      case 'MOTOR':
        // 렌즈 도는 미세한 모터음. 길이(0.35초)가 발생 간격(0.3초)보다 길어 끊기지 않는다.
        tone('sawtooth', 214, 208, 0.35, 0.5, 0, dest);
        tone('sawtooth', 108, 106, 0.35, 0.35, 0, dest);
        burst(2400, 3.5, 0.35, 0.08, 0, dest);
        break;
      case 'GASP':
        inhale(0.22, 0.95, dest);
        break;
      case 'RADIO':
        // 무전 = 노이즈 버스트 + 좁은 밴드패스 + 스퀠치 딸깍.
        burst(1750, 7, 0.1, 0.85, 0, dest);
        tone('square', 920, 880, 0.028, 0.35, 0.11, dest);
        burst(1500, 6, 0.16, 0.6, 0.15, dest);
        burst(2100, 9, 0.05, 0.45, 0.34, dest);
        break;
      case 'SHOUT':
        shout(0.95, dest);
        break;
      case 'SIREN':
        // 호각/사이렌 — 이 게임에서 가장 멀리 가야 하는 소리.
        tone('square', 880, 1240, 0.22, 0.6, 0, dest);
        tone('square', 1240, 880, 0.22, 0.6, 0.22, dest);
        tone('square', 880, 1240, 0.22, 0.6, 0.44, dest);
        tone('sine', 2150, 2050, 0.66, 0.28, 0, dest);
        break;
      case 'GROAN':
        // 눈뽕에 당한 신음 — 아래로 흘러내리는 저역.
        tone('sawtooth', 168, 96, 0.42, 0.55, 0, dest);
        tone('sine', 84, 62, 0.5, 0.35, 0.04, dest);
        break;
      case 'BREATH': {
        // 게이지가 높을수록 짧고 거칠고 크다.
        const h = Math.max(0, Math.min(1, cue.intensity));
        exhale(0.24 - h * 0.09, 0.95, h, dest);
        break;
      }
      default:
        break;
    }
  }

  return {
    footstep(): void {
      burst(420 + Math.random() * 120, 1.4, 0.055, 0.09);
    },

    interact(): void {
      tone('square', 880, 1320, 0.06, 0.12);
    },

    door(): void {
      tone('sawtooth', 240, 90, 0.28, 0.1);
      burst(180, 0.9, 0.22, 0.07);
    },

    alert(): void {
      // 하강 2음 — "들켰다"는 신호는 항상 아래로 떨어진다.
      tone('square', 660, 640, 0.11, 0.13);
      tone('square', 440, 430, 0.18, 0.13, 0.11);
    },

    loot(): void {
      // 상승 아르페지오 C-E-G-C
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone('triangle', f, f, 0.13, 0.13, i * 0.055));
    },

    commit(): void {
      // 리버스 스윕: 낮은 곳에서 위로 빨려 올라간 뒤 툭 끊긴다 = "과거로 접혔다".
      tone('sawtooth', 160, 1400, 0.34, 0.11);
      tone('sine', 80, 320, 0.36, 0.1);
    },

    capture(): void {
      tone('sawtooth', 320, 55, 0.42, 0.16);
      burst(140, 0.7, 0.34, 0.12);
    },

    clear(): void {
      // 4음 팡파레 — 네 개의 몸에 대응한다.
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone('triangle', f, f, i === 3 ? 0.5 : 0.16, 0.15, i * 0.12);
        tone('sine', f / 2, f / 2, i === 3 ? 0.5 : 0.16, 0.09, i * 0.12);
      });
    },

    playCues(cues: readonly Cue[]): void {
      if (cues.length === 0) return;
      const c = ensure();
      if (c === null || master === null || isMuted) return;
      try {
        for (let i = 0; i < cues.length; i++) voice(c, cues[i]!);
      } catch {
        /* 무시 — 한 프레임의 소리를 잃을 뿐이다. */
      }
    },

    calibrationSample(progress: number): void {
      const c = ensure();
      // 뮤트 상태면 애초에 스피커로 나가는 소리가 없으니 되먹임도 없다 — 건너뛴다.
      if (c === null || master === null || isMuted) return;
      const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      if (p < calLast) calLast = -1; // 새 캘리브레이션이 시작됐다.
      const crossed = (mark: number): boolean => calLast < mark && p >= mark;
      try {
        // 발소리 12발(0.08 간격) — 게임에서 가장 자주 나는 소리를 바닥값에 심는다.
        for (let k = 1; k <= 12; k++) {
          if (crossed(k * 0.08)) burst(440 + Math.random() * 90, 1.7, 0.05, 0.22);
        }
        // 경보/고함은 가장 큰 소리다. 이것까지 바닥값에 들어가야 실전에서 안 튄다.
        if (crossed(0.34)) {
          tone('square', 880, 1240, 0.2, 0.16);
          tone('square', 1240, 880, 0.2, 0.16, 0.2);
        }
        if (crossed(0.72)) shout(0.3, null);
      } catch {
        /* 무시 */
      }
      calLast = p;
    },

    toggleMute(): boolean {
      isMuted = !isMuted;
      try {
        if (master !== null && ctx !== null) {
          master.gain.setTargetAtTime(isMuted ? 0 : 0.5, ctx.currentTime, 0.01);
        }
      } catch {
        /* 무시 */
      }
      return isMuted;
    },

    muted(): boolean {
      return isMuted;
    },

    resume(): void {
      const c = ensure();
      if (c === null) return;
      try {
        if (c.state === 'suspended') void c.resume();
      } catch {
        /* 무시 */
      }
    },
  };
}
