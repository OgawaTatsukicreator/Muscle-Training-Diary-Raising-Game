import { describe, expect, it, vi } from "vitest";

import { BGM_STORAGE_KEY, BGM_TRACKS, BgmPlayer, DEFAULT_BGM, RELAX_TRACKS, WORKOUT_TRACKS, readBgmPreferences } from "./bgm";
import type { SynthPort } from "./workout-synth";

class FakeAudio extends EventTarget {
  src = "";
  volume = 1;
  muted = false;
  loop = false;
  preload: HTMLAudioElement["preload"] = "";
  paused = true;
  error: MediaError | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(() => { this.error = null; });
  removeAttribute = vi.fn(() => { this.src = ""; });
}

// 音源ファイルの曲を前提にした既存のテストは、保存済みの設定で ゆったり曲 を選んでおく
const RELAX_SAVED = JSON.stringify({ trackId: "home", enabled: true, volume: 0.25 });

function setup(saved: string | null = RELAX_SAVED) {
  const audio = new FakeAudio();
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
  const player = new BgmPlayer();
  player.mount(audio, storage);
  return { audio, storage, player };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("BGM preferences", () => {
  it.each([null, "bad json", "null", "42", '{"trackId":"missing","volume":"loud","enabled":1}'])("recovers invalid preferences: %s", (raw) => {
    expect(readBgmPreferences(raw)).toEqual(DEFAULT_BGM);
  });

  it("restores valid values and clamps the volume", () => {
    expect(readBgmPreferences('{"trackId":"sand","enabled":false,"volume":2}')).toEqual({ trackId: "sand", enabled: false, volume: 1 });
    expect(readBgmPreferences('{"volume":-2}').volume).toBe(0);
  });
});

describe("BGM player", () => {
  it("starts one looping track and releases it on unmount", async () => {
    const { audio, player } = setup();
    await settle();
    expect(audio.src).toBe(RELAX_TRACKS[0].src);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.25);
    expect(player.getSnapshot().status).toBe("playing");
    player.unmount();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
    expect(audio.load).toHaveBeenCalledOnce();
  });

  it("keeps saved music off, including during track changes and gestures", async () => {
    const { audio, player, storage } = setup('{"trackId":"summer","enabled":false,"volume":0.4}');
    player.selectTrack("innocence");
    player.resumeAfterGesture();
    player.setVolume(0.6);
    await settle();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.src).toBe(RELAX_TRACKS[4].src);
    expect(storage.setItem).toHaveBeenLastCalledWith(BGM_STORAGE_KEY, JSON.stringify({ trackId: "innocence", enabled: false, volume: 0.6 }));
  });

  it("recovers an autoplay block on the first permitted gesture", async () => {
    const audio = new FakeAudio();
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => RELAX_SAVED, setItem: () => {} });
    await settle();
    expect(player.getSnapshot().status).toBe("blocked");
    player.resumeAfterGesture();
    await settle();
    expect(player.getSnapshot().status).toBe("playing");
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("ignores a rejected play from a previous track", async () => {
    const audio = new FakeAudio();
    let rejectFirst!: (error: unknown) => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectFirst = reject; }));
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => RELAX_SAVED, setItem: () => {} });
    player.selectTrack("sand");
    await settle();
    rejectFirst({ name: "AbortError" });
    await settle();
    expect(player.getSnapshot()).toMatchObject({ trackId: "sand", status: "playing" });
    expect(audio.src).toBe(RELAX_TRACKS[2].src);
  });

  it("does not resume stopped audio when an earlier promise settles", async () => {
    const audio = new FakeAudio();
    let resolveFirst!: () => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => RELAX_SAVED, setItem: () => {} });
    player.setEnabled(false);
    resolveFirst();
    await settle();
    expect(player.getSnapshot()).toMatchObject({ enabled: false, status: "paused" });
    expect(audio.paused).toBe(true);
  });

  it("still operates if browser storage cannot be used", async () => {
    const audio = new FakeAudio();
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("quota"); } }, new FakeSynth());
    player.setVolume(0);
    await settle();
    expect(player.getSnapshot()).toMatchObject({ status: "playing", storageIssue: true, volume: 0 });
    expect(audio.muted).toBe(true);
  });

  it("reloads a failed track when the user retries", async () => {
    const { audio, player } = setup();
    await settle();
    audio.error = { code: 2, message: "network failure" } as MediaError;
    audio.dispatchEvent(new Event("error"));
    expect(player.getSnapshot().status).toBe("error");
    player.setEnabled(true);
    await settle();
    expect(audio.load).toHaveBeenCalledOnce();
    expect(player.getSnapshot().status).toBe("playing");
  });

  it("ignores invalid and unchanged tracks; clamps and persists volume", async () => {
    const { audio, player } = setup();
    player.selectTrack("missing");
    player.selectTrack("home");
    player.setVolume(2);
    expect(audio.volume).toBe(1);
    player.setVolume(Number.NaN);
    expect(audio.volume).toBe(1);
    await settle();
    expect(audio.play).toHaveBeenCalledOnce();
  });
});

class FakeSynth implements SynthPort {
  start = vi.fn<SynthPort["start"]>(async () => "running");
  stop = vi.fn();
  setVolume = vi.fn();
  dispose = vi.fn();
}

function setupSynth(saved: string | null = null, synth = new FakeSynth()) {
  const audio = new FakeAudio();
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
  const player = new BgmPlayer();
  player.mount(audio, storage, synth);
  return { audio, storage, player, synth };
}

describe("workout BGM", () => {
  it("defaults to a workout track for new users", () => {
    expect(WORKOUT_TRACKS.map((track) => track.id)).toContain(DEFAULT_BGM.trackId);
    expect(WORKOUT_TRACKS[0].id).toBe(DEFAULT_BGM.trackId);
    expect(BGM_TRACKS.slice(0, WORKOUT_TRACKS.length)).toEqual(WORKOUT_TRACKS);
  });

  it("keeps an existing user's saved relaxing track", () => {
    expect(readBgmPreferences('{"trackId":"summer","enabled":true,"volume":0.3}').trackId).toBe("summer");
  });

  it("plays a workout track through the synth, not the audio element", async () => {
    const { audio, player, synth } = setupSynth();
    await settle();
    expect(synth.start).toHaveBeenCalledWith(DEFAULT_BGM.trackId, 0.25);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.src).toBe("");
    expect(player.getSnapshot().status).toBe("playing");
  });

  it("recovers an autoplay block on the first permitted gesture", async () => {
    const synth = new FakeSynth();
    synth.start.mockResolvedValueOnce("blocked");
    const { player } = setupSynth(null, synth);
    await settle();
    expect(player.getSnapshot().status).toBe("blocked");
    player.resumeAfterGesture();
    await settle();
    expect(player.getSnapshot().status).toBe("playing");
    expect(synth.start).toHaveBeenCalledTimes(2);
  });

  it("reports an error when the synth cannot start and retries on request", async () => {
    const synth = new FakeSynth();
    synth.start.mockRejectedValueOnce(new Error("Web Audio is not supported"));
    const { player } = setupSynth(null, synth);
    await settle();
    expect(player.getSnapshot().status).toBe("error");
    player.setEnabled(true);
    await settle();
    expect(player.getSnapshot().status).toBe("playing");
  });

  it("reports an error instead of staying on loading when no synth exists", async () => {
    const audio = new FakeAudio();
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => null, setItem: () => {} });
    await settle();
    expect(player.getSnapshot().status).toBe("error");
  });

  it("switches between a workout track and a file track and stops the other side", async () => {
    const { audio, player, synth } = setupSynth();
    await settle();
    player.selectTrack("home");
    await settle();
    expect(synth.stop).toHaveBeenCalled();
    expect(audio.src).toBe(RELAX_TRACKS[0].src);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(player.getSnapshot()).toMatchObject({ trackId: "home", status: "playing" });

    player.selectTrack("iron-drive");
    await settle();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe("");
    expect(synth.start).toHaveBeenLastCalledWith("iron-drive", 0.25);
    expect(player.getSnapshot()).toMatchObject({ trackId: "iron-drive", status: "playing" });
  });

  it("stops the synth when music is turned off and keeps it off during changes", async () => {
    const { player, synth } = setupSynth('{"trackId":"last-spurt","enabled":false,"volume":0.4}');
    player.selectTrack("power-up");
    player.resumeAfterGesture();
    player.setVolume(0.6);
    await settle();
    expect(synth.start).not.toHaveBeenCalled();
    expect(synth.setVolume).toHaveBeenLastCalledWith(0.6);

    const running = setupSynth();
    await settle();
    running.player.setEnabled(false);
    expect(running.synth.stop).toHaveBeenCalled();
    expect(running.player.getSnapshot()).toMatchObject({ enabled: false, status: "paused" });
  });

  it("ignores a start that resolves after the track changed", async () => {
    const synth = new FakeSynth();
    let resolveFirst!: (value: "running") => void;
    synth.start.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { player } = setupSynth(null, synth);
    player.selectTrack("power-up");
    await settle();
    resolveFirst("running");
    await settle();
    expect(player.getSnapshot()).toMatchObject({ trackId: "power-up", status: "playing" });
    expect(synth.start).toHaveBeenLastCalledWith("power-up", 0.25);
  });

  it("forwards volume to the synth and releases it on unmount", async () => {
    const { player, synth } = setupSynth();
    await settle();
    player.setVolume(0.8);
    expect(synth.setVolume).toHaveBeenCalledWith(0.8);
    player.unmount();
    expect(synth.dispose).toHaveBeenCalledOnce();
  });
});
