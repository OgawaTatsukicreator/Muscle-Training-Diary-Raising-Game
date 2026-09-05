import { Minus, Plus } from "lucide-react";

type ItemQuantitySelectorProps = {
  label: string;
  amount: number;
  maximum: number;
  maximumLabel: string;
  disabled: boolean;
  onChange: (amount: number) => void;
};

export function ItemQuantitySelector({
  label,
  amount,
  maximum,
  maximumLabel,
  disabled,
  onChange,
}: ItemQuantitySelectorProps) {
  const unavailable = maximum < 1;

  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-bold">{label}</legend>
      <div className="mt-2 grid grid-cols-[48px_1fr_48px] gap-2">
        <button
          type="button"
          onClick={() => onChange(amount - 1)}
          disabled={disabled || unavailable || amount <= 1}
          aria-label={`${label}を1個減らす`}
          className="grid min-h-12 place-items-center rounded-xl border border-ink/25 bg-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Minus aria-hidden="true" size={18} />
        </button>
        <label className="relative">
          <span className="sr-only">{label}</span>
          <input
            type="number"
            inputMode="numeric"
            min={unavailable ? 0 : 1}
            max={maximum}
            step={1}
            value={unavailable ? 0 : amount}
            onChange={(event) => onChange(Number(event.target.value))}
            disabled={disabled || unavailable}
            className="data-number min-h-12 w-full rounded-xl border border-ink/25 bg-white px-10 text-center text-xl font-bold disabled:bg-canvas disabled:text-muted"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted">
            個
          </span>
        </label>
        <button
          type="button"
          onClick={() => onChange(amount + 1)}
          disabled={disabled || unavailable || amount >= maximum}
          aria-label={`${label}を1個増やす`}
          className="grid min-h-12 place-items-center rounded-xl border border-ink/25 bg-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange(maximum)}
        disabled={disabled || unavailable || amount === maximum}
        className="mt-2 min-h-11 w-full rounded-xl border border-ink/25 bg-white text-xs font-bold disabled:cursor-not-allowed disabled:opacity-35"
      >
        {maximumLabel}
      </button>
    </fieldset>
  );
}
