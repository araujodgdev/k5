'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { PickerTrigger } from '@/components/ui/picker-trigger';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { legalAreas, legalAreaLabels, type CrmClient } from '@/lib/capabilities/agenda';

function searchable(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function LegalAreaPicker({ defaultValue = [], disabled, onChange }: {
  defaultValue?: CrmClient['legalAreas'];
  disabled: boolean;
  onChange: () => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState(defaultValue);
  const [query, setQuery] = useState('');
  const summary = selected.length ? selected.map(area => legalAreaLabels[area]).join(', ') : 'Selecione as áreas';
  const visible = legalAreas.filter(area => searchable(legalAreaLabels[area]).includes(searchable(query.trim())));

  return <div className="grid min-w-0 gap-1.5">
    <label htmlFor={id} className="text-xs text-muted-foreground">Áreas do direito</label>
    {selected.map(area => <input key={area} type="hidden" name="legalAreas" value={area} />)}
    <Popover onOpenChange={() => setQuery('')}>
      <PopoverTrigger asChild>
        {/* Drawn like every select (DESIGN.md, "Selects"); a long list of areas ends in an ellipsis, whole in the title. */}
        <PickerTrigger id={id} disabled={disabled} title={summary}>{summary}</PickerTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label="Selecionar áreas do direito" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)]">
        <Input aria-label="Buscar área do direito" placeholder="Buscar área" value={query} onChange={event => setQuery(event.target.value)} className="max-md:h-11" />
        <div role="group" aria-label="Áreas disponíveis" className="max-h-[min(16rem,40dvh)] overflow-y-auto">
          {visible.map(area => <label key={area} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13.5px] hover:bg-accent focus-within:bg-accent md:min-h-8">
            <input type="checkbox" checked={selected.includes(area)} disabled={disabled} className="size-4 accent-primary" onChange={event => {
              setSelected(current => event.target.checked ? [...current, area] : current.filter(value => value !== area));
              onChange();
            }} />
            {legalAreaLabels[area]}
          </label>)}
          {!visible.length && <p role="status" className="px-2 py-4 text-sm text-muted-foreground">Nenhuma área encontrada.</p>}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
