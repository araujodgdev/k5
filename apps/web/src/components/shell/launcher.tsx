'use client';

import { CircleHelp, Folder, Layers, LayoutGrid } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BetaLabel } from '@/components/ads/beta-label';
import { useTutorial } from '@/components/onboarding-tour';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { adminEntry, caseHref, moduleEntries, opensInCanvas, profileEntry, useOfficeCases, type ModuleFlags, type ShellEntry } from './modules';
import type { PlaceIcon } from './places';
import { useShell } from './shell-context';

const RECENT_CASES = 3;

export type LauncherAccess = ModuleFlags & { platformAdmin: boolean };

const rowClass = 'flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[15px] outline-none md:text-[13.5px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:min-h-[34px]';
const headingClass = 'px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground';

/** The row for the page on screen: same path, and the same view where the address names one. */
function useIsCurrent(href: string) {
  const pathname = usePathname();
  const search = useSearchParams();
  const target = new URL(href, 'http://lume.invalid');
  return target.pathname === pathname && [...target.searchParams].every(([key, value]) => search.get(key) === value);
}

function Row({ href, icon: Icon, label, beta, note, onPick }: { href: string; icon: PlaceIcon; label: string; beta?: boolean; note?: string; onPick: (href: string, title?: string) => void }) {
  const current = useIsCurrent(href);
  return (
    <a href={href} aria-current={current ? 'page' : undefined} className={cn(rowClass, current && 'bg-selected font-medium')} onClick={(event) => { if (!opensInCanvas(event)) return; event.preventDefault(); onPick(href, label); }}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      {beta && <BetaLabel className="ml-auto" />}
      {note && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{note}</span>}
    </a>
  );
}

function Group({ label, children, grid }: { label: string; children: ReactNode; grid?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <span aria-hidden="true" className={headingClass}>{label}</span>
      <div className={grid ? 'grid grid-cols-2 gap-x-0.5' : 'flex flex-col'}>{children}</div>
    </div>
  );
}

/**
 * Everything the canvas can open: the platform for its team, recent cases, the office's modules,
 * and the person's own pages. The same list fills the desktop launcher and the phone's menu.
 */
export function LauncherList({ access, active, onDone }: { access: LauncherAccess; active: boolean; onDone: () => void }) {
  const shell = useShell();
  const openTutorial = useTutorial();
  const cases = useOfficeCases(active);
  const pick = (href: string, title?: string) => { onDone(); shell?.open(href, title); };
  const modules = moduleEntries(access).filter((item) => item.href !== '/app/vault');
  const recent = cases.status === 'ready' ? cases.cases.slice(0, RECENT_CASES) : [];
  const entryRow = (item: ShellEntry) => <Row key={item.href} {...item} onPick={pick} />;

  return (
    <nav aria-label="Casos e módulos" className="flex flex-col">
      {access.platformAdmin && <Group label="Plataforma"><Row {...adminEntry} note="Só a equipe Lume" onPick={pick} /></Group>}
      <Group label="Casos">
        {recent.map((item) => <Row key={item.id} href={caseHref(item.id)} icon={Folder} label={item.name} onPick={pick} />)}
        {cases.status === 'loading' && <span role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">Carregando casos…</span>}
        {cases.status === 'error' && <span role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">Não foi possível carregar os casos.</span>}
        <Row href="/app/vault" icon={Layers} label="Todos os casos" onPick={pick} />
      </Group>
      <Group label="Módulos" grid>{modules.map(entryRow)}</Group>
      <span aria-hidden="true" className="mx-1 my-1.5 h-px bg-border" />
      <div className="grid grid-cols-2 gap-x-0.5">
        {entryRow(profileEntry)}
        <button type="button" aria-label="Tutorial do Lume" className={rowClass} onClick={() => { onDone(); openTutorial(); }}>
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />Tutorial
        </button>
      </div>
    </nav>
  );
}

/** Radix skips links when it focuses a menu on open; the launcher is mostly links, so its first place takes the focus. */
export function focusFirstPlace(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement).querySelector<HTMLElement>('a, button')?.focus();
}

/** The grid button at the start of the canvas strip and the launcher it opens under it. */
export function Launcher({ access }: { access: LauncherAccess }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span data-tutorial="trigger" className="flex">
        <PopoverTrigger asChild>
          <button type="button" aria-label="Casos e módulos" data-tutorial="navigation"
            className={cn('grid size-8 shrink-0 place-items-center rounded-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', open ? 'bg-selected text-foreground' : 'text-muted-foreground')}>
            <LayoutGrid className="size-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </span>
      <PopoverContent align="start" sideOffset={8} onOpenAutoFocus={focusFirstPlace} className="max-h-[calc(100dvh-4.5rem)] w-[360px] gap-0 overflow-y-auto rounded-lg border-border p-1.5">
        <LauncherList access={access} active={open} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
