"use client";

import Link from "next/link";
import { useRef, type ReactNode, type RefObject } from "react";
import { Ellipsis, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CanvasPhoneActions } from "@/components/shell/phone-canvas";
import { PeopleStack, type CasePerson } from "./people-stack";

/** The judicial process shown under the client: the first active link of the case. */
export type CaseProcess = { number: string; court: string | null };

/**
 * The case's header (`v.caso`): a quiet way back to Casos, the name, who it is for and its
 * process, and on the right the people, "Compartilhar" and the case's other actions. On a phone
 * the two actions move into the shell's header (`CelularCaso`).
 */
export function CaseHeader({ title, client, note, process, people, onShare, menu, onMenuClose, menuOpenerRef }: {
  title: string;
  client: string | null;
  /** A short fact after the client, such as "compartilhado com você". */
  note?: string;
  process: CaseProcess | null;
  people: readonly CasePerson[];
  onShare: () => void;
  /** The items of "Mais opções do caso". */
  menu: ReactNode;
  onMenuClose?: (event: Event) => void;
  /** Takes the trigger that opened the menu (the phone header's or the page's), where a dialog opened from it returns focus. */
  menuOpenerRef?: RefObject<HTMLElement | null>;
}) {
  const firstLine = [client, note].filter(Boolean);
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <CanvasPhoneActions>
        <button type="button" aria-label="Compartilhar caso" onClick={onShare}
          className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
          <Share aria-hidden="true" className="size-[18px]" />
        </button>
        <CaseMenu menu={menu} onMenuClose={onMenuClose} openerRef={menuOpenerRef} />
      </CanvasPhoneActions>
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:min-w-[280px]">
        <Link href="/app/vault" className="-ml-1.5 hidden h-6 items-center self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:inline-flex">
          Casos
        </Link>
        <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] break-words md:text-[26px]">{title}</h1>
        {(firstLine.length > 0 || process) && (
          <div className="flex flex-col gap-[3px] text-[13px] text-muted-foreground">
            {firstLine.length > 0 && (
              <span className="flex flex-wrap items-center gap-x-2">
                {client && <span className="md:text-foreground">{client}</span>}
                {client && note && <span aria-hidden="true">·</span>}
                {note && <span>{note}</span>}
              </span>
            )}
            {process && (
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono text-[12.5px]">{process.number}</span>
                {process.court && <><span aria-hidden="true" className="max-md:hidden">·</span><span className="max-md:hidden">{process.court}</span></>}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="hidden items-center gap-2 md:flex">
        <PeopleStack people={people} size="lg" className="mr-1" />
        <Button type="button" variant="outline" size="lg" className="border-border-strong" onClick={onShare}><Share aria-hidden="true" className="size-3.5" />Compartilhar</Button>
        <CaseMenu menu={menu} onMenuClose={onMenuClose} openerRef={menuOpenerRef} />
      </div>
    </header>
  );
}

function CaseMenu({ menu, onMenuClose, openerRef }: { menu: ReactNode; onMenuClose?: (event: Event) => void; openerRef?: RefObject<HTMLElement | null> }) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => { if (open && openerRef) openerRef.current = trigger.current; }}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} type="button" variant="ghost" size="icon" className="size-11 text-muted-foreground md:size-[34px]" aria-label="Mais opções do caso"><Ellipsis aria-hidden="true" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" onCloseAutoFocus={onMenuClose}>{menu}</DropdownMenuContent>
    </DropdownMenu>
  );
}
