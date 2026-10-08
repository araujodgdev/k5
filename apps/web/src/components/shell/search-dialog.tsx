'use client';

import { useEffect, useState } from 'react';
import type { OfficeSearchHit } from '@/lib/office-search-contract';
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
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<{ query: string; hits: OfficeSearchHit[]; error: boolean } | null>(null);
  const [opened,setOpened] = useState(open);
  if (opened !== open) { setOpened(open); setQuery(''); setRemote(null); }
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch('/api/search?q=' + encodeURIComponent(query.trim()), { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json() as { hits: OfficeSearchHit[] };
        if (!controller.signal.aborted) setRemote({query,hits:result.hits,error:false});
      }).catch(() => { if (!controller.signal.aborted) setRemote({query,hits:[],error:true}); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open,query]);
  const results = remote?.query === query ? remote : null;
  const go = (href: string, title?: string) => { onOpenChange(false); shell?.open(href, title); };
  const entries: ShellEntry[] = [...moduleEntries(access), profileEntry, ...(access.platformAdmin ? [adminEntry] : [])];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar no escritório" description="Casos, módulos e abas abertas"
      className="top-16 max-w-[calc(100%-2rem)] gap-0 rounded-xl! border-border sm:max-w-[560px] md:top-24">
      <Command className="rounded-none! p-0">
      <CommandInput value={query} onValueChange={setQuery} placeholder="Buscar casos, módulos e abas" aria-label="Buscar casos, módulos e abas" />
      <CommandList className="max-h-[min(26rem,calc(100dvh-12rem))] p-1">
        <CommandEmpty className="py-8 text-[13.5px] text-muted-foreground">
          {cases.status === 'loading' ? 'Carregando casos…' : 'Nada encontrado.'}
        </CommandEmpty>
        {query.trim().length >= 2 && <>
          {!results && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>}
          {results?.error && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Não foi possível buscar. Tente novamente.</p>}
          <CommandGroup heading="Resultados do escritório">
          {results?.hits.map(hit => <Item key={hit.kind + hit.id} value={query + ' ' + hit.kind + ' ' + hit.id} icon={placeOf(hit.href).icon} label={hit.label} onSelect={() => go(hit.href,hit.label)} />)}
          </CommandGroup>
          {results && !results.error && !results.hits.length && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Nenhum resultado no escritório.</p>}
        </>}
        <CommandGroup heading="Abas abertas">
          {tabs.map((tab) => <Item key={tabOf(tab)} value={`aba ${titleOf(tab)} ${tabOf(tab)}`} icon={placeOf(tab.href).icon} label={titleOf(tab)} onSelect={() => go(tab.href)} />)}
        </CommandGroup>
        {cases.status === 'ready' && cases.cases.length > 0 && (
          <CommandGroup heading="Casos">
            {cases.cases.filter(item => !results?.hits.some(hit => hit.kind === 'case' && hit.id === item.id)).map((item) => <Item key={item.id} value={`caso ${item.name} ${item.id}`} icon={Folder} label={item.name} onSelect={() => go(caseHref(item.id), item.name)} />)}
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
