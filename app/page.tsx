import { connection } from "next/server";

import { HomeDashboard } from "@/components/home/home-dashboard";
import { dateKeyInTimeZone } from "@/lib/domain/date";

export default async function HomePage() {
  await connection();

  return <HomeDashboard today={dateKeyInTimeZone()} />;
}
