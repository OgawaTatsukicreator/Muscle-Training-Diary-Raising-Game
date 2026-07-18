import type { ReactNode } from "react";

type PageHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: PageHeadingProps) {
  return (
    <header className="mb-7 flex items-start justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-black tracking-[0.18em] text-accent-strong uppercase">
          {eyebrow}
        </p>
        <h1 className="text-[clamp(1.75rem,7vw,2.5rem)] leading-[1.1] font-black tracking-[-0.055em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-xl text-sm leading-6 font-medium text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
