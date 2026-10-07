/** A run's length as the prototype writes it: "820 ms", "41s", "1m 58s"; "—" while it is still running. */
export function elapsed(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
