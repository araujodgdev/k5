'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { honorariosListDto, type HonorariosList } from '@/lib/honorarios/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Reveal } from '@/components/reveal';
import { honorariosCall } from './client';
import { CreateHonorarioDialog } from './create-dialog';
import { DetailHonorarioDialog, installmentStatus } from './detail-dialog';
import { dateLabel, money } from './editor';
import { Failure, Field, ReferenceSelect } from './fields';

type Filters = { query: string; clientId: string; caseId: string; dueFrom: string; dueTo: string };
type View = 'pending' | 'received' | 'cancelled';
type Load = { kind: 'loading' } | { kind: 'ready'; data: HonorariosList } | { kind: 'error'; message: string };
type DialogState = { kind: 'closed' } | { kind: 'create' } | { kind: 'detail'; agreementId: string; today: string };
const blankFilters: Filters = { query: '', clientId: '', caseId: '', dueFrom: '', dueTo: '' };
const views: { value: View; label: string }[] = [{ value: 'pending', label: 'A receber' }, { value: 'received', label: 'Recebidas' }, { value: 'cancelled', label: 'Canceladas' }];
const pageSize = 30;

export function HonorariosPanel({ canCreate }: { canCreate: boolean }) {
  const params = useSearchParams();
  const initialClientId = params.get('clientId') ?? '';
  const initialCaseId = params.get('caseId') ?? '';
  const [draft, setDraft] = useState<Filters>({ ...blankFilters, clientId: initialClientId, caseId: initialCaseId });
  const [filters, setFilters] = useState(draft);
  const [view, setView] = useState<View>('pending');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [filterError, setFilterError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const opener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('list', { view, query: filters.query, clientId: filters.clientId || undefined, caseId: filters.caseId || undefined, dueFrom: filters.dueFrom || undefined, dueTo: filters.dueTo || undefined, limit: pageSize, offset }, honorariosListDto, controller.signal).then(data => { if (!controller.signal.aborted) setLoad({ kind: 'ready', data }); }).catch(cause => { if (!controller.signal.aborted) setLoad({ kind: 'error', message: cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível carregar os honorários. Tente novamente.' }); });
    return () => controller.abort();
  }, [filters, view, offset, revision]);
  function refresh() { setLoad({ kind: 'loading' }); setRevision(value => value + 1); }
  function close() {
    setDialog({ kind: 'closed' });
    requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); else titleRef.current?.focus(); });
  }
  function editFilter(name: keyof Filters, value: string) { setDraft(current => ({ ...current, [name]: value })); }
  return <Reveal className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-10">
    <header data-reveal className="flex flex-wrap items-center justify-between gap-4 pb-6"><h1 ref={titleRef} tabIndex={-1} className="page-title outline-none max-md:sr-only">Honorários</h1>{canCreate && <Button className="min-h-11 max-md:w-full" onClick={event => { opener.current = event.currentTarget; setDialog({ kind: 'create' }); }}>Novo honorário</Button>}</header>
    {notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
    {load.kind === 'ready' && <dl data-reveal className="grid grid-cols-3 divide-x border-y border-line">
      {[{ label: 'Recebido', value: load.data.summary.receivedCents }, { label: 'A receber', value: load.data.summary.pendingCents }, { label: 'Em atraso', value: load.data.summary.overdueCents }].map(item => <div key={item.label} className="min-w-0 px-2 py-4 first:pl-0 last:pr-0 sm:px-5"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-2 text-lg tracking-tight tabular-nums [overflow-wrap:anywhere] md:text-2xl">{money(item.value)}</dd></div>)}
    </dl>}
    <form className="py-6" onSubmit={event => { event.preventDefault(); if (draft.dueFrom && draft.dueTo && draft.dueFrom > draft.dueTo) { setFilterError('O vencimento final deve ser igual ou posterior ao inicial.'); return; } setFilterError(''); setLoad({ kind: 'loading' }); setFilters({ ...draft }); setOffset(0); }}>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1 basis-56"><Field label="Buscar honorários">{id => <Input id={id} className="min-h-11" type="search" maxLength={180} value={draft.query} onChange={event => editFilter('query', event.target.value)} />}</Field></div><Button type="submit" className="min-h-11" variant="outline">Aplicar filtros</Button><Button type="button" className="min-h-11" variant="ghost" onClick={() => { setFilterError(''); setDraft(blankFilters); setFilters(blankFilters); setOffset(0); setLoad({ kind: 'loading' }); setRevision(value => value + 1); }}>Limpar filtros</Button></div>
      <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4">Filtrar por cliente, caso e vencimento</summary><div className="grid min-w-0 gap-4 py-3 sm:grid-cols-2 xl:grid-cols-4"><ReferenceSelect purpose="filter" kind="clients" value={draft.clientId} onChange={value => editFilter('clientId', value)} optional /><ReferenceSelect purpose="filter" kind="cases" value={draft.caseId} onChange={value => editFilter('caseId', value)} optional /><Field label="Vencimento de">{id => <Input id={id} className="min-h-11" type="date" value={draft.dueFrom} onChange={event => editFilter('dueFrom', event.target.value)} />}</Field><Field label="Vencimento até">{id => <Input id={id} className="min-h-11" type="date" value={draft.dueTo} onChange={event => editFilter('dueTo', event.target.value)} />}</Field></div></details>
      <Failure message={filterError} />
    </form>
    <nav aria-label="Situação das parcelas" className="flex border-b border-line">{views.map(item => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => { if (view !== item.value) { setView(item.value); setOffset(0); setLoad({ kind: 'loading' }); } }} className={`min-h-11 flex-1 border-b-2 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none sm:px-5 ${view === item.value ? 'border-brand font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item.label}</button>)}</nav>
    {load.kind === 'loading' ? <p role="status" className="py-10 text-sm text-muted-foreground">Carregando honorários…</p> : load.kind === 'error' ? <div className="grid justify-items-start gap-4 py-8"><Failure message={load.message} /><Button variant="outline" className="min-h-11" onClick={refresh}>Tentar novamente</Button></div> : <>
      <p className="py-3 text-xs text-muted-foreground">Os totais consideram os filtros de cliente, caso, busca e vencimento em todas as situações. Valores cancelados ficam fora dos totais.</p>
      {load.data.installments.length ? <div className="divide-y border-b"><div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b py-3 text-[13px] text-muted-foreground md:grid"><span>Honorário e cliente</span><span>Vencimento</span><span className="text-right">{view === 'cancelled' ? 'Valor cancelado' : view === 'received' ? 'Recebido' : 'Saldo a receber'}</span></div>{load.data.installments.map(row => <button key={row.id} type="button" aria-label={`Abrir ${row.title}, parcela ${row.number} de ${row.installmentCount}`} onClick={event => { opener.current = event.currentTarget; setDialog({ kind: 'detail', agreementId: row.agreementId, today: load.data.today }); }} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 py-5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
        <div className="min-w-0 max-md:col-span-2"><p className="break-words font-medium text-sm">{row.title}</p><p className="mt-1 break-words text-[13px] text-muted-foreground">{row.clientName}{row.caseName ? ` · ${row.caseName}` : ''}</p><p className="mt-1 text-xs text-muted-foreground">Parcela {row.number} de {row.installmentCount}</p></div><div className="text-sm"><p className="tabular-nums">{dateLabel(row.dueOn)}</p><p className="mt-1 text-xs text-muted-foreground">{row.overdue ? 'Em atraso' : installmentStatus[row.status]}</p></div><div className="text-right"><p className="font-medium text-sm tabular-nums">{money(view === 'cancelled' ? row.amountCents : view === 'received' ? row.receivedCents : row.pendingCents)}</p>{row.receivedCents > 0 && view === 'pending' && <p className="mt-1 text-xs text-muted-foreground">Recebido {money(row.receivedCents)}</p>}</div>
      </button>)}</div> : <p className="py-10 text-sm text-muted-foreground">{view === 'pending' ? 'Nenhuma parcela a receber para estes filtros.' : view === 'received' ? 'Nenhuma parcela recebida para estes filtros.' : 'Nenhuma parcela cancelada para estes filtros.'}</p>}
      {load.data.total > pageSize && <div className="flex flex-wrap items-center justify-between gap-3 pt-5"><Button variant="ghost" className="min-h-11" disabled={offset === 0} onClick={() => { setOffset(value => Math.max(0, value - pageSize)); setLoad({ kind: 'loading' }); }}>Anterior</Button><p className="text-xs text-muted-foreground">{offset + 1} a {Math.min(offset + pageSize, load.data.total)} de {load.data.total} parcelas</p><Button variant="ghost" className="min-h-11" disabled={offset + pageSize >= load.data.total} onClick={() => { setOffset(value => value + pageSize); setLoad({ kind: 'loading' }); }}>Próxima</Button></div>}
    </>}
    {dialog.kind === 'create' && <CreateHonorarioDialog clientId={filters.clientId} caseId={filters.caseId} close={close} saved={() => { close(); setNotice('Honorário cadastrado.'); setOffset(0); refresh(); }} />}
    {dialog.kind === 'detail' && <DetailHonorarioDialog agreementId={dialog.agreementId} today={dialog.today} close={close} changed={() => { setNotice('Honorário atualizado.'); setOffset(0); refresh(); }} />}
  </Reveal>;
}
