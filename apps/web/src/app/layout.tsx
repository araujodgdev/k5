import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getTraceData } from "@sentry/core";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { PwaProvider } from "@/components/pwa-provider";
import { navCollapseScript } from "@/lib/nav-collapse";
import { panelScript } from "@/lib/canvas-shell/panel";
import { agentHistoryScript } from "@/lib/agent-history";
import { BootScript } from "@/components/boot-script";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

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
export const viewport: Viewport = { viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#FDFDFB" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Google requires this tag in the initial head; vinext can stream route metadata into the body.
  return <html lang="pt-BR" suppressHydrationWarning className={cn(sans.variable, mono.variable, "font-sans")}><head><meta name="google-site-verification" content="Umr2r9jGskbTkLGQ_gjOAdXTr80xWnyk8_4TIO9iWnE" /><BootScript code={agentHistoryScript + navCollapseScript + panelScript} /></head><body><ThemeProvider><PwaProvider>{children}</PwaProvider></ThemeProvider></body></html>;
}
