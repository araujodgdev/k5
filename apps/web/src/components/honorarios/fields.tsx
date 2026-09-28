'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { honorariosOptionsDto, type HonorariosOptions } from '@/lib/honorarios/contracts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export function ReferenceSelect({ kind, value, onChange, optional = false, purpose = 'create' }: { kind: 'clients' | 'cases'; value: string; onChange: (value: string) => void; optional?: boolean; purpose?: 'create' | 'filter' }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<HonorariosOptions[typeof kind]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [status, setStatus] = useState('Carregando opções…');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('Carregando opções…');
      void honorariosCall('options', { query, limit: 100, purpose, ...(kind === 'clients' ? { clientId: value || undefined } : { caseId: value || undefined }) }, honorariosOptionsDto, controller.signal).then(result => {
        setOptions(result[kind]); setStatus(result[kind].length === 100 ? 'Mostrando até 100 resultados. Refine a busca.' : '');
        const choice = result[kind].find(option => option.id === value);
        if (choice) setSelected(choice);
      }).catch(() => { if (!controller.signal.aborted) setStatus('Não foi possível carregar as opções. Altere a busca para tentar novamente.'); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, value, purpose]);
  const choices = value && !options.some(option => option.id === value) ? [{ id: value, name: selected?.id === value ? selected.name : 'Seleção atual' }, ...options] : options;
  return <div className="grid gap-2">
    <Field label={kind === 'clients' ? 'Buscar cliente' : 'Buscar caso'}>{id => <Input id={id} className="min-h-11" value={query} onChange={event => setQuery(event.target.value)} maxLength={180} type="search" />}</Field>
    <Field label={kind === 'clients' ? 'Cliente' : 'Caso opcional'}>{id => <select id={id} className={controlClass} value={value} required={!optional} onChange={event => { const next = choices.find(option => option.id === event.target.value); if (next) setSelected(next); onChange(event.target.value); }}>
      <option value="">{optional ? kind === 'clients' ? 'Todos os clientes' : purpose === 'filter' ? 'Todos os casos' : 'Nenhum caso selecionado' : 'Selecione um cliente'}</option>
      {choices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>}</Field>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
  </div>;
}
