import type { Metadata } from "next";

import { RecordsDashboard } from "@/components/records/records-dashboard";
import { dateKeyInTimeZone, isDateKey } from "@/lib/domain/date";

export const metadata: Metadata = {
  title: "記録",
};

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string | string[];
    saved?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const candidate = typeof params.date === "string" ? params.date : "";
  const today = dateKeyInTimeZone();
  const initialDate = isDateKey(candidate) && candidate <= today ? candidate : today;
  const initialView = isDateKey(candidate) && candidate <= today ? "day" : "calendar";

  return (
    <RecordsDashboard
      initialDate={initialDate}
      initialView={initialView}
      showSavedMessage={params.saved === "1"}
    />
  );
}
