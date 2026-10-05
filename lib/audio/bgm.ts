import { WORKOUT_SONGS } from "@/lib/audio/workout-music";
import type { SynthPort } from "@/lib/audio/workout-synth";

export type BgmCategory = "workout" | "relax";

export type FileBgmTrack = {
  kind: "file";
  category: "relax";
  id: string;
  title: string;
  originalTitle: string;
  src: string;
  description: string;
};

export type SynthBgmTrack = {
  kind: "synth";
  category: "workout";
  id: string;
  title: string;
  description: string;
};

export type BgmTrack = FileBgmTrack | SynthBgmTrack;

/** トレーニング向け。音源ファイルを使わず、ブラウザ内で生成して鳴らす（workout-music.ts）。 */
export const WORKOUT_TRACKS: readonly SynthBgmTrack[] = WORKOUT_SONGS.map((song) => ({
  kind: "synth",
  category: "workout",
  id: song.id,
  title: song.title,
  description: `${song.description}（${song.bpm} BPM）`,
}));

/** ゆったりした曲。Juhani Junkala（CC0）の音源ファイル。 */
export const RELAX_TRACKS: readonly FileBgmTrack[] = [
  { kind: "file", category: "relax", id: "home", title: "いつもの場所", originalTitle: "A Place I Call Home", src: "/audio/bgm/track-01.mp3", description: "ゆったり" },
  { kind: "file", category: "relax", id: "peaceful", title: "おだやかな日々", originalTitle: "Peaceful Days", src: "/audio/bgm/track-02.mp3", description: "おだやか" },
  { kind: "file", category: "relax", id: "sand", title: "砂のお城", originalTitle: "Sand Castles", src: "/audio/bgm/track-03.mp3", description: "のんびり" },
  { kind: "file", category: "relax", id: "summer", title: "夏の思い出", originalTitle: "Summer Memories", src: "/audio/bgm/track-04.mp3", description: "あたたかい" },
  { kind: "file", category: "relax", id: "innocence", title: "はじまりの気持ち", originalTitle: "Innocence", src: "/audio/bgm/track-05.mp3", description: "やさしい" },
];

export const BGM_TRACKS: readonly BgmTrack[] = [...WORKOUT_TRACKS, ...RELAX_TRACKS];

export const BGM_TRACK_GROUPS: readonly {
  category: BgmCategory;
  label: string;
  tracks: readonly BgmTrack[];
}[] = [
  { category: "workout", label: "トレーニング", tracks: WORKOUT_TRACKS },
  { category: "relax", label: "リラックス", tracks: RELAX_TRACKS },
];

export type BgmTrackId = string;
export type BgmPreferences = { trackId: BgmTrackId; enabled: boolean; volume: number };
export type BgmStatus = "idle" | "loading" | "playing" | "paused" | "blocked" | "error";
export type BgmSnapshot = BgmPreferences & { ready: boolean; status: BgmStatus; storageIssue: boolean };

export const BGM_STORAGE_KEY = "maso-diary:bgm:v1";
export const DEFAULT_BGM: BgmPreferences = { trackId: WORKOUT_TRACKS[0].id, enabled: true, volume: 0.25 };
export const INITIAL_BGM_STATE: BgmSnapshot = { ...DEFAULT_BGM, ready: false, status: "idle", storageIssue: false };

export function findBgmTrack(trackId: string): BgmTrack | undefined {
  return BGM_TRACKS.find((track) => track.id === trackId);
}

export function readBgmPreferences(raw: string | null): BgmPreferences {
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return { ...DEFAULT_BGM };
    const value = saved as Record<string, unknown>;
    return {
      trackId: findBgmTrack(String(value.trackId))?.id ?? DEFAULT_BGM.trackId,
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_BGM.enabled,
      volume: typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_BGM.volume,
    };
  } catch {
    return { ...DEFAULT_BGM };
  }
}

export function bgmStatusText(state: BgmSnapshot): string {
  if (!state.ready) return "BGMを準備中";
  if (!state.enabled) return "停止中";
  if (state.status === "error") return "曲を再生できませんでした。再生を押すと再試行します。";
  if (state.status === "blocked") return "画面の操作後に再生します";
  if (state.status === "playing") return state.volume === 0 ? "ミュート中" : "再生中";
  if (state.status === "paused") return "一時停止中";
  return "読み込み中";
}

type AudioPort = Pick<HTMLAudioElement,
  "src" | "volume" | "muted" | "loop" | "preload" | "paused" | "error" |
  "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener"
>;
type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

// One player belongs to the root layout; page changes never recreate its audio.
export class BgmPlayer {
  private state: BgmSnapshot = INITIAL_BGM_STATE;
  private listeners = new Set<() => void>();
  private audio: AudioPort | null = null;
  private storage: PreferencesStorage | null = null;
  private synth: SynthPort | null = null;
  private playAttempt = 0;

  getSnapshot = () => this.state;
  getServerSnapshot = () => INITIAL_BGM_STATE;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(changes: Partial<BgmSnapshot>) {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private currentTrack(): BgmTrack {
    return findBgmTrack(this.state.trackId) ?? WORKOUT_TRACKS[0];
  }

  /** 音源ファイルの曲でだけ、<audio>要素のイベントを状態に反映する。 */
  private playsThroughAudio() {
    return this.currentTrack().kind === "file";
  }

  mount(audio: AudioPort, storage: PreferencesStorage, synth: SynthPort | null = null) {
    this.audio = audio;
    this.storage = storage;
    this.synth = synth;
    let preferences = { ...DEFAULT_BGM };
    let storageIssue = false;
    try { preferences = readBgmPreferences(storage.getItem(BGM_STORAGE_KEY)); }
    catch { storageIssue = true; }
    this.update({ ...preferences, ready: true, status: preferences.enabled ? "loading" : "paused", storageIssue });
    audio.loop = true;
    audio.preload = "none";
    audio.volume = preferences.volume;
    audio.muted = preferences.volume === 0;
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("pause", this.onPause);
    audio.addEventListener("waiting", this.onWaiting);
    audio.addEventListener("error", this.onError);
    this.setSource();
    if (preferences.enabled) this.play();
  }

  unmount() {
    ++this.playAttempt;
    const audio = this.audio;
    const synth = this.synth;
    this.audio = null;
    this.synth = null;
    synth?.dispose();
    if (!audio) return;
    audio.removeEventListener("playing", this.onPlaying);
    audio.removeEventListener("pause", this.onPause);
    audio.removeEventListener("waiting", this.onWaiting);
    audio.removeEventListener("error", this.onError);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  private onPlaying = () => {
    if (this.playsThroughAudio() && this.state.enabled && this.audio && !this.audio.paused) this.update({ status: "playing" });
  };
  private onPause = () => {
    if (this.playsThroughAudio() && this.state.status === "playing") this.update({ status: "paused" });
  };
  private onWaiting = () => {
    if (this.playsThroughAudio() && this.state.enabled && this.audio && !this.audio.paused) this.update({ status: "loading" });
  };
  private onError = () => {
    if (this.playsThroughAudio() && this.state.enabled && this.audio?.error) this.update({ status: "error" });
  };

  private save() {
    const { trackId, enabled, volume } = this.state;
    try {
      this.storage?.setItem(BGM_STORAGE_KEY, JSON.stringify({ trackId, enabled, volume }));
      if (this.state.storageIssue) this.update({ storageIssue: false });
    } catch { this.update({ storageIssue: true }); }
  }

  private setSource() {
    if (!this.audio) return;
    ++this.playAttempt;
    this.audio.pause();
    this.synth?.stop();
    const track = this.currentTrack();
    if (track.kind === "file") {
      this.audio.src = track.src;
    } else if (this.audio.src) {
      // シンセの曲へ切り替えたら、直前のファイルの読み込みを手放す
      this.audio.removeAttribute("src");
      this.audio.load();
    }
  }

  private play() {
    const audio = this.audio;
    if (!audio || !this.state.enabled) return;
    const attempt = ++this.playAttempt;
    this.update({ status: "loading" });
    const track = this.currentTrack();

    if (track.kind === "synth") {
      const synth = this.synth;
      if (!synth) {
        this.update({ status: "error" });
        return;
      }

      void synth.start(track.id, this.state.volume).then((result) => {
        if (this.synth !== synth || attempt !== this.playAttempt || !this.state.enabled) return;
        this.update({ status: result === "running" ? "playing" : "blocked" });
      }).catch(() => {
        if (this.synth !== synth || attempt !== this.playAttempt || !this.state.enabled) return;
        this.update({ status: "error" });
      });
      return;
    }

    void audio.play().then(() => {
      if (this.audio === audio && attempt === this.playAttempt && this.state.enabled && !audio.paused) {
        this.update({ status: "playing" });
      }
    }).catch((error: unknown) => {
      if (this.audio !== audio || attempt !== this.playAttempt || !this.state.enabled) return;
      const name = error && typeof error === "object" && "name" in error ? error.name : "";
      this.update({ status: name === "NotAllowedError" ? "blocked" : name === "AbortError" ? "paused" : "error" });
    });
  }

  resumeAfterGesture = () => {
    if (this.state.enabled && (this.state.status === "blocked" || this.state.status === "paused")) this.play();
  };

  setEnabled = (enabled: boolean) => {
    if (!this.audio) return;
    ++this.playAttempt;
    const failed = this.state.status === "error";
    this.update({ enabled, status: enabled ? "loading" : "paused" });
    this.save();
    if (!enabled) {
      this.audio.pause();
      this.synth?.stop();
    } else {
      if (failed && this.playsThroughAudio()) this.audio.load();
      this.play();
    }
  };

  selectTrack = (trackId: string) => {
    if (!findBgmTrack(trackId) || trackId === this.state.trackId) return;
    this.update({ trackId, status: this.state.enabled ? "loading" : "paused" });
    this.save();
    this.setSource();
    if (this.state.enabled) this.play();
  };

  setVolume = (volume: number) => {
    if (!Number.isFinite(volume)) return;
    const nextVolume = Math.max(0, Math.min(1, volume));
    this.update({ volume: nextVolume });
    if (this.audio) {
      this.audio.volume = nextVolume;
      this.audio.muted = nextVolume === 0;
    }
    this.synth?.setVolume(nextVolume);
    this.save();
    this.resumeAfterGesture();
  };
}
