"use client";

import { Music2, Pause, Play } from "lucide-react";

import { useBgm } from "@/components/providers/bgm-provider";
import { bgmStatusText } from "@/lib/audio/bgm";

export function BgmControls() {
  const bgm = useBgm();
  const active = bgm.enabled && ["playing", "loading"].includes(bgm.status);
  return (
    <aside aria-label="BGMプレーヤー" data-bgm-controls className="sticky top-0 z-40 mx-auto flex min-h-12 w-full max-w-[640px] items-center justify-between gap-3 border-x border-b border-line bg-white/95 px-4 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Music2 size={16} aria-hidden="true" className="shrink-0 text-accent" />
        <span className="truncate font-bold">{bgm.track.title}</span>
        <span className="sr-only" role="status">{bgmStatusText(bgm)}</span>
      </div>
      <button
        type="button"
        disabled={!bgm.ready}
        onClick={() => bgm.setEnabled(!active)}
        aria-label={active ? "BGMを停止" : "BGMを再生"}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-accent-strong hover:bg-accent-soft disabled:opacity-40"
      >
        {active ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        {active ? "BGM停止" : "BGM再生"}
      </button>
    </aside>
  );
}
