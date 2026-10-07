"use client";

import { LiveLumeMark } from "@/components/live-lume-mark";
import { useShell } from "@/components/shell/shell-context";

/** The brand-tinted line over the sections while the Lume works in the administration or waits for a confirmation. */
export function AdminLumeStrip() {
  const activity = useShell()?.activity;
  if (!activity || activity.state === "idle" || activity.caseId) return null;
  const working = activity.state === "working";
  return (
    <div role="status" className="flex min-h-[42px] items-center gap-2.5 rounded-[10px] bg-brand-soft px-3 py-2">
      <LiveLumeMark state={working ? "working" : "attention"} width={18} height={18} className="shrink-0" />
      <span className="flex-1 text-[13.5px]">{working ? "O Lume está trabalhando." : "O Lume precisa da sua confirmação no painel."}</span>
    </div>
  );
}
