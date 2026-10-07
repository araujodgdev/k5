import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

function subscribe(notify: () => void) {
  const timer = window.setInterval(notify, TICK_MS);
  return () => window.clearInterval(timer);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const serverMinute = () => null;

/**
 * The browser's current minute, or null while the server renders and during hydration: dates and
 * "há 5 min" depend on the person's clock and zone, which the server does not know.
 */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, currentMinute, serverMinute);
  return minute === null ? null : new Date(minute * 60_000);
}
