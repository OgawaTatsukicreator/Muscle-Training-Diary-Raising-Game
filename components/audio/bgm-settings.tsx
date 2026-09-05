"use client";

import { useId } from "react";
import { Music2 } from "lucide-react";

import { useBgm } from "@/components/providers/bgm-provider";
import { BGM_TRACKS, bgmStatusText } from "@/lib/audio/bgm";

export function BgmSettings() {
  const bgm = useBgm();
  const id = useId();
  const needsRetry = bgm.enabled && ["blocked", "error", "paused"].includes(bgm.status);
  return (
    <section aria-labelledby={`${id}-title`} data-bgm-controls className="mt-5 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-bold">
          <Music2 size={17} aria-hidden="true" className="text-accent" />BGM
        </h3>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={bgm.enabled} disabled={!bgm.ready} onChange={(event) => bgm.setEnabled(event.target.checked)} className="size-5 accent-[var(--accent)]" />
          音楽を流す
        </label>
      </div>
      <label htmlFor={`${id}-track`} className="mt-2 block text-xs font-bold text-muted">曲を選ぶ</label>
      <select id={`${id}-track`} value={bgm.trackId} disabled={!bgm.ready} onChange={(event) => bgm.selectTrack(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-ink/20 bg-white px-3 text-sm font-bold">
        {BGM_TRACKS.map((track, index) => <option key={track.id} value={track.id}>{index + 1}. {track.title}</option>)}
      </select>
      <div className="mt-4 flex items-center justify-between text-xs font-bold">
        <label htmlFor={`${id}-volume`}>音量</label>
        <output htmlFor={`${id}-volume`}>{Math.round(bgm.volume * 100)}%</output>
      </div>
      <input id={`${id}-volume`} type="range" min={0} max={100} step={1} value={Math.round(bgm.volume * 100)} disabled={!bgm.ready} onChange={(event) => bgm.setVolume(Number(event.target.value) / 100)} className="min-h-11 w-full accent-[var(--accent)]" />
      <p role="status" className="text-xs leading-5 text-muted">{bgmStatusText(bgm)}</p>
      {needsRetry ? <button type="button" onClick={() => bgm.setEnabled(true)} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white text-xs font-bold text-accent-strong">BGMを再生</button> : null}
      <p className="mt-2 text-[11px] leading-5 text-muted">
        曲と音量はこのブラウザに保存します。
        {bgm.storageIssue ? " 現在は設定を保存できません。" : ""}
      </p>
      <p className="mt-2 text-[10px] leading-5 text-muted">
        音楽：Juhani Junkala（CC0） · <a href="/audio/bgm/CREDITS.md" target="_blank" rel="noreferrer" className="underline underline-offset-2">音源クレジット</a>
      </p>
    </section>
  );
}
