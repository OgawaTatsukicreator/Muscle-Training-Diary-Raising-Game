import type { Metadata } from "next";

import { ConditionalBottomNavigation } from "@/components/navigation/bottom-navigation";
import { DemoDataProvider } from "@/components/providers/demo-data-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "マソ君の日常",
    template: "%s | マソ君の日常",
  },
  description: "筋トレの記録がマソ君の成長につながる、育成型トレーニング日記。",
  applicationName: "マソ君の日常",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        <DemoDataProvider>
          {children}
          <ConditionalBottomNavigation />
        </DemoDataProvider>
      </body>
    </html>
  );
}
