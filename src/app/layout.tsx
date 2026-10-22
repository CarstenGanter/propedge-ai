import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { THEME_INIT_SCRIPT } from "@/components/themeScript";
import { InlineScript } from "@/components/InlineScript";
import { cn } from "@/lib/utils/cn";

// One family: Geist for text, Geist Mono for figures that must line up.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PropEdge AI — Sports Prop Research",
  description:
    "Local-first sports prop research dashboard. Research, rank, track and review daily player props. Not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={cn(geistSans.variable, geistMono.variable)}>
      <head>
        {/* Applies a saved theme before first paint, so a light-theme choice never flashes dark. */}
        <InlineScript html={THEME_INIT_SCRIPT} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
