"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { SunMoon } from "lucide-react";

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
    <NextThemeProvider attribute="class" defaultTheme="system" storageKey="k5-theme" enableSystem disableTransitionOnChange>
      <ThemeColor />
      {children}
    </NextThemeProvider>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground md:min-h-9">
      <SunMoon className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Tema</span>
      <select aria-label="Tema" value={mounted ? theme : "system"} disabled={!mounted} onChange={(event) => setTheme(event.target.value)}
        className="min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9">
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
      </select>
    </label>
  );
}
