"use client";

import { History, Layers, PanelLeft, SquarePen } from "lucide-react";
import { LiveLumeMark, type LumeMarkState } from "@/components/live-lume-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ghost = "grid size-8 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-selected aria-expanded:text-foreground max-md:size-11";

function HeaderButton({ label, onClick, expanded, controls, className, children }: {
  label: string; onClick: () => void; expanded?: boolean; controls?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onClick} className={cn(ghost, className)}>{children}</button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The panel's header: the mark shows what the Lume is doing and the line beside "Lume" says it.
 * On a computer the last button folds the panel into the mark; on a phone the panel fills the
 * screen and that button opens the canvas over it.
 */
export function PanelHeader({ mark, status, historyOpen, onHistory, onNew, onCollapse }: {
  mark: LumeMarkState;
  status: string;
  historyOpen: boolean;
  onHistory: () => void;
  onNew: () => void;
  onCollapse?: () => void;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 pr-2.5 pl-3.5 max-md:h-14 max-md:border-b max-md:border-border max-md:pr-1.5 max-md:pl-4">
      <LiveLumeMark state={mark} width={22} height={22} className="shrink-0 max-md:size-6" />
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] max-md:text-base">Lume</h2>
      <span aria-live="polite" className="min-w-0 truncate text-[12.5px] text-muted-foreground">{status}</span>
      <span className="flex-1" />
      <HeaderButton label="Conversas anteriores" onClick={onHistory} expanded={historyOpen} controls={historyOpen ? "lume-history" : undefined}><History className="size-4" /></HeaderButton>
      <HeaderButton label="Nova conversa" onClick={onNew}><SquarePen className="size-4" /></HeaderButton>
      {onCollapse && <>
        <HeaderButton label="Recolher o Lume" onClick={onCollapse} className="max-md:hidden"><PanelLeft className="size-4" /></HeaderButton>
        <HeaderButton label="Abrir o canvas do escritório" onClick={onCollapse} className="md:hidden"><Layers className="size-5" /></HeaderButton>
      </>}
    </header>
  );
}
