"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SmartOption = { id: string; label: string; description?: string; disabled?: boolean };

/**
 * The Lume mark whose three strokes trade places, forming new shapes while it is hovered or busy.
 * Same paths as <LumeMark />; the motion lives in globals.css (`.smart-mark`).
 */
export function SmartMark({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none"
    aria-hidden="true" focusable="false" className={cn("smart-mark", className)} {...props}>
    <path className="smart-mark-a" d="M5 4h3v10.5l-3 3V4Z" />
    <path className="smart-mark-b" d="m6.5 19 3-3H20v3H6.5Z" />
    <path className="smart-mark-c" d="m11 11.5 6.5-6.5L19 6.5 12.5 13 11 11.5Z" />
  </svg>;
}

/**
 * "Opções inteligentes": the Lume's actions for the current module, behind one peach mark.
 * Hover (or focus and Enter, or a tap) shows the options; each module passes its own list.
 */
export function SmartOptions({ options, onSelect, busy = false, label = "Opções inteligentes", align = "start", className }: {
  options: SmartOption[]; onSelect: (id: string) => void; busy?: boolean; label?: string; align?: "start" | "end"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const viaKeyboard = useRef(false);
  const hoverable = useRef(false);
  useEffect(() => { hoverable.current = window.matchMedia("(hover: hover)").matches; }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const schedule = (next: boolean, delay: number) => {
    if (!hoverable.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
  const onMenuKey = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) { event.preventDefault(); all[(index + move + all.length) % all.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); all[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); all.at(-1)?.focus(); }
  };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <button ref={button} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-busy={busy || undefined}
        className={cn("smart-options grid size-9 shrink-0 place-items-center text-module-lume outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:size-11", className)}
        onPointerEnter={event => { if (event.pointerType === "mouse") schedule(true, 120); }}
        onPointerLeave={event => { if (event.pointerType === "mouse") schedule(false, 220); }}
        onKeyDown={event => { if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); viaKeyboard.current = true; setOpen(true); } }}
        onClick={event => { if (event.detail === 0) return; window.clearTimeout(timer.current); setOpen(value => hoverable.current ? true : !value); }}>
        <SmartMark />
        {busy && <span className="sr-only">O Lume está trabalhando…</span>}
      </button>
    </PopoverAnchor>
    <PopoverContent align={align} sideOffset={6} className="w-72 gap-0 rounded-none p-1"
      onPointerEnter={() => schedule(true, 0)} onPointerLeave={() => schedule(false, 220)}
      // The mark is an anchor, not a Radix trigger: a tap on it toggles instead of counting as outside.
      onInteractOutside={event => { if (button.current?.contains(event.target as Node)) event.preventDefault(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (!document.activeElement || document.activeElement === document.body) button.current?.focus(); }}
      onOpenAutoFocus={event => { event.preventDefault(); if (viaKeyboard.current) requestAnimationFrame(() => items()[0]?.focus()); viaKeyboard.current = false; }}>
      <p className="label-mono flex items-center gap-2 px-3 pt-2 pb-1.5 text-subtle-foreground"><span className="square-dot text-module-lume" aria-hidden="true" />Lume</p>
      <div ref={list} role="menu" aria-label={label} onKeyDown={onMenuKey}>
        {options.map(option => <button key={option.id} type="button" role="menuitem" disabled={option.disabled}
          onClick={() => { setOpen(false); onSelect(option.id); }}
          className="hover-rise flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors duration-500 ease-(--ease) outline-none hover:text-brand-foreground focus-visible:text-brand-foreground disabled:pointer-events-none disabled:opacity-50 max-md:min-h-11">
          <span className="text-sm font-medium">{option.label}</span>
          {option.description && <span className="text-xs text-muted-foreground transition-colors duration-500 ease-(--ease) [button:hover>&]:text-brand-foreground/80 [button:focus-visible>&]:text-brand-foreground/80">{option.description}</span>}
        </button>)}
      </div>
    </PopoverContent>
  </Popover>;
}
