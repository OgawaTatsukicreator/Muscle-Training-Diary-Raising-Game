import { describe, expect, it } from "vitest";

import { buildMonthGrid, dateKeyInTimeZone, isDateKey } from "@/lib/domain/date";

describe("date helpers", () => {
  it("uses the Tokyo calendar day instead of UTC", () => {
    expect(dateKeyInTimeZone(new Date("2026-07-16T16:00:00.000Z"))).toBe(
      "2026-07-17",
    );
  });

  it("rejects impossible calendar dates", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-07-17")).toBe(true);
  });

  it("builds a Monday-first six-week calendar", () => {
    const days = buildMonthGrid(2026, 6);
    expect(days).toHaveLength(42);
    expect(days[0].dateKey).toBe("2026-06-29");
  });
});
