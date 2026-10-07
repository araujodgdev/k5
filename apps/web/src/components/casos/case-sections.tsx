"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CaseSection = "all" | "pages" | "files" | "tasks" | "fees" | "processes" | "references" | "annexes";

export const caseSectionLabels: Record<CaseSection, string> = {
  all: "Tudo", pages: "Páginas", files: "Arquivos", tasks: "Tarefas", fees: "Honorários",
  processes: "Processos", references: "Referências", annexes: "Anexos",
};

/**
 * The case's sections (`secoes`): 40px text tabs over a hairline, the chosen one in ink with a
 * 2px underline, a mono count where the section has one. They scroll sideways on a phone.
 */
export function CaseSections({ sections, current, onChange, actions }: {
  sections: readonly { id: CaseSection; count?: number }[];
  current: CaseSection;
  onChange: (section: CaseSection) => void;
  /** Tools for the open section, at the end of the line on a desktop. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end md:flex-nowrap md:gap-3 md:border-b md:border-border">
      <nav aria-label="Seções do caso" className="flex w-full min-w-0 gap-4 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none] md:-mb-px md:w-auto md:flex-1 md:gap-5 md:border-b-0">
        {sections.map(({ id, count }) => (
          <button key={id} type="button" aria-pressed={id === current} onClick={() => onChange(id)}
            className={cn("flex h-11 shrink-0 items-center rounded-t-sm text-[14px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:h-10 md:text-[13.5px]",
              id === current ? "font-medium text-foreground shadow-[inset_0_-2px_0_var(--foreground)]" : "text-muted-foreground hover:text-foreground")}>
            {caseSectionLabels[id]}
            {count !== undefined && <span className="ml-1.5 font-mono text-[12.5px] font-normal text-muted-foreground max-md:hidden">{count}</span>}
          </button>
        ))}
      </nav>
      {actions && <div className="flex w-full shrink-0 flex-wrap items-center gap-2 pt-3 md:w-auto md:gap-1 md:pt-0 md:pb-1.5">{actions}</div>}
    </div>
  );
}
