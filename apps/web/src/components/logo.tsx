import { LumeMark } from "@/components/lume-mark";
import { cn } from "@/lib/utils";

/** Lume wordmark. Inherits color and keeps the geometric mark tied to its name. */
export function Logo({ height = 20, className, markOnly = false }: { height?: number; className?: string; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} style={{ gap: height * 0.32 }} aria-hidden="true">
      <LumeMark width={height} height={height} focusable="false" />
      {!markOnly && <span className="font-serif leading-none" style={{ fontSize: height * 1.18 }}>Lume</span>}
    </span>
  );
}
