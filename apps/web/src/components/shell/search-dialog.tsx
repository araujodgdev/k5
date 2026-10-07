'use client';

import { CircleHelp, Folder } from 'lucide-react';
import { useTutorial } from '@/components/onboarding-tour';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { tabOf, titleOf, type CanvasTab } from './canvas-tabs';
import type { LauncherAccess } from './launcher';
import { adminEntry, caseHref, moduleEntries, profileEntry, useOfficeCases, type ShellEntry } from './modules';
import { placeOf, type PlaceIcon } from './places';
import { useShell } from './shell-context';

function Item({ value, icon: Icon, label, onSelect }: { value: string; icon: PlaceIcon; label: string; onSelect(): void }) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="min-h-11 gap-2.5 px-2.5 text-[13.5px] md:min-h-9">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </CommandItem>
  );
}

/** Ctrl K: finds an open tab, a case, a module or the person's pages, and opens it in the canvas. */
export function SearchDialog({ open, onOpenChange, access, tabs }: { open: boolean; onOpenChange(open: boolean): void; access: LauncherAccess; tabs: readonly CanvasTab[] }) {
  const shell = useShell();
  const openTutorial = useTutorial();
  const cases = useOfficeCases(open);
  const go = (href: string, title?: string) => { onOpenChange(false); shell?.open(href, title); };
  const entries: ShellEntry[] = [...moduleEntries(access), profileEntry, ...(access.platformAdmin ? [adminEntry] : [])];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar no escritório" description="Casos, módulos e abas abertas"
      className="top-16 max-w-[calc(100%-2rem)] gap-0 rounded-xl! border-border sm:max-w-[560px] md:top-24">
      <Command className="rounded-none! p-0">
      <CommandInput placeholder="Buscar casos, módulos e abas" aria-label="Buscar casos, módulos e abas" />
      <CommandList className="max-h-[min(26rem,calc(100dvh-12rem))] p-1">
        <CommandEmpty className="py-8 text-[13.5px] text-muted-foreground">
          {cases.status === 'loading' ? 'Carregando casos…' : 'Nada encontrado.'}
        </CommandEmpty>
        <CommandGroup heading="Abas abertas">
          {tabs.map((tab) => <Item key={tabOf(tab)} value={`aba ${titleOf(tab)} ${tabOf(tab)}`} icon={placeOf(tab.href).icon} label={titleOf(tab)} onSelect={() => go(tab.href)} />)}
        </CommandGroup>
        {cases.status === 'ready' && cases.cases.length > 0 && (
          <CommandGroup heading="Casos">
            {cases.cases.map((item) => <Item key={item.id} value={`caso ${item.name} ${item.id}`} icon={Folder} label={item.name} onSelect={() => go(caseHref(item.id), item.name)} />)}
          </CommandGroup>
        )}
        {cases.status === 'error' && <p role="status" className="px-3 py-2 text-[13px] text-muted-foreground">Não foi possível carregar os casos.</p>}
        <CommandGroup heading="Módulos e conta">
          {entries.map((item) => <Item key={item.href} value={`modulo ${item.label}`} icon={item.icon} label={item.label} onSelect={() => go(item.href, item.label)} />)}
          <Item value="modulo Tutorial do Lume" icon={CircleHelp} label="Tutorial" onSelect={() => { onOpenChange(false); openTutorial(); }} />
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
