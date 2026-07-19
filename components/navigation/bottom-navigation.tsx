"use client";

import { BarChart3, CalendarDays, House } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "マソ君", icon: House },
  { href: "/records", label: "記録", icon: CalendarDays },
  { href: "/analytics", label: "履歴分析", icon: BarChart3 },
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
      className="fixed bottom-0 left-1/2 z-50 w-full max-w-[640px] -translate-x-1/2 border-x border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-[70px] grid-cols-3">
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
              className={`relative flex min-h-12 flex-col items-center justify-center gap-1 border-r border-line text-[12px] font-bold transition-colors last:border-r-0 ${
                active ? "text-accent" : "text-ink hover:bg-canvas/55"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-x-5 top-0 h-0.5 transition-colors ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
              />
              <Icon aria-hidden="true" size={19} strokeWidth={active ? 2.5 : 1.8} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
