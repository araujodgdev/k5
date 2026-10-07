"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#1A1918" : "#FDFDFB");
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="light" storageKey="k5-theme" enableSystem disableTransitionOnChange>
      <ThemeColor />
      {children}
    </NextThemeProvider>
  );
}

/** The theme on screen and the switch to the other one; nothing is known before hydration. */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  return { mounted, dark, label: dark ? "Usar tema claro" : "Usar tema escuro", toggle: () => setTheme(dark ? "light" : "dark") };
}

/** One icon: it shows where a click takes you, and flips between light and dark. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { mounted, dark, label, toggle } = useThemeToggle();
  return (
    <Button type="button" variant="ghost" size="icon" disabled={!mounted} onClick={toggle}
      aria-label={label} title={label} className={cn("size-11 text-muted-foreground hover:text-foreground md:size-9", className)}>
      {/* Two dots, one hollow and one filled: the filled one slides to the side the theme is on. */}
      <span aria-hidden="true" className="relative block h-3 w-[1.625rem]">
        <span className="absolute top-0 left-0 size-3 rounded-full border border-current" />
        <span className="absolute top-0 right-0 size-3 rounded-full border border-current" />
        <span className={cn("absolute top-0 left-0 size-3 rounded-full bg-current transition-transform duration-500 ease-(--ease)", dark && "translate-x-3.5")} />
      </span>
    </Button>
  );
}
