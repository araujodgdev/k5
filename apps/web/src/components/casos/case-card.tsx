"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CanvasLink } from "@/components/shell/canvas-link";
import { cn } from "@/lib/utils";
import { PeopleStack, type CasePerson } from "./people-stack";

/**
 * A case on the Casos board (`v.casos`): a 248px raised card with the name over a hairline, the
 * client and the summary, and a quiet line with the counts and the people. The name is the link
 * and stretches over the card, so a menu can sit on top of it.
 */
export function CaseCard({ href, title, icon: Icon, client, summary, footer, people = [], menu }: {
  href: string;
  title: string;
  icon: LucideIcon;
  client?: ReactNode;
  summary?: ReactNode;
  footer: ReactNode;
  people?: readonly CasePerson[];
  menu?: ReactNode;
}) {
  return (
    <div role="listitem" className={cn("group/card relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-strong md:h-[248px]",
      "has-[[data-card-action]:focus-visible]:outline-2 has-[[data-card-action]:focus-visible]:outline-offset-2 has-[[data-card-action]:focus-visible]:outline-ring")}>
      <span className="flex min-w-0 items-center gap-2 border-b border-border px-3.5 py-3">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <CanvasLink href={href} tab={title} data-card-action className={cn("min-w-0 flex-1 truncate text-sm font-medium outline-none after:absolute after:inset-0", menu && "max-md:pr-10")}>
          {title}
        </CanvasLink>
      </span>
      <span className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-3.5 max-md:pb-1">
        {client && <span className="truncate text-[12.5px] font-medium">{client}</span>}
        {summary && <span className="line-clamp-3 text-[12.5px] leading-normal break-words text-muted-foreground md:line-clamp-5">{summary}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-2 px-3.5 pt-2.5 pb-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{footer}</span>
        <PeopleStack people={people} />
      </span>
      {menu && <span className="absolute top-2 right-2 z-10 md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100 md:has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">{menu}</span>}
    </div>
  );
}

/** The board's grid of cases: 260px columns, 16px apart. */
export function CaseGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div role="list" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3 md:gap-4">{children}</div>;
}
