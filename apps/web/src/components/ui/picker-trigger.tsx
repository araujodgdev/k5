import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The closed state of a searchable picker. It is drawn exactly like a native select (globals.css,
 * "One select for the whole app"): `input` outline, text 10px in, the same chevron 10px from the edge.
 */
function PickerTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="picker-trigger"
      className={cn(
        "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:h-9",
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

export { PickerTrigger }
