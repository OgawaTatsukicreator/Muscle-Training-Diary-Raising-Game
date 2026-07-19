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
    <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
      <div>
        <p className="mb-1 text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
          {eyebrow}
        </p>
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.04em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
