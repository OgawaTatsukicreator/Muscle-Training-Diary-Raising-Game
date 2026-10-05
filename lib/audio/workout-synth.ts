import { StepClock } from "@/lib/audio/step-clock";
import {
  midiToFrequency,
  songBarEvents,
  stepDurationSeconds,
  STEPS_PER_BAR,
  WORKOUT_SONGS,
  type StepEvent,
  type WorkoutSong,
} from "@/lib/audio/workout-music";

/** BgmPlayer が使うシンセ再生の窓口。テストでは差し替える。 */
export interface SynthPort {
  /** 曲を頭から鳴らす。ブラウザが自動再生を許可していなければ "blocked" */
  start(songId: string, volume: number): Promise<"running" | "blocked">;
  stop(): void;
  setVolume(volume: number): void;
  dispose(): void;
}

type Buses = { drums: AudioNode; music: GainNode };

/** 音量1.0のときの出力レベル。リミッターと合わせ、ピークが0dBFSを超えないようにする。 */
const OUTPUT_LEVEL = 0.6;
const LOOKAHEAD_SECONDS = 1.5;
const TICK_MILLISECONDS = 100;
const RESUME_TIMEOUT_MILLISECONDS = 400;

/** 毎回同じ音になるよう、乱数ではなく固定のノイズを使う。 */
export function createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22695477;

  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[index] = seed / 0x80000000 - 1;
  }

  return buffer;
}

function envelope(
  gain: AudioParam,
  time: number,
  peak: number,
  attack: number,
  decayTo: number,
  end: number,
) {
  gain.setValueAtTime(0.0001, time);
  gain.linearRampToValueAtTime(peak, time + attack);
  gain.exponentialRampToValueAtTime(Math.max(decayTo, 0.0001), end);
}

function noiseVoice(
  context: BaseAudioContext,
  noise: AudioBuffer,
  destination: AudioNode,
  time: number,
  options: {
    filter: BiquadFilterType;
    frequency: number;
    q?: number;
    gain: number;
    duration: number;
  },
) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const amp = context.createGain();

  source.buffer = noise;
  filter.type = options.filter;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 0.7;
  envelope(amp.gain, time, options.gain, 0.002, 0.001, time + options.duration);
  source.connect(filter).connect(amp).connect(destination);
  // 毎回同じ位置から始まると機械的なので、時刻に応じて読み出し位置を変える（決定的）
  source.start(time, (time * 9973) % 0.5);
  source.stop(time + options.duration + 0.02);
}

function toneVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  time: number,
  options: {
    type: OscillatorType;
    frequency: number;
    detune?: number;
    gain: number;
    attack: number;
    duration: number;
    release: number;
    cutoff?: number;
    cutoffEnd?: number;
  },
) {
  const oscillator = context.createOscillator();
  const amp = context.createGain();
  const end = time + options.duration;

  oscillator.type = options.type;
  oscillator.frequency.value = options.frequency;
  oscillator.detune.value = options.detune ?? 0;
  amp.gain.setValueAtTime(0.0001, time);
  amp.gain.linearRampToValueAtTime(options.gain, time + options.attack);
  amp.gain.setValueAtTime(options.gain, Math.max(time + options.attack, end - options.release));
  amp.gain.exponentialRampToValueAtTime(0.0001, end + options.release);

  if (options.cutoff) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(options.cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(options.cutoffEnd ?? options.cutoff, 40),
      end,
    );
    oscillator.connect(filter).connect(amp);
  } else {
    oscillator.connect(amp);
  }

  amp.connect(destination);
  oscillator.start(time);
  oscillator.stop(end + options.release + 0.02);
}

function playKick(context: BaseAudioContext, buses: Buses, time: number, gain: number) {
  const oscillator = context.createOscillator();
  const amp = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(165, time);
  oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.11);
  envelope(amp.gain, time, gain * 0.85, 0.002, 0.001, time + 0.38);
  oscillator.connect(amp).connect(buses.drums);
  oscillator.start(time);
  oscillator.stop(time + 0.42);

  // ベースやコードをキックのたびに引っ込めて、低音の濁りを抑える（サイドチェイン風）
  buses.music.gain.setTargetAtTime(0.35, time, 0.006);
  buses.music.gain.setTargetAtTime(1, time + 0.05, 0.09);
}

function playSnare(context: BaseAudioContext, noise: AudioBuffer, buses: Buses, time: number, gain: number) {
  noiseVoice(context, noise, buses.drums, time, {
    filter: "bandpass",
    frequency: 2200,
    q: 0.7,
    gain: gain * 1.3,
    duration: 0.2,
  });
  toneVoice(context, buses.drums, time, {
    type: "triangle",
    frequency: 200,
    gain: gain * 0.45,
    attack: 0.002,
    duration: 0.07,
    release: 0.04,
  });
}

function playClap(context: BaseAudioContext, noise: AudioBuffer, buses: Buses, time: number, gain: number) {
  for (const offset of [0, 0.011, 0.022]) {
    noiseVoice(context, noise, buses.drums, time + offset, {
      filter: "bandpass",
      frequency: 1700,
      q: 1,
      gain: gain * 0.95,
      duration: offset === 0.022 ? 0.17 : 0.02,
    });
  }
}

function playBass(context: BaseAudioContext, buses: Buses, time: number, length: number, midi: number, gain: number, stepSeconds: number) {
  const frequency = midiToFrequency(midi);
  const duration = Math.max(length * stepSeconds * 0.92, 0.05);

  toneVoice(context, buses.music, time, {
    type: "sawtooth",
    frequency,
    gain: gain * 0.34,
    attack: 0.004,
    duration,
    release: 0.04,
    cutoff: 1400,
    cutoffEnd: 420,
  });
  toneVoice(context, buses.music, time, {
    type: "sine",
    frequency,
    gain: gain * 0.3,
    attack: 0.004,
    duration,
    release: 0.05,
  });
}

function playChord(context: BaseAudioContext, buses: Buses, time: number, length: number, midis: number[], gain: number, stepSeconds: number) {
  const duration = Math.max(length * stepSeconds * 0.9, 0.06);

  for (const midi of midis) {
    for (const detune of [-8, 8]) {
      toneVoice(context, buses.music, time, {
        type: "sawtooth",
        frequency: midiToFrequency(midi),
        detune,
        gain: (gain * 0.75) / midis.length,
        attack: 0.01,
        duration,
        release: 0.08,
        cutoff: 4200,
        cutoffEnd: 1500,
      });
    }
  }
}

function playArp(context: BaseAudioContext, buses: Buses, time: number, length: number, midi: number, gain: number, stepSeconds: number) {
  toneVoice(context, buses.music, time, {
    type: "square",
    frequency: midiToFrequency(midi),
    gain: gain * 0.3,
    attack: 0.004,
    duration: Math.max(length * stepSeconds * 0.8, 0.04),
    release: 0.03,
    cutoff: 5200,
    cutoffEnd: 2200,
  });
}

/** 通し番号 stepIndex のステップに含まれる全ての音を予約する。 */
export function scheduleStep(
  context: BaseAudioContext,
  buses: Buses,
  noise: AudioBuffer,
  song: WorkoutSong,
  stepIndex: number,
  time: number,
  barEventsOf: (barIndex: number) => StepEvent[] = (barIndex) => songBarEvents(song, barIndex),
) {
  const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
  const step = stepIndex % STEPS_PER_BAR;
  const stepSeconds = stepDurationSeconds(song);

  for (const event of barEventsOf(barIndex)) {
    if (event.step !== step) {
      continue;
    }

    switch (event.type) {
      case "drum":
        if (event.hit === "kick") playKick(context, buses, time, event.gain);
        else if (event.hit === "snare") playSnare(context, noise, buses, time, event.gain);
        else if (event.hit === "clap") playClap(context, noise, buses, time, event.gain);
        else {
          const open = event.hit === "hatOpen";
          noiseVoice(context, noise, buses.drums, time, {
            filter: "highpass",
            frequency: open ? 6000 : 7500,
            gain: event.gain * 1.1,
            duration: open ? 0.22 : 0.045,
          });
        }
        break;
      case "bass":
        playBass(context, buses, time, event.length, event.midi, event.gain, stepSeconds);
        break;
      case "chord":
        playChord(context, buses, time, event.length, event.midis, event.gain, stepSeconds);
        break;
      case "arp":
        playArp(context, buses, time, event.length, event.midi, event.gain, stepSeconds);
        break;
    }
  }
}

/** 出力段（ミキサー → コンプレッサー → マスター）。 */
export function createOutputChain(context: BaseAudioContext, destination: AudioNode): {
  buses: Buses;
  master: GainNode;
  input: AudioNode;
  limiter: AudioNode;
} {
  const drums = context.createGain();
  const music = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const limiter = context.createDynamicsCompressor();
  const master = context.createGain();

  drums.gain.value = 0.7;
  music.gain.value = 0.8;
  // 全体を軽くまとめる
  compressor.threshold.value = -20;
  compressor.knee.value = 10;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  // 重なった音の瞬間的なピークを抑える安全装置
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
  master.gain.value = OUTPUT_LEVEL;
  drums.connect(compressor);
  music.connect(compressor);
  compressor.connect(limiter).connect(master).connect(destination);

  return { buses: { drums, music }, master, input: compressor, limiter };
}

type Session = {
  clock: StepClock;
  timer: ReturnType<typeof setInterval>;
  master: GainNode;
  disconnect: () => void;
};

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext };

  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** ブラウザのWeb Audioでトレーニング向けBGMを鳴らす。 */
export class WebAudioSynth implements SynthPort {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private session: Session | null = null;
  private pendingSuspend: Promise<unknown> | null = null;
  private startToken = 0;
  private volume = 0.25;

  async start(songId: string, volume: number): Promise<"running" | "blocked"> {
    const song = WORKOUT_SONGS.find((candidate) => candidate.id === songId);
    if (!song) {
      throw new Error(`Unknown workout song: ${songId}`);
    }

    const Constructor = audioContextConstructor();
    if (!this.context) {
      if (!Constructor) {
        throw new Error("Web Audio is not supported");
      }

      this.context = new Constructor();
    }

    const context = this.context;
    const token = ++this.startToken;
    this.volume = volume;
    this.endSession();
    // 直前の stop() による suspend が終わる前に再生すると、その後で止まってしまう
    await this.pendingSuspend;
    this.pendingSuspend = null;

    if (context.state !== "running") {
      // 自動再生が許可されていないと resume() は解決しないまま止まることがある
      await Promise.race([
        context.resume().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MILLISECONDS)),
      ]);
    }

    // 待っている間に別の start()/stop() が呼ばれた。古い要求は何もしない
    if (token !== this.startToken) {
      return "blocked";
    }

    if (context.state !== "running") {
      return "blocked";
    }

    this.noise ??= createNoiseBuffer(context);
    this.beginSession(context, this.noise, song);

    return "running";
  }

  private beginSession(context: AudioContext, noise: AudioBuffer, song: WorkoutSong) {
    const { buses, master, input, limiter } = createOutputChain(context, context.destination);
    master.gain.value = this.volume * OUTPUT_LEVEL;
    const barCache = new Map<number, StepEvent[]>();
    const barEventsOf = (barIndex: number) => {
      let events = barCache.get(barIndex);
      if (!events) {
        events = songBarEvents(song, barIndex);
        barCache.set(barIndex, events);
        barCache.delete(barIndex - 4);
      }
      return events;
    };
    const clock = new StepClock({
      stepSeconds: stepDurationSeconds(song),
      lookaheadSeconds: LOOKAHEAD_SECONDS,
      now: () => context.currentTime,
      onStep: (stepIndex, time) =>
        scheduleStep(context, buses, noise, song, stepIndex, time, barEventsOf),
    });
    const timer = setInterval(() => clock.tick(), TICK_MILLISECONDS);

    clock.tick();
    this.session = {
      clock,
      timer,
      master,
      // 予約済みの音ごと切り離し、停止後に鳴り残らないようにする
      disconnect: () => {
        master.disconnect();
        limiter.disconnect();
        input.disconnect();
        buses.drums.disconnect();
        buses.music.disconnect();
      },
    };
  }

  private endSession() {
    const session = this.session;
    if (!session) {
      return;
    }

    clearInterval(session.timer);
    session.disconnect();
    this.session = null;
  }

  stop() {
    this.startToken += 1;
    this.endSession();
    // 使っていない間はオーディオ処理を止めて電池を節約する
    this.pendingSuspend =
      this.context?.suspend().catch(() => undefined) ?? null;
  }

  setVolume(volume: number) {
    this.volume = volume;
    const context = this.context;

    if (this.session && context) {
      this.session.master.gain.setTargetAtTime(volume * OUTPUT_LEVEL, context.currentTime, 0.02);
    }
  }

  dispose() {
    this.startToken += 1;
    this.endSession();
    const context = this.context;
    this.context = null;
    this.noise = null;
    void context?.close().catch(() => undefined);
  }
}
