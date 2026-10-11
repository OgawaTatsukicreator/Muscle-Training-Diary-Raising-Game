export const RECORDS_PER_PAGE = 25;

/** Ignore malformed navigation input; the dashboard also clamps to available pages. */
export function parseRecordPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}
