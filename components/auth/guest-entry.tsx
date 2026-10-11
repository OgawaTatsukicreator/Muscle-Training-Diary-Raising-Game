export function GuestEntry({ nextPath, disabled = false }: {
  nextPath: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 border-t border-line pt-5">
      <form action="/auth/guest" method="post">
        <input type="hidden" name="next" value={nextPath} />
        <button type="submit" disabled={disabled} className="flex min-h-13 w-full items-center justify-center rounded-2xl border border-line bg-white px-4 font-bold disabled:cursor-wait disabled:text-muted">
          ゲストとしてはじめる
        </button>
      </form>
      <p className="mt-3 text-xs leading-6 text-muted">
        ゲストの記録は、この端末のブラウザに保存します。アカウントの記録とは別になり、登録時に自動で引き継がれません。
      </p>
    </div>
  );
}
