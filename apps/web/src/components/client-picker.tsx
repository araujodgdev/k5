'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { agendaCall, type Choice } from '@/lib/agenda-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { CrmClient } from '@/lib/capabilities/agenda';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** Only an opened picker fetches a page. Selecting a client never needs the full CRM. */
export function ClientPicker({ value, onChange, choices, label, emptyLabel = 'Sem vínculo', name }: {
  value: string; onChange: (id: string, client?: CrmClient) => void; choices: Choice[];
  label: string; emptyLabel?: string; name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<CrmClient[]>([]);
  const [selected, setSelected] = useState<Choice | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open || query !== search) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError('');
      try {
        const result = await agendaCall('k5_crm_list_clients', { query: search, limit: 25, offset });
        if (!cancelled) { setRows(result.clients); setTotal(result.total); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível buscar clientes.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [open, query, search, offset, revision]);
  useEffect(() => {
    if (!value || choices.some(choice => choice.id === value)) return;
    let cancelled = false;
    void agendaCall('k5_crm_get_client', { clientId: value }).then(({ client }) => {
      if (!cancelled) setSelected(client);
    }).catch(() => { /* Keep the selected ID even if its label is unavailable. */ });
    return () => { cancelled = true; };
  }, [value, choices]);
  const selectedName = choices.find(choice => choice.id === value)?.name ?? (selected?.id === value ? selected.name : 'Cliente selecionado');
  function choose(client?: CrmClient) {
    setSelected(client ?? null); onChange(client?.id ?? '', client); setOpen(false);
  }
  return <>
    {name && <input type="hidden" name={name} value={value} />}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button id={name} type="button" variant="outline" aria-label={label} className="h-11 w-full min-w-0 justify-between font-normal md:h-9"><span className="truncate">{value ? selectedName : emptyLabel}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3" aria-label={label}>
        <Input aria-label="Buscar cliente pelo nome" placeholder="Buscar cliente" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} />
        <div className="mt-2 max-h-64 overflow-y-auto">
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => choose()}>{emptyLabel}</Button>
          {loading ? <p role="status" className="py-4 text-sm text-muted-foreground">Buscando clientes…</p> : error ? <div className="py-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="ghost" onClick={() => setRevision(current => current + 1)}>Tentar novamente</Button></div> : rows.length ? rows.map(client => <Button key={client.id} type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left font-normal" aria-pressed={value === client.id} onClick={() => choose(client)}>{client.name}</Button>) : <p className="py-4 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
        </div>
        {!error && total > 25 && <div className="mt-2 flex items-center justify-between border-t pt-2"><Button type="button" variant="ghost" disabled={loading || offset === 0} onClick={() => setOffset(current => current - 25)}>Anterior</Button><span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + 25, total)} de {total}</span><Button type="button" variant="ghost" disabled={loading || offset + 25 >= total} onClick={() => setOffset(current => current + 25)}>Próxima</Button></div>}
      </PopoverContent>
    </Popover>
  </>;
}
