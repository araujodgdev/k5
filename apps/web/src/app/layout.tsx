import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import { getTraceData } from "@sentry/core";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { PwaProvider } from "@/components/pwa-provider";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });

const metadata: Metadata = {
  title: { default: "Lume", template: "%s | Lume" },
  description: "O espaço de trabalho do seu escritório.",
  robots: { index: false, follow: false },
  applicationName: "Lume",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Lume" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Next.js injects trace metadata automatically; vinext needs the explicit bridge.
export function generateMetadata(): Metadata {
  return process.env.K5_RUNTIME === 'cloudflare'
    ? { ...metadata, other: { ...getTraceData() } }
    : metadata;
}

// `resizes-content` keeps the docked composer above the on-screen keyboard.
export const viewport: Viewport = { viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" suppressHydrationWarning className={cn(sans.variable, serif.variable, "font-sans")}><body><ThemeProvider><PwaProvider>{children}</PwaProvider></ThemeProvider></body></html>;
}
