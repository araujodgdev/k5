"use client";

import { LiveLumeMark } from "@/components/live-lume-mark";
import { useShell } from "@/components/shell/shell-context";

/** The board's `casoStrip`: while the Lume works on this case, a tinted line under the case's header says so. */
export function CaseStrip({ caseId }: { caseId: string }) {
  const shell = useShell();
  const activity = shell?.activity;
  if (!shell || !activity || activity.state === "idle" || activity.caseId !== caseId) return null;
  const attention = activity.state === "attention";
  return (
    <div role="status" className="flex min-h-[42px] items-center gap-2.5 rounded-[10px] bg-brand-soft px-3 py-2">
      <LiveLumeMark state={attention ? "attention" : "working"} className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1 text-[13.5px]">{attention ? "O Lume precisa de você para continuar neste caso." : "O Lume está trabalhando neste caso."}</span>
      {shell.panel === "collapsed" && (
        <button type="button" onClick={() => shell.setPanel("open")}
          className="h-7 shrink-0 rounded-sm px-2.5 text-[13px] font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring max-md:h-11">
          Acompanhar
        </button>
      )}
    </div>
  );
}
