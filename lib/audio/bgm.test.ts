import { describe, expect, it, vi } from "vitest";

import { BGM_STORAGE_KEY, BGM_TRACKS, BgmPlayer, DEFAULT_BGM, readBgmPreferences } from "./bgm";

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

function setup(saved: string | null = null) {
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
    expect(audio.src).toBe(BGM_TRACKS[0].src);
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
    expect(audio.src).toBe(BGM_TRACKS[4].src);
    expect(storage.setItem).toHaveBeenLastCalledWith(BGM_STORAGE_KEY, JSON.stringify({ trackId: "innocence", enabled: false, volume: 0.6 }));
  });

  it("recovers an autoplay block on the first permitted gesture", async () => {
    const audio = new FakeAudio();
    audio.play.mockRejectedValueOnce({ name: "NotAllowedError" });
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => null, setItem: () => {} });
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
    player.mount(audio, { getItem: () => null, setItem: () => {} });
    player.selectTrack("sand");
    await settle();
    rejectFirst({ name: "AbortError" });
    await settle();
    expect(player.getSnapshot()).toMatchObject({ trackId: "sand", status: "playing" });
    expect(audio.src).toBe(BGM_TRACKS[2].src);
  });

  it("does not resume stopped audio when an earlier promise settles", async () => {
    const audio = new FakeAudio();
    let resolveFirst!: () => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => null, setItem: () => {} });
    player.setEnabled(false);
    resolveFirst();
    await settle();
    expect(player.getSnapshot()).toMatchObject({ enabled: false, status: "paused" });
    expect(audio.paused).toBe(true);
  });

  it("still operates if browser storage cannot be used", async () => {
    const audio = new FakeAudio();
    const player = new BgmPlayer();
    player.mount(audio, { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("quota"); } });
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
