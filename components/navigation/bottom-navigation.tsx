"use client";

import { BarChart3, CalendarDays, House } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "ホーム", icon: House },
  { href: "/records", label: "記録", icon: CalendarDays },
  { href: "/analytics", label: "分析", icon: BarChart3 },
] as const;

export function ConditionalBottomNavigation() {
  const pathname = usePathname();
  const isFocusedRoute =
    pathname === "/login" ||
    pathname === "/records/new" ||
    /^\/records\/[^/]+\/edit$/.test(pathname);

  if (isFocusedRoute) {
    return null;
  }

  return (
    <nav
      aria-label="メインナビゲーション"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/94 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <div className="mx-auto grid h-[76px] max-w-[560px] grid-cols-3 px-4">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl text-[12px] font-bold transition-colors ${
                active ? "text-accent-strong" : "text-muted hover:text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1 h-1 w-7 rounded-full transition-colors ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
              />
              <Icon aria-hidden="true" size={21} strokeWidth={active ? 2.6 : 2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
