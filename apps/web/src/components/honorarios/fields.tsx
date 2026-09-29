'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { honorariosOptionsDto, type HonorariosOptions } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PickerTrigger } from '@/components/ui/picker-trigger';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { honorariosCall } from './client';

export const controlClass = 'min-h-11 w-full min-w-0 border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
export const dialogClass = 'max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl [&>[data-slot=dialog-close]]:size-11';

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="grid min-w-0 gap-1.5"><Label htmlFor={id}>{label}</Label>{children(id)}</div>;
}

export function Failure({ message }: { message: string }) {
  return message ? <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{message}</p> : null;
}

type Reference = { id: string; name: string };

/**
 * One field per choice: the trigger looks like a select and opens a search with the matching
 * clients or cases, so typing filters what is shown right there instead of in a second control.
 */
export function ReferenceSelect({ kind, value, onChange, optional = false, purpose = 'create', error = '' }: { kind: 'clients' | 'cases'; value: string; onChange: (value: string) => void; optional?: boolean; purpose?: 'create' | 'filter'; error?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Reference[]>([]);
  const [selected, setSelected] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const known = !value || selected?.id === value;
  const clients = kind === 'clients';
  const label = clients ? 'Cliente' : purpose === 'filter' ? 'Caso' : 'Caso (opcional)';
  const emptyLabel = clients ? optional ? 'Todos os clientes' : 'Selecione um cliente' : purpose === 'filter' ? 'Todos os casos' : 'Nenhum caso';
  // Loads while the list is open, and once for a value that arrived without its name (a filter
  // taken from the address, for example).
  useEffect(() => {
    if (!open && known) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setStatus('');
      void honorariosCall('options', { query: open ? query : '', limit: 100, purpose, ...(clients ? { clientId: value || undefined } : { caseId: value || undefined }) }, honorariosOptionsDto, controller.signal).then(result => {
        const rows: HonorariosOptions[typeof kind] = result[kind];
        setOptions(rows); setStatus(rows.length === 100 ? 'Mostrando até 100 resultados. Refine a busca.' : '');
        const choice = rows.find(option => option.id === value);
        if (choice) setSelected(choice);
      }).catch(() => { if (!controller.signal.aborted) setStatus('Não foi possível carregar as opções. Altere a busca para tentar novamente.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, open ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, known, query, kind, clients, value, purpose]);
  function choose(option: Reference | null) {
    setSelected(option); onChange(option?.id ?? ''); setOpen(false); setQuery('');
  }
  const current = value ? selected?.id === value ? selected.name : 'Seleção atual' : emptyLabel;
  return <div className="grid min-w-0 gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><PickerTrigger id={id} className="h-11 md:h-11" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>{current}</PickerTrigger></PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 max-w-[calc(100vw-2rem)] p-3" aria-label={label}>
        <Input autoFocus type="search" className="min-h-11" aria-label={clients ? 'Buscar cliente pelo nome' : 'Buscar caso pelo nome'} placeholder={clients ? 'Buscar cliente' : 'Buscar caso'} maxLength={180} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="max-h-64 overflow-y-auto">
          {optional && <Button type="button" variant="ghost" className="min-h-11 w-full justify-start font-normal" aria-pressed={!value} onClick={() => choose(null)}>{emptyLabel}</Button>}
          {options.map(option => <Button key={option.id} type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left font-normal" aria-pressed={value === option.id} onClick={() => choose(option)}>{option.name}</Button>)}
          {!options.length && <p role="status" className="py-3 text-sm text-muted-foreground">{loading ? 'Carregando opções…' : status || (clients ? 'Nenhum cliente encontrado.' : 'Nenhum caso encontrado.')}</p>}
        </div>
        {options.length > 0 && status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      </PopoverContent>
    </Popover>
    {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
  </div>;
}
