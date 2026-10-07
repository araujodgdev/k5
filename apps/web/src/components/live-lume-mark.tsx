"use client";

import { useId, type SVGProps } from "react";
import { LUME_MARK } from "@/components/lume-mark";
import { cn } from "@/lib/utils";

/**
 * What the Lume is doing, as its mark shows it: `still` (at rest), `idle` (a rare glint), `working`
 * (light flows through the beam) and `attention` (the beam pulses until the person answers).
 * The motion for each state lives in globals.css (`.lume-mark`).
 */
export type LumeMarkState = "still" | "idle" | "working" | "attention";

export function LiveLumeMark({ state, className, ...props }: { state: LumeMarkState } & SVGProps<SVGSVGElement>) {
  // Ids must be unique per mark and valid inside url(#…).
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const beamId = `lume-beam-${id}`;
  const lightId = `lume-light-${id}`;
  const labelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={LUME_MARK.viewBox} width="24" height="24" fill="currentColor"
      role={labelled ? "img" : undefined} aria-hidden={labelled ? undefined : true} {...props}
      data-state={state} className={cn("lume-mark", className)}>
      <defs>
        <clipPath id={beamId}><path d={LUME_MARK.beam} /></clipPath>
        <linearGradient id={lightId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopOpacity="0" style={{ stopColor: "var(--brand)" }} />
          <stop offset=".5" stopOpacity="1" style={{ stopColor: "var(--brand)" }} />
          <stop offset="1" stopOpacity="0" style={{ stopColor: "var(--brand)" }} />
        </linearGradient>
      </defs>
      <path className="lume-mark-glow" d={LUME_MARK.beam} />
      <g clipPath={`url(#${beamId})`}>
        <g transform="rotate(15.5 49 48.8)">
          <rect className="lume-mark-band" x="9" y="35.8" width="80" height="26" fill={`url(#${lightId})`} />
        </g>
      </g>
      {LUME_MARK.halves.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
