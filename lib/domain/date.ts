export const APP_TIME_ZONE = "Asia/Tokyo";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function dateKeyInTimeZone(
  date = new Date(),
  timeZone = APP_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function parseDateKey(value: string): Date {
  if (!isDateKey(value)) {
    throw new Error("Invalid date key");
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatJapaneseDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseDateKey(value));
}

export function formatJapaneseMonth(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export type CalendarDay = {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
};

export function buildMonthGrid(year: number, monthIndex: number): CalendarDay[] {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const mondayBasedOffset = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = new Date(Date.UTC(year, monthIndex, 1 - mondayBasedOffset));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);

    return {
      dateKey: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      day: date.getUTCDate(),
      isCurrentMonth: date.getUTCMonth() === monthIndex,
    };
  });
}

export function shiftMonth(
  year: number,
  monthIndex: number,
  amount: number,
): { year: number; monthIndex: number } {
  const shifted = new Date(Date.UTC(year, monthIndex + amount, 1));
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth() };
}
