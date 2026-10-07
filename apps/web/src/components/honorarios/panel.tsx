'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, Plus, Wallet, X } from 'lucide-react';
import { honorariosListDto, type HonorarioInstallment, type HonorariosList } from '@/lib/honorarios/contracts';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import { Chip } from '@/components/canvas/canvas-controls';
import { EmptyRows, RowsLoading } from '@/components/agenda-rows';
import { FilterMenu, SearchField } from '@/components/agenda-filters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { honorariosCall } from './client';
import { CreateHonorarioDialog } from './create-dialog';
import { DetailHonorarioDialog } from './detail-dialog';
import { money } from './editor';
import { Failure, ReferenceSelect } from './fields';

type View = 'pending' | 'received' | 'cancelled';
type Load = { kind: 'loading' } | { kind: 'ready'; data: HonorariosList } | { kind: 'error'; message: string };
type DialogState = { kind: 'closed' } | { kind: 'create' } | { kind: 'detail'; agreementId: string; today: string };
type Due = { from: string; to: string };
const views = [{ value: 'pending', label: 'A receber' }, { value: 'received', label: 'Recebidas' }, { value: 'cancelled', label: 'Canceladas' }] as const;
const empty: Record<View, string> = {
  pending: 'Nenhuma parcela a receber para estes filtros.',
  received: 'Nenhuma parcela recebida para estes filtros.',
  cancelled: 'Nenhuma parcela cancelada para estes filtros.',
};
const pageSize = 30;
const shortDate = (day: string) => day.split('-').reverse().slice(0, 2).join('/');
const fullDate = (day: string) => day.split('-').reverse().join('/');
const saoPauloToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** One installment as a module row: the client, which installment of what, the amount and when. */
function InstallmentRow({ row, view, onOpen }: { row: HonorarioInstallment; view: View; onOpen: () => void }) {
  const which = row.installmentCount === 1 ? 'Parcela única' : `Parcela ${row.number} de ${row.installmentCount}`;
  const partial = view === 'pending' && row.receivedCents > 0 ? `recebido ${money(row.receivedCents)}` : '';
  const status = view === 'received' ? `recebida · venc. ${shortDate(row.dueOn)}`
    : view === 'cancelled' ? `cancelada · venc. ${shortDate(row.dueOn)}`
    : `${row.overdue ? 'venceu' : 'vence'} ${shortDate(row.dueOn)}`;
  return <CanvasRow stacked icon={view === 'received' ? <Check /> : view === 'cancelled' ? <X /> : <Wallet />}
    title={row.clientName} detail={[which, row.title, row.caseName, partial].filter(Boolean).join(' · ')}
    meta={money(view === 'cancelled' ? row.amountCents : view === 'received' ? row.receivedCents : row.pendingCents)} status={status}
    urgent={view === 'pending' && row.overdue} onClick={onOpen} label={`Abrir ${row.title}, parcela ${row.number} de ${row.installmentCount}`} />;
}

/** The due date range behind a chip: two dates and an apply button in a popover. */
function DueFilter({ value, onChange }: { value: Due; onChange: (value: Due) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const id = useId();
  const active = Boolean(value.from || value.to);
  const summary = value.from && value.to ? `${fullDate(value.from)} a ${fullDate(value.to)}` : value.from ? `desde ${fullDate(value.from)}` : value.to ? `até ${fullDate(value.to)}` : '';
  function apply(next: Due) {
    if (next.from && next.to && next.from > next.to) { setError('O vencimento final deve ser igual ou posterior ao inicial.'); return; }
    setError(''); onChange(next); setOpen(false);
  }
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setDraft(value); setError(''); } }}>
    <PopoverTrigger asChild><Chip menu pressed={active} aria-label={`Vencimento${summary ? `: ${summary}` : ''}`}><span className="max-w-56 truncate">{active ? `Vencimento: ${summary}` : 'Vencimento'}</span></Chip></PopoverTrigger>
    <PopoverContent align="start" className="w-72 gap-3 p-3" aria-label="Filtrar por vencimento">
      <form className="grid gap-3" onSubmit={event => { event.preventDefault(); apply(draft); }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5"><Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">Vencimento de</Label><Input id={`${id}-from`} type="date" className="max-md:h-11" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">Vencimento até</Label><Input id={`${id}-to`} type="date" className="max-md:h-11" value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></div>
        </div>
        <Failure message={error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="max-md:h-11" onClick={() => apply({ from: '', to: '' })}>Limpar</Button><Button type="submit" className="max-md:h-11">Aplicar</Button></div>
      </form>
    </PopoverContent>
  </Popover>;
}

/** Honorários as a canvas module (`Main.dc.html`, `v.modulo` with `honorarios`): one row per installment. */
export function HonorariosPanel() {
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query);
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [caseId, setCaseId] = useState(params.get('caseId') ?? '');
  const [due, setDue] = useState<Due>({ from: '', to: '' });
  const [view, setView] = useState<View>('pending');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  // A result belongs to the request that produced it: a filter that ends where it started shows the
  // rows it has instead of waiting for a load that never runs.
  const request = JSON.stringify([view, search, clientId, caseId, due.from, due.to, offset, revision]);
  const [settled, setSettled] = useState<{ request: string; load: Exclude<Load, { kind: 'loading' }> } | null>(null);
  const load: Load = settled?.request === request ? settled.load : { kind: 'loading' };
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogState>(() => {
    const agreementId = params.get('agreementId');
    return agreementId ? { kind: 'detail', agreementId, today: saoPauloToday() } : { kind: 'closed' };
  });
  const opener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('list', { view, query: search, clientId: clientId || undefined, caseId: caseId || undefined, dueFrom: due.from || undefined, dueTo: due.to || undefined, limit: pageSize, offset }, honorariosListDto, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSettled({ request, load: { kind: 'ready', data } }); })
      .catch(cause => { if (!controller.signal.aborted) setSettled({ request, load: { kind: 'error', message: cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível carregar os honorários. Tente novamente.' } }); });
    return () => controller.abort();
  }, [view, search, clientId, caseId, due, offset, revision, request]);
  function refresh() { setRevision(value => value + 1); }
  function filter<T>(set: (value: T) => void) { return (value: T) => { set(value); setOffset(0); }; }
  function close() {
    setDialog({ kind: 'closed' });
    requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); else titleRef.current?.focus(); });
  }
  const filtered = Boolean(query || clientId || caseId || due.from || due.to);
  const summary = load.kind === 'ready' ? load.data.summary : null;
  const eyebrow = summary ? [`A receber ${money(summary.pendingCents)}`, summary.overdueCents ? `em atraso ${money(summary.overdueCents)}` : '', `recebido ${money(summary.receivedCents)}`].filter(Boolean).join(' · ') : '';

  return <CanvasPage className="gap-5 md:gap-5">
    <CanvasHeader eyebrow={eyebrow || <span aria-hidden="true">&nbsp;</span>}
      title={<span ref={titleRef} tabIndex={-1} className="outline-none">Honorários</span>}
      actions={<>
        <Button asChild variant="ghost" size="lg" className="text-muted-foreground max-md:h-11"><Link href="/app/honorarios/propostas">Propostas e tabelas OAB</Link></Button>
        <Button variant="outline" size="lg" className="max-md:h-11 [&_svg]:size-3.5" onClick={event => { opener.current = event.currentTarget; setDialog({ kind: 'create' }); }}><Plus aria-hidden="true" />Novo honorário</Button>
      </>} />
    {notice && <p role="status" className="text-[13px] text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <SearchField label="Buscar honorários" value={query} onChange={filter(setQuery)} className="max-md:w-full" />
      <FilterMenu label="Situação" value={view} options={views} onChange={filter(value => setView(value as View))} />
      <ReferenceSelect variant="chip" purpose="filter" kind="clients" value={clientId} onChange={filter(setClientId)} optional />
      <ReferenceSelect variant="chip" purpose="filter" kind="cases" value={caseId} onChange={filter(setCaseId)} optional />
      <DueFilter value={due} onChange={filter(setDue)} />
      {filtered && <Button variant="ghost" className="h-[30px] text-[13px] text-muted-foreground max-md:h-11" onClick={() => { setQuery(''); setClientId(''); setCaseId(''); setDue({ from: '', to: '' }); setOffset(0); }}>Limpar filtros</Button>}
    </div>
    <section aria-label={views.find(item => item.value === view)?.label} aria-busy={load.kind === 'loading'} className="flex flex-col gap-3">
      {load.kind === 'loading' ? <RowsLoading label="Carregando honorários" />
        : load.kind === 'error' ? <div className="flex flex-wrap items-center gap-3"><Failure message={load.message} /><Button variant="outline" onClick={refresh}>Tentar novamente</Button></div>
        : <>
          {load.data.installments.length ? <div className="flex flex-col gap-0.5">{load.data.installments.map(row => <InstallmentRow key={row.id} row={row} view={view}
            onOpen={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialog({ kind: 'detail', agreementId: row.agreementId, today: load.data.today }); }} />)}</div>
            : <EmptyRows>{empty[view]}</EmptyRows>}
          {load.data.total > pageSize && <div className="flex items-center justify-between gap-3 pt-2">
            <span className="font-mono text-[12.5px] text-muted-foreground">{offset + 1}–{Math.min(offset + pageSize, load.data.total)} de {load.data.total}</span>
            <div className="flex gap-1"><Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Anterior</Button><Button variant="ghost" disabled={offset + pageSize >= load.data.total} onClick={() => setOffset(value => value + pageSize)}>Próxima</Button></div>
          </div>}
          <p className="text-xs text-subtle-foreground">Os totais acima consideram os filtros de cliente, caso, busca e vencimento em todas as situações. Valores cancelados ficam fora dos totais.</p>
        </>}
    </section>
    {dialog.kind === 'create' && <CreateHonorarioDialog clientId={clientId} caseId={caseId} close={close} saved={() => { close(); setNotice('Honorário cadastrado.'); setOffset(0); refresh(); }} />}
    {dialog.kind === 'detail' && <DetailHonorarioDialog agreementId={dialog.agreementId} today={dialog.today} close={close} changed={() => { setNotice('Honorário atualizado.'); setOffset(0); refresh(); }} />}
  </CanvasPage>;
}
