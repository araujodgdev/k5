'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { useVaultDocumentOptions, VaultDocumentOptionsMore } from './vault-document-options';
import { annexFileName, type AnnexItem } from '@/lib/annexes-contract';

const selectStyle = 'h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9';

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}

type Plan = { planId: string; scanDocumentId: string; pageCount: number; items: AnnexItem[]; uncoveredPages: number[] };
type Result = { folderId: string; documents: Array<{ id: string; name: string }> };

export function VaultAnnexes({ caseId }: { caseId: string }) {
  const options = useVaultDocumentOptions(`caseId=${encodeURIComponent(caseId)}`);
  const documents = options.documents;
  const [scanId, setScanId] = useState('');
  const [petitionId, setPetitionId] = useState('');
  const [petitionText, setPetitionText] = useState('');
  const [savedPlan, setSavedPlan] = useState<{ value: Plan; caseId: string; epoch: number } | null>(null);
  const selection = useRef({ caseId, scanId: '', epoch: 0 });
  const [epoch,setEpoch]=useState(0);
  const operation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const plan = savedPlan?.caseId === caseId && savedPlan.epoch === epoch && savedPlan.value.scanDocumentId === scanId ? savedPlan.value : null;
  function invalidate() {
    operation.current++;
    pending.current?.abort();
    pending.current = null;
    setBusy('');
  }
  const setPlan = useCallback((value: Plan | null) => {
    setSavedPlan(value ? { value, caseId, epoch: selection.current.epoch } : null);
  }, [caseId]);
  const start = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const token = ++operation.current;
    const epoch = selection.current.epoch;
    return { controller, current: () => !controller.signal.aborted && token === operation.current && epoch === selection.current.epoch && caseId === selection.current.caseId };
  }, [caseId]);
  const [folderName, setFolderName] = useState('Anexos da petição');
  const [busy, setBusy] = useState<'' | 'plan' | 'files'>('');
  const [error, setError] = useState('');
  const [savedResult, setSavedResult] = useState<{value:Result;caseId:string;epoch:number} | null>(null);
  const result=savedResult?.caseId===caseId && savedResult.epoch===epoch ? savedResult.value : null;
  const setResult = useCallback((value: Result | null) => {
    setSavedResult(value ? { value, caseId, epoch: selection.current.epoch } : null);
  }, [caseId]);
  const generation = useRef<{ signature: string; key: string } | null>(null);

  const pdfs = documents.filter(document => document.mimeType === 'application/pdf');
  const readable = documents.filter(document => document.id !== scanId);
  useEffect(() => {
    if (selection.current.caseId !== caseId) {
      selection.current = { caseId, scanId: '', epoch: selection.current.epoch + 1 };
      setEpoch(selection.current.epoch);
      setScanId(''); setPlan(null); setResult(null); setError('');
    }
    if (!scanId || selection.current.scanId !== scanId) return;
    const request = start();
    setBusy('plan');
    void fetch(`/api/vault/cases/${encodeURIComponent(caseId)}/annexes?scanDocumentId=${encodeURIComponent(scanId)}`, { signal: request.controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Não foi possível reabrir o plano.'); return body as { plan: Plan | null }; })
      .then(body => { if (request.current() && (!body.plan || body.plan.scanDocumentId === scanId)) setPlan(body.plan); })
      .catch(failure => { if (request.current()) setError(failure instanceof Error ? failure.message : 'Não foi possível reabrir o plano.'); })
      .finally(() => { if (request.current()) setBusy(''); });
    return () => request.controller.abort();

  }, [caseId, scanId, setPlan, setResult, start]);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    const request = start();
    setBusy('plan'); setError(''); setResult(null); setPlan(null);
    try {
      const value = await post<Plan>(`/api/vault/cases/${encodeURIComponent(caseId)}/annexes`, {
        scanDocumentId: scanId, ...(petitionText.trim() ? { petitionText } : { petitionDocumentId: petitionId }),
      }, request.controller.signal);
      if (request.current() && value.scanDocumentId === scanId) setPlan(value);
    } catch (failure) { if (request.current()) setError(failure instanceof Error ? failure.message : 'Não foi possível analisar.'); }
    finally { if (request.current()) setBusy(''); }
  }
  async function generate() {
    if (!plan || plan.scanDocumentId !== scanId) return;
    const request = start();
    setBusy('files'); setError('');
    try {
      const items = plan.items.filter(item => item.include).map(({ label, startPage, endPage }) => ({ label, startPage, endPage }));
      const signature = JSON.stringify([plan.planId, plan.scanDocumentId, folderName, items]);
      if (generation.current?.signature !== signature) generation.current = { signature, key: crypto.randomUUID() };
      const value = await post<Result>(`/api/vault/cases/${encodeURIComponent(caseId)}/annexes/files`, { planId: plan.planId, scanDocumentId: scanId, folderName, items, idempotencyKey: generation.current.key }, request.controller.signal);
      if (request.current() && generation.current?.signature === signature) setResult(value);
    } catch (failure) { if (request.current()) setError(failure instanceof Error ? failure.message : 'Não foi possível gerar os anexos.'); }
    finally { if (request.current()) setBusy(''); }
  }
  function update(index: number, patch: Partial<AnnexItem>) {
    if (!plan) return;
    invalidate(); generation.current = null;
    setPlan({ ...plan, items: plan.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  }
  function move(index: number, offset: number) {
    if (!plan) return;
    invalidate(); generation.current = null;
    const items = [...plan.items];
    const [item] = items.splice(index, 1);
    items.splice(index + offset, 0, item);
    setPlan({ ...plan, items });
  }
  const included = plan?.items.filter(item => item.include) ?? [];
  const invalid = plan?.items.some(item => item.include && (item.label.trim().length < 2 || item.startPage < 1 || item.endPage > plan.pageCount || item.startPage > item.endPage));

  return <div className="grid max-w-4xl gap-8 py-2">
    <form onSubmit={analyze} className="grid gap-4">
      <div className="grid gap-1.5"><Label htmlFor="annex-scan">PDF digitalizado com os documentos</Label>
        <select id="annex-scan" value={scanId} onChange={event => { invalidate(); selection.current = { caseId, scanId: event.target.value, epoch: selection.current.epoch + 1 }; setEpoch(selection.current.epoch);generation.current = null; setScanId(event.target.value); setPlan(null); setResult(null); setError(''); setBusy(event.target.value ? 'plan' : ''); }} required className={selectStyle}>
          <option value="">Escolha o arquivo</option>{pdfs.map(document => <option key={document.id} value={document.id} disabled={document.status !== 'ready'}>{document.name}{document.status !== 'ready' ? ' (em processamento)' : ''}</option>)}
        </select>{!options.loading && !options.error && pdfs.length === 0 && <p className="text-xs text-muted-foreground">Envie o PDF em Arquivos. A leitura (OCR) termina em alguns minutos.</p>}</div>
      <div className="grid gap-1.5"><Label htmlFor="annex-petition">Petição</Label>
        <select id="annex-petition" value={petitionId} onChange={event => { invalidate(); setPetitionId(event.target.value); }} disabled={Boolean(petitionText.trim())} className={selectStyle}>
          <option value="">Escolha a petição no caso</option>{readable.map(document => <option key={document.id} value={document.id} disabled={document.status !== 'ready'}>{document.name}</option>)}
        </select></div>
      <VaultDocumentOptionsMore {...options} />
      <div className="grid gap-1.5"><Label htmlFor="annex-petition-text">Ou cole o texto da petição</Label>
        <Textarea id="annex-petition-text" value={petitionText} onChange={event => { invalidate(); setPetitionText(event.target.value); }} rows={4} maxLength={60_000} /></div>
      <Button type="submit" className="justify-self-start" size="lg" disabled={Boolean(busy) || !scanId || (!petitionId && petitionText.trim().length < 50)}>
        {busy === 'plan' && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy === 'plan' ? 'Lendo as páginas…' : 'Propor anexos'}</Button>
    </form>

    {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}

    {plan && !result && <section aria-labelledby="annex-review" className="grid gap-4 border-t pt-6">
      <h2 id="annex-review" className="font-medium">Revise antes de gerar</h2>
      <p className="text-sm text-muted-foreground">Ordem de citação na petição. Documentos que a petição não cita começam desmarcados.{plan.uncoveredPages.length ? ` Páginas sem documento identificado: ${plan.uncoveredPages.join(', ')}.` : ''}</p>
      <div className="divide-y border-y">{plan.items.map((item, index) => {
        const position = plan.items.slice(0, index + 1).filter(other => other.include).length;
        return <div key={index} className="grid gap-3 py-4 md:grid-cols-[auto_minmax(0,1fr)_5rem_5rem_auto] md:items-end">
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9"><input type="checkbox" checked={item.include} onChange={event => update(index, { include: event.target.checked })} className="size-4 accent-primary" /><span className="sr-only">Incluir {item.label}</span></label>
          <div className="grid min-w-0 gap-1.5"><Label htmlFor={`annex-label-${index}`}>Documento</Label><Input id={`annex-label-${index}`} value={item.label} maxLength={80} onChange={event => update(index, { label: event.target.value })} className="h-11 md:h-9" />
            <p className="truncate text-xs text-muted-foreground">{item.include ? annexFileName(position, item.label) : 'Não será gerado'}{item.cited ? '' : ' · não citado na petição'}</p></div>
          <div className="grid gap-1.5"><Label htmlFor={`annex-start-${index}`}>De</Label><Input id={`annex-start-${index}`} type="number" min={1} max={plan.pageCount} value={item.startPage} onChange={event => update(index, { startPage: Number(event.target.value) })} className="h-11 md:h-9" /></div>
          <div className="grid gap-1.5"><Label htmlFor={`annex-end-${index}`}>Até</Label><Input id={`annex-end-${index}`} type="number" min={1} max={plan.pageCount} value={item.endPage} onChange={event => update(index, { endPage: Number(event.target.value) })} className="h-11 md:h-9" /></div>
          <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${item.label}`}><ArrowUp aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={index === plan.items.length - 1} onClick={() => move(index, 1)} aria-label={`Descer ${item.label}`}><ArrowDown aria-hidden="true" /></Button></div>
        </div>;
      })}</div>
      <div className="grid gap-1.5 sm:max-w-sm"><Label htmlFor="annex-folder">Pasta de destino</Label><Input id="annex-folder" value={folderName} maxLength={120} onChange={event => { invalidate(); generation.current = null; setFolderName(event.target.value); }} className="h-11 md:h-9" /></div>
      <Button type="button" size="lg" className="justify-self-start" disabled={Boolean(busy) || plan.scanDocumentId !== scanId || !included.length || invalid} onClick={() => void generate()}>
        {busy === 'files' && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy === 'files' ? 'Gerando…' : `Gerar ${included.length} ${included.length === 1 ? 'anexo' : 'anexos'}`}</Button>
      {invalid && <p className="text-xs text-destructive">Confira os nomes e as páginas: o PDF tem {plan.pageCount} páginas.</p>}
    </section>}

    {result && <section aria-labelledby="annex-done" className="grid gap-3 border-t pt-6">
      <h2 id="annex-done" className="font-medium">Anexos gerados</h2>
      <div className="divide-y border-y">{result.documents.map(document => <a key={document.id} href={`/api/vault/documents/${document.id}/download`} className="flex min-h-11 items-center text-sm underline-offset-4 hover:underline">{document.name}</a>)}</div>
      <div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href={`/app/vault/cases/${encodeURIComponent(caseId)}?folder=${encodeURIComponent(result.folderId)}`}>Abrir a pasta</Link></Button>
        <Button type="button" variant="ghost" onClick={() => { invalidate(); selection.current = { caseId, scanId: '', epoch: selection.current.epoch + 1 }; setEpoch(selection.current.epoch);setScanId(''); setResult(null); setPlan(null); setError(''); }}>Separar outro PDF</Button></div>
    </section>}
  </div>;
}
