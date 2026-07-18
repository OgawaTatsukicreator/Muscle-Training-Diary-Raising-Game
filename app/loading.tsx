export default function Loading() {
  return (
    <main className="app-page" aria-busy="true" aria-label="読み込み中">
      <div className="app-container animate-pulse">
        <div className="h-4 w-28 rounded-full bg-line" />
        <div className="mt-3 h-10 w-64 max-w-full rounded-2xl bg-line" />
        <div className="surface-panel mt-8 h-[420px] rounded-[34px]" />
      </div>
      <span className="sr-only">読み込んでいます</span>
    </main>
  );
}
