"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LumeMark } from "@/components/lume-mark";
import { cn } from "@/lib/utils";

/** What the top of a card draws: a page's first lines, a sheet of paper, a set of images or a folder. */
export type ItemPreview = { kind: "page"; lines: readonly string[] } | { kind: "paper" } | { kind: "images" } | { kind: "folder" };

/** Where the card leads: a route in the same tab, a canvas tab of its own, or the file's download. */
export type ItemAction = { kind: "route"; href: string } | { kind: "tab"; href: string; tab: string } | { kind: "file"; href: string };

const paperLines = ["w-full", "w-[92%]", "w-[96%]", "w-[70%]", "w-[88%]"];
const imageTiles = ["bg-border-strong", "bg-border", "bg-border-strong", "bg-border", "bg-border-strong", "bg-border"];

function Preview({ title, preview }: { title: string; preview: ItemPreview }) {
  switch (preview.kind) {
    case "page":
      return (
        <span className="flex w-full flex-col gap-1.5 rounded-t-sm bg-card px-3 pt-3 text-[10.5px] leading-[1.45] text-muted-foreground">
          <span className="truncate text-[11.5px] font-semibold text-foreground">{title}</span>
          {preview.lines.map((line, index) => <span key={index} className="truncate">{line}</span>)}
        </span>
      );
    case "paper":
      return (
        <span className="mx-auto flex w-[72%] flex-col gap-[7px] rounded-t-[4px] bg-card px-3 pt-3.5 shadow-[0_0_0_1px_var(--border)]">
          <span className="h-[5px] w-[60%] rounded-[2px] bg-border-strong" />
          {paperLines.map((width) => <span key={width} className={cn("h-1 rounded-[2px] bg-border", width)} />)}
        </span>
      );
    case "images":
      return (
        <span className="grid w-full grid-cols-3 gap-1 pb-3.5">
          {imageTiles.map((tone, index) => <span key={index} className={cn("rounded-[4px]", tone)} />)}
        </span>
      );
    case "folder":
      return (
        <span className="mx-auto flex w-[72%] flex-col pt-1">
          <span className="h-2.5 w-[38%] rounded-t-[4px] bg-border-strong" />
          <span className="flex flex-1 flex-col gap-[7px] rounded-tr-[4px] bg-card px-3 pt-3.5 shadow-[0_0_0_1px_var(--border)]">
            <span className="h-1 w-[52%] rounded-[2px] bg-border" />
            <span className="h-1 w-[34%] rounded-[2px] bg-border" />
          </span>
        </span>
      );
  }
}

/**
 * One item of a case: on a desktop the board's card (a 118px preview over the name and a quiet
 * line), on a phone the board's row (a 36px tile beside them). The name is the link and stretches
 * over the whole item, so a menu can sit on top of it.
 */
export function ItemCard({ title, meta, alert = false, icon: Icon, preview, lume = false, action, menu }: {
  title: string;
  meta: ReactNode;
  /** The second line reports a failure. */
  alert?: boolean;
  icon: LucideIcon;
  preview: ItemPreview;
  /** Made by the Lume, as the data records it: the board's "Lume" tag. */
  lume?: boolean;
  action: ItemAction;
  menu?: ReactNode;
}) {
  const linkClass = "min-w-0 truncate text-[14.5px] font-medium outline-none after:absolute after:inset-0 md:text-[13.5px]";
  const link = action.kind === "file" ? <a href={action.href} aria-label={`Baixar ${title}`} data-card-action className={linkClass}>{title}</a>
    : <Link href={action.href} data-card-action className={linkClass}>{title}</Link>;
  return (
    <div role="listitem" className={cn("group/card relative -mx-2 flex min-h-14 min-w-0 items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-accent",
      "has-[[data-card-action]:focus-visible]:outline-2 has-[[data-card-action]:focus-visible]:outline-offset-2 has-[[data-card-action]:focus-visible]:outline-ring",
      "md:mx-0 md:min-h-0 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-lg md:border md:border-border md:bg-card md:p-0 md:hover:border-border-strong md:hover:bg-card")}>
      <span aria-hidden="true" className="relative hidden h-[118px] w-full overflow-hidden bg-canvas px-4 pt-3.5 md:flex">
        <Preview title={title} preview={preview} />
        {lume && (
          <span className="absolute top-2 right-2 flex h-[22px] items-center gap-[5px] rounded-sm bg-card px-2 text-[11.5px] font-medium text-foreground shadow-[0_0_0_1px_var(--border)]">
            <LumeMark className="size-3" />Lume
          </span>
        )}
      </span>
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-canvas text-muted-foreground md:hidden"><Icon className="size-4" /></span>
      <span className={cn("flex min-w-0 flex-1 flex-col gap-px md:gap-[3px] md:px-3 md:pt-2.5 md:pb-3", menu && "max-md:pr-10")}>
        <span className="flex min-w-0 items-center gap-[7px]">
          <Icon aria-hidden="true" className="hidden size-3.5 shrink-0 text-muted-foreground md:block" />
          {link}
        </span>
        <span className={cn("flex min-w-0 items-center gap-1.5 text-[12.5px] md:text-xs", alert ? "text-destructive" : "text-muted-foreground")}>
          {lume && <LumeMark aria-hidden="true" className="size-3 shrink-0 text-foreground md:hidden" />}
          <span className="truncate">{meta}</span>
        </span>
      </span>
      {menu && (
        <span className="absolute top-1/2 right-0 z-10 -translate-y-1/2 md:top-2 md:right-2 md:translate-y-0 md:opacity-0 md:group-focus-within/card:opacity-100 md:group-hover/card:opacity-100 md:has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">
          {menu}
        </span>
      )}
    </div>
  );
}

/** The ••• of an item: 44px on a phone, a small chip over the preview on a desktop. */
export function ItemMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={cn("flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          "md:h-[26px] md:w-[30px] md:rounded-sm md:bg-card md:shadow-[0_0_0_1px_var(--border)]")}>
          <Ellipsis aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The board's grid of items: 210px columns, 14px apart; one column of rows on a phone. */
export function ItemGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div role="list" aria-label={label} className="flex flex-col md:grid md:grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))] md:gap-3.5">{children}</div>;
}
