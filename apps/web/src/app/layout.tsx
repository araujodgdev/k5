import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "K5", template: "%s | K5" },
  description: "O espaço de trabalho do seu escritório.",
  robots: { index: false, follow: false },
};

// `resizes-content` keeps the docked composer above the on-screen keyboard.
export const viewport: Viewport = { viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={cn(sans.variable, serif.variable, "font-sans")}><body>{children}</body></html>;
}
