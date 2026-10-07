"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ItemView = "grid" | "list";

const options = [
  { value: "grid", label: "Ver em grade", Icon: LayoutGrid },
  { value: "list", label: "Ver em lista", Icon: List },
] as const;

/** The board's grid and list switch: two 30px options on a sunken pill, the chosen one raised. */
export function ViewToggle({ view, onChange, className }: { view: ItemView; onChange: (view: ItemView) => void; className?: string }) {
  return (
    <div role="group" aria-label="Modo de exibição" className={cn("flex shrink-0 rounded-md bg-muted p-0.5", className)}>
      {options.map(({ value, label, Icon }) => (
        <button key={value} type="button" aria-label={label} aria-pressed={view === value} onClick={() => onChange(value)}
          className={cn("flex h-7 w-[30px] items-center justify-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring max-md:h-10 max-md:w-11",
            view === value ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground")}>
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
