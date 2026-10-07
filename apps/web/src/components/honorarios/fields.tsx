'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { honorariosOptionsDto, type HonorariosOptions } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PickerTrigger } from '@/components/ui/picker-trigger';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Chip } from '@/components/canvas/canvas-controls';
import { honorariosCall } from './client';

export const controlClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-9 md:text-[13.5px]';
export const dialogClass = 'sm:max-w-[600px]';

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="grid min-w-0 gap-1.5"><label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>{children(id)}</div>;
}

export function Failure({ message }: { message: string }) {
  return message ? <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{message}</p> : null;
}

type Reference = { id: string; name: string };

/**
 * One field per choice: the trigger looks like a select and opens a search with the matching
 * clients or cases, so typing filters what is shown right there instead of in a second control.
 */
export function ReferenceSelect({ kind, value, onChange, optional = false, purpose = 'create', error = '', variant = 'field' }: {
  kind: 'clients' | 'cases'; value: string; onChange: (value: string) => void; optional?: boolean; purpose?: 'create' | 'filter'; error?: string;
  /** `chip` draws the closed choice as a filter chip of the module toolbar, without the label above it. */
  variant?: 'field' | 'chip';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Reference[]>([]);
  const [selected, setSelected] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const known = !value || selected?.id === value;
  const clients = kind === 'clients';
  const openedAt = useRef(0);
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
    }, open && query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, known, query, kind, clients, value, purpose]);
  function choose(option: Reference | null) {
    setSelected(option); onChange(option?.id ?? ''); setOpen(false); setQuery('');
  }
  function changeOpen(next: boolean) {
    // The opening click was also dismissing the list, before the cases request left, so the option never appeared.
    if (next) openedAt.current = performance.now();
    else if (performance.now() - openedAt.current < 250) return;
    setOpen(next);
  }
  const current = value ? selected?.id === value ? selected.name : 'Seleção atual' : emptyLabel;
  const chip = variant === 'chip';
  return <div className={chip ? 'contents' : 'grid min-w-0 gap-1.5'}>
    {/* The trigger is a button, which cannot be required; the label says it instead. */}
    {!chip && <label htmlFor={id} className="text-xs text-muted-foreground">{label}{!optional && <span className="sr-only"> (obrigatório)</span>}</label>}
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{chip
        ? <Chip id={id} menu pressed={Boolean(value)} aria-label={`${label}: ${current}`}><span className="max-w-48 truncate">{value ? `${label}: ${current}` : label}</span></Chip>
        : <PickerTrigger id={id} className="h-11 md:h-9" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}>{current}</PickerTrigger>}</PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 max-w-[calc(100vw-2rem)] p-3" aria-label={label} onFocusOutside={event => {
        const target = event.target;
        if (target instanceof Element && target.closest('[data-slot="popover-trigger"]')) event.preventDefault();
      }}>
        <Input autoFocus type="search" className="max-md:h-11" aria-label={clients ? 'Buscar cliente pelo nome' : 'Buscar caso pelo nome'} placeholder={clients ? 'Buscar cliente' : 'Buscar caso'} maxLength={180} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="max-h-64 overflow-y-auto">
          {optional && <Button type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start font-normal md:min-h-8" aria-pressed={!value} onClick={() => choose(null)}>{emptyLabel}</Button>}
          {options.map(option => <Button key={option.id} type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left font-normal md:min-h-8" aria-pressed={value === option.id} onClick={() => choose(option)}>{option.name}</Button>)}
          {!options.length && <p role="status" className="py-3 text-sm text-muted-foreground">{loading ? 'Carregando opções…' : status || (clients ? 'Nenhum cliente encontrado.' : 'Nenhum caso encontrado.')}</p>}
        </div>
        {options.length > 0 && status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      </PopoverContent>
    </Popover>
    {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
  </div>;
}
