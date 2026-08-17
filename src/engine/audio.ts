/**
 * WebAudio 절차 생성 SFX (SPEC §7 사운드).
 *
 * 오디오 파일 0개 — 모든 소리를 오실레이터/노이즈 버퍼로 그 자리에서 만든다.
 * 원칙: **오디오는 절대 게임을 죽이지 않는다.** AudioContext 미지원, 자동재생 차단,
 * 하드웨어 오류 등 모든 경로를 try/catch 로 삼키고 무음으로 계속 진행한다.
 */

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
  /** @returns 토글 후의 뮤트 상태. */
  toggleMute(): boolean;
  muted(): boolean;
  /** 첫 사용자 제스처에서 호출. suspended 컨텍스트를 깨운다. */
  resume(): void;
}

type Wave = OscillatorType;

export function createAudio(): Sfx {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let isMuted = false;
  /** 컨텍스트 생성이 한 번 실패하면 매 틱 재시도하지 않는다. */
  let dead = false;

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

  /** 한 음: freq0 → freq1 로 미끄러지며 gain 이 attack 후 지수 감쇠. */
  function tone(
    wave: Wave,
    freq0: number,
    freq1: number,
    dur: number,
    gain: number,
    delay = 0,
  ): void {
    const c = ensure();
    if (c === null || master === null || isMuted) return;
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
      g.connect(master);
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
  ): void {
    const c = ensure();
    if (c === null || master === null || isMuted) return;
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
      g.connect(master);
      src.start(t, offset);
      src.stop(t + dur + 0.02);
    } catch {
      /* 무시 */
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
