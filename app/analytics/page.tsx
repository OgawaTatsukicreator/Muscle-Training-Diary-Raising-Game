import type { Metadata } from "next";
import { connection } from "next/server";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { dateKeyInTimeZone } from "@/lib/domain/date";

export const metadata: Metadata = {
  title: "履歴分析",
};

export default async function AnalyticsPage() {
  await connection();

  return <AnalyticsDashboard today={dateKeyInTimeZone()} />;
}
