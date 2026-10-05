"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { BgmPlayer, findBgmTrack, WORKOUT_TRACKS } from "@/lib/audio/bgm";
import { WebAudioSynth } from "@/lib/audio/workout-synth";

const BgmContext = createContext<BgmPlayer | null>(null);

export function BgmProvider({ children }: { children: ReactNode }) {
  const [player] = useState(() => new BgmPlayer());

  useEffect(() => {
    const audio = new Audio();
    // Access to localStorage itself can throw in privacy-restricted browsers.
    player.mount(audio, {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    }, new WebAudioSynth());
    const unlock = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-bgm-controls]")) return;
      if (event instanceof KeyboardEvent && (event.repeat || !["Enter", " "].includes(event.key))) return;
      player.resumeAfterGesture();
    };
    document.addEventListener("pointerup", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => {
      document.removeEventListener("pointerup", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      player.unmount();
    };
  }, [player]);

  return <BgmContext.Provider value={player}>{children}</BgmContext.Provider>;
}

export function useBgm() {
  const player = useContext(BgmContext);
  if (!player) throw new Error("useBgm must be used inside BgmProvider");
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getServerSnapshot);
  return {
    ...state,
    track: findBgmTrack(state.trackId) ?? WORKOUT_TRACKS[0],
    setEnabled: player.setEnabled,
    selectTrack: player.selectTrack,
    setVolume: player.setVolume,
  };
}
