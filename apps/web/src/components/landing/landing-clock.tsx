"use client";

import { useSyncExternalStore } from "react";

const zone = "America/Sao_Paulo";
const format = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hourCycle: "h23" });

// One shared minute tick for every clock on the page.
let now = 0;
function subscribe(update: () => void) {
  now = Date.now();
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => { now = Date.now(); update(); schedule(); }, 60_000 - (Date.now() % 60_000) + 50);
  };
  schedule();
  update();
  return () => window.clearTimeout(timer);
}
const read = () => now;
const readServer = () => 0;

/** São Paulo time, in the header's plain text. Empty until the browser knows the time. */
export function LandingClock({ className, label = "São Paulo" }: { className?: string; label?: string | null }) {
  const time = useSyncExternalStore(subscribe, read, readServer);
  return (
    <p className={className}>
      <time>{time ? format.format(time) : "--:--"}</time>{label && ` ${label}`}
    </p>
  );
}

/** A small line clock with hands for the footer. */
export function LandingDial({ className }: { className?: string }) {
  const time = useSyncExternalStore(subscribe, read, readServer);
  let hour = 0, minute = 0;
  if (time) {
    const values = Object.fromEntries(parts.formatToParts(time).map((part) => [part.type, part.value]));
    hour = Number(values.hour) % 12;
    minute = Number(values.minute);
  }
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" aria-hidden="true" className={className}>
      <circle cx="24" cy="24" r="22.5" strokeWidth="1" />
      <line x1="24" y1="24" x2="24" y2="12" strokeWidth="1.25" transform={`rotate(${hour * 30 + minute / 2} 24 24)`} />
      <line x1="24" y1="24" x2="24" y2="7" strokeWidth="1" transform={`rotate(${minute * 6} 24 24)`} />
    </svg>
  );
}
