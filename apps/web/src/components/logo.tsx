import { TisesLogo, TisesMark } from "@/components/tises-logo";
import { cn } from "@/lib/utils";

/** Tises logo for compact places: the mark with its name, or the mark alone. Inherits color. */
export function Logo({ height = 20, className, markOnly = false }: { height?: number; className?: string; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} aria-hidden="true">
      {markOnly ? <TisesMark width={height} height={height} focusable="false" /> : <TisesLogo size={height} />}
    </span>
  );
}
