/**
 * トレーニング向けBGMの曲データと演奏パターン。
 *
 * 音源ファイルは使わず、ドラム・ベース・コード・アルペジオの配置をここで生成し、
 * workout-synth.ts がブラウザ内でシンセサイザーとして鳴らす。外部の音源や
 * ライセンスに依存せず、アプリの容量も増えない。
 *
 * 1小節は16ステップ（16分音符）。曲は「コード1つ＝1小節」の進行を繰り返し、
 * 8小節ごとに前半(A)・後半(B)で厚みを変え、8小節目に短いフィルを入れる。
 */
export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;

export type DrumHit = "kick" | "snare" | "clap" | "hatClosed" | "hatOpen";

export type StepEvent =
  | { type: "drum"; hit: DrumHit; step: number; gain: number }
  | { type: "bass"; step: number; midi: number; length: number; gain: number }
  | { type: "chord"; step: number; midis: number[]; length: number; gain: number }
  | { type: "arp"; step: number; midi: number; length: number; gain: number };

export type SongStyle = "house" | "trap" | "drive" | "heavy";

export type ChordSpec = {
  /** 曲の主音からの半音数 */
  offset: number;
  quality: "min" | "maj";
};

export type WorkoutSong = {
  id: string;
  title: string;
  description: string;
  style: SongStyle;
  bpm: number;
  /** 主音のMIDIノート番号（ベースの基準になる低い音） */
  tonicMidi: number;
  /** 1小節ごとのコード。この長さで繰り返す */
  progression: readonly ChordSpec[];
};

export const WORKOUT_SONGS: readonly WorkoutSong[] = [
  {
    id: "breakthrough",
    title: "ブレイクスルー",
    description: "ハウス調の定番ビート。ウォームアップから本番まで",
    style: "house",
    bpm: 128,
    tonicMidi: 45, // A2
    progression: [
      { offset: 0, quality: "min" },
      { offset: 8, quality: "maj" },
      { offset: 3, quality: "maj" },
      { offset: 10, quality: "maj" },
    ],
  },
  {
    id: "iron-drive",
    title: "アイアンドライブ",
    description: "重いベースとハイハットのロール。高重量の日に",
    style: "trap",
    bpm: 140,
    tonicMidi: 38, // D2
    progression: [
      { offset: 0, quality: "min" },
      { offset: 8, quality: "maj" },
      { offset: 3, quality: "maj" },
      { offset: 10, quality: "maj" },
    ],
  },
  {
    id: "last-spurt",
    title: "ラストスパート",
    description: "疾走感のある16ビート。追い込みのセットに",
    style: "drive",
    bpm: 150,
    tonicMidi: 40, // E2
    progression: [
      { offset: 0, quality: "min" },
      { offset: 8, quality: "maj" },
      { offset: 3, quality: "maj" },
      { offset: 10, quality: "maj" },
    ],
  },
  {
    id: "power-up",
    title: "パワーアップ",
    description: "どっしりしたハーフタイム。スクワットやデッドリフトに",
    style: "heavy",
    bpm: 108,
    tonicMidi: 36, // C2
    progression: [
      { offset: 0, quality: "min" },
      { offset: 8, quality: "maj" },
      { offset: 3, quality: "maj" },
      { offset: 10, quality: "maj" },
    ],
  },
];

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function stepDurationSeconds(song: Pick<WorkoutSong, "bpm">): number {
  return 60 / song.bpm / (STEPS_PER_BAR / BEATS_PER_BAR);
}

export function barDurationSeconds(song: Pick<WorkoutSong, "bpm">): number {
  return stepDurationSeconds(song) * STEPS_PER_BAR;
}

function chordTones(song: WorkoutSong, barIndex: number): {
  rootMidi: number;
  tones: number[];
} {
  const chord = song.progression[barIndex % song.progression.length];
  const rootMidi = song.tonicMidi + chord.offset;
  const third = chord.quality === "min" ? 3 : 4;

  return { rootMidi, tones: [0, third, 7].map((interval) => rootMidi + interval) };
}

/** "x" のステップにだけ値を置く簡易パターン（16文字）。 */
function stepsOf(pattern: string): number[] {
  if (pattern.length !== STEPS_PER_BAR) {
    throw new Error(`pattern must have ${STEPS_PER_BAR} steps: ${pattern}`);
  }

  return [...pattern].flatMap((char, step) => (char === "x" ? [step] : []));
}

function drums(
  hit: DrumHit,
  pattern: string,
  gain: number,
): StepEvent[] {
  return stepsOf(pattern).map((step) => ({ type: "drum", hit, step, gain }));
}

/**
 * 指定した小節の演奏イベント。同じ入力には必ず同じ結果を返す。
 * barIndex は曲の頭からの通し番号で、8小節周期で構成が変わる。
 */
export function songBarEvents(song: WorkoutSong, barIndex: number): StepEvent[] {
  const phrase = barIndex % 8;
  const isBSection = phrase >= 4;
  const isFillBar = phrase === 7;
  const { rootMidi, tones } = chordTones(song, barIndex);
  const events: StepEvent[] = [];

  const arpNotes = [tones[0], tones[1], tones[2], tones[1] + 12];
  const sixteenthArp = (gain: number): StepEvent[] =>
    Array.from({ length: STEPS_PER_BAR }, (_, step) => ({
      type: "arp" as const,
      step,
      midi: arpNotes[step % arpNotes.length] + 24,
      length: 1,
      gain,
    }));

  switch (song.style) {
    case "house": {
      events.push(...drums("kick", "x...x...x...x...", 1));
      events.push(...drums("clap", "....x.......x...", 0.8));
      events.push(...drums("hatOpen", "..x...x...x...x.", 0.5));
      events.push(...drums("hatClosed", isBSection ? "x.x.x.x.x.x.x.x." : "................", 0.28));
      // 裏拍のベース
      for (const step of [2, 6, 10, 14]) {
        events.push({ type: "bass", step, midi: rootMidi, length: 2, gain: 0.9 });
      }
      for (const step of [0, 6, 10]) {
        events.push({ type: "chord", step, midis: tones.map((m) => m + 12), length: 2, gain: 0.5 });
      }
      if (isBSection) events.push(...sixteenthArp(0.32));
      break;
    }
    case "trap": {
      events.push(...drums("kick", "x..x..x...x..x..", 1));
      events.push(...drums("snare", "........x.......", 0.9));
      events.push(...drums("clap", "........x.......", 0.5));
      events.push(
        ...drums("hatClosed", isBSection ? "xxxxxxxxxxxxxxxx" : "x.x.x.x.x.x.x.x.", isBSection ? 0.22 : 0.3),
      );
      events.push(...drums("hatOpen", "......x.......x.", 0.35));
      for (const [step, length] of [[0, 6], [6, 4], [10, 6]] as const) {
        events.push({ type: "bass", step, midi: rootMidi, length, gain: 1 });
      }
      events.push({ type: "chord", step: 0, midis: tones.map((m) => m + 12), length: 16, gain: 0.34 });
      if (isBSection) events.push(...sixteenthArp(0.24));
      break;
    }
    case "drive": {
      events.push(...drums("kick", "x...x...x...x...", 1));
      events.push(...drums("snare", "....x.......x...", 0.85));
      events.push(...drums("hatClosed", "xxxxxxxxxxxxxxxx", 0.24));
      events.push(...drums("hatOpen", "..x...x...x...x.", 0.38));
      // 16分で走るベース: 根音とオクターブ上を交互に
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        events.push({
          type: "bass",
          step,
          midi: rootMidi + (step % 4 === 3 ? 12 : 0),
          length: 1,
          gain: 0.72,
        });
      }
      for (const step of [0, 4, 8, 12]) {
        events.push({ type: "chord", step, midis: tones.map((m) => m + 12), length: 1, gain: 0.42 });
      }
      events.push(...sixteenthArp(isBSection ? 0.34 : 0.22));
      break;
    }
    case "heavy": {
      events.push(...drums("kick", "x.....x...x.....", 1));
      events.push(...drums("snare", "....x.......x...", 0.95));
      events.push(...drums("clap", "....x.......x...", 0.4));
      events.push(...drums("hatClosed", "x.x.x.x.x.x.x.x.", 0.26));
      events.push(...drums("hatOpen", isBSection ? "......x.......x." : "................", 0.34));
      for (const [step, length] of [[0, 6], [6, 4], [10, 6]] as const) {
        events.push({ type: "bass", step, midi: rootMidi, length, gain: 1 });
      }
      for (const step of [0, 7, 10]) {
        events.push({ type: "chord", step, midis: tones.map((m) => m + 12), length: 3, gain: 0.55 });
      }
      if (isBSection) {
        events.push(
          ...[0, 8].map((step) => ({
            type: "arp" as const,
            step,
            midi: tones[2] + 24,
            length: 6,
            gain: 0.28,
          })),
        );
      }
      break;
    }
  }

  if (isFillBar) {
    // 次の周期へ向けたスネアのフィル（最後の1拍）
    events.push(...drums("snare", "............xxxx", 0.75));
  }

  return events.sort((a, b) => a.step - b.step);
}

/** 1ループ(8小節)の長さ。 */
export function loopDurationSeconds(song: WorkoutSong): number {
  return barDurationSeconds(song) * 8;
}
