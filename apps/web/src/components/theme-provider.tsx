"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#20201e" : "#ffffff");
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="dark" storageKey="k5-theme" enableSystem disableTransitionOnChange>
      <ThemeColor />
      {children}
    </NextThemeProvider>
  );
}

/** One icon: it shows where a click takes you, and flips between light and dark. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = !mounted || resolvedTheme !== "light";
  const label = dark ? "Usar tema claro" : "Usar tema escuro";
  return (
    <Button type="button" variant="ghost" size="icon" disabled={!mounted} onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label} title={label} className={cn("size-11 text-muted-foreground hover:text-foreground md:size-9", className)}>
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
