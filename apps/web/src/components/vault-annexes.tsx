'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import type { VaultDocument } from '@/lib/vault';
import type { AnnexItem } from '@/lib/annexes-contract';

const selectStyle = 'h-11 w-full rounded-md border bg-background px-3 text-sm md:h-9';

/** Mirrors the server's rule so the preview matches the file that will be created. */
function fileName(position: number, label: string) {
  const base = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60).replace(/_+$/, '');
  return `${String(position).padStart(2, '0')}_${base || 'documento'}.pdf`;
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}

type Plan = { pageCount: number; items: AnnexItem[]; uncoveredPages: number[] };
type Result = { folderId: string; documents: Array<{ id: string; name: string }> };

export function VaultAnnexes({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [scanId, setScanId] = useState('');
  const [petitionId, setPetitionId] = useState('');
  const [petitionText, setPetitionText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [folderName, setFolderName] = useState('Anexos da petição');
  const [busy, setBusy] = useState<'' | 'plan' | 'files'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vault/documents?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ documents: VaultDocument[] }> : Promise.reject(new Error()))
      .then(data => { if (!cancelled) setDocuments(data.documents); })
      .catch(() => { if (!cancelled) { setDocuments([]); setError('Não foi possível listar os arquivos do caso.'); } });
    return () => { cancelled = true; };
  }, [caseId]);

  if (!canWrite) return <p className="py-6 text-sm text-muted-foreground">Seu papel permite apenas consultar os arquivos do caso.</p>;
  if (!documents) return <p role="status" className="py-6 text-sm text-muted-foreground">Carregando arquivos do caso…</p>;
  const pdfs = documents.filter(document => document.mimeType === 'application/pdf');
  const readable = documents.filter(document => document.id !== scanId);

  async function analyze(event: FormEvent) {
    event.preventDefault(); setBusy('plan'); setError(''); setResult(null);
    try {
      setPlan(await post<Plan>(`/api/vault/cases/${encodeURIComponent(caseId)}/annexes`, {
        scanDocumentId: scanId, ...(petitionText.trim() ? { petitionText } : { petitionDocumentId: petitionId }),
      }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível analisar.'); }
    finally { setBusy(''); }
  }
  async function generate() {
    if (!plan) return;
    setBusy('files'); setError('');
    try {
      const items = plan.items.filter(item => item.include).map(({ label, startPage, endPage }) => ({ label, startPage, endPage }));
      setResult(await post<Result>(`/api/vault/cases/${encodeURIComponent(caseId)}/annexes/files`, { scanDocumentId: scanId, folderName, items, idempotencyKey: crypto.randomUUID() }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível gerar os anexos.'); }
    finally { setBusy(''); }
  }
  function update(index: number, patch: Partial<AnnexItem>) {
    setPlan(current => current && { ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  }
  function move(index: number, offset: number) {
    setPlan(current => {
      if (!current) return current;
      const items = [...current.items];
      const [item] = items.splice(index, 1);
      items.splice(index + offset, 0, item);
      return { ...current, items };
    });
  }
  const included = plan?.items.filter(item => item.include) ?? [];
  const invalid = plan?.items.some(item => item.include && (item.label.trim().length < 2 || item.startPage < 1 || item.endPage > plan.pageCount || item.startPage > item.endPage));

  return <div className="grid max-w-4xl gap-8 py-2">
    <form onSubmit={analyze} className="grid gap-4">
      <div className="grid gap-1.5"><Label htmlFor="annex-scan">PDF digitalizado com os documentos</Label>
        <select id="annex-scan" value={scanId} onChange={event => { setScanId(event.target.value); setPlan(null); }} required className={selectStyle}>
          <option value="">Escolha o arquivo</option>{pdfs.map(document => <option key={document.id} value={document.id} disabled={document.status !== 'ready'}>{document.name}{document.status !== 'ready' ? ' (em processamento)' : ''}</option>)}
        </select>{pdfs.length === 0 && <p className="text-xs text-muted-foreground">Envie o PDF em Arquivos. A leitura (OCR) termina em alguns minutos.</p>}</div>
      <div className="grid gap-1.5"><Label htmlFor="annex-petition">Petição</Label>
        <select id="annex-petition" value={petitionId} onChange={event => setPetitionId(event.target.value)} disabled={Boolean(petitionText.trim())} className={selectStyle}>
          <option value="">Escolha a petição no caso</option>{readable.map(document => <option key={document.id} value={document.id} disabled={document.status !== 'ready'}>{document.name}</option>)}
        </select></div>
      <div className="grid gap-1.5"><Label htmlFor="annex-petition-text">Ou cole o texto da petição</Label>
        <Textarea id="annex-petition-text" value={petitionText} onChange={event => setPetitionText(event.target.value)} rows={4} maxLength={60_000} /></div>
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
            <p className="truncate text-xs text-muted-foreground">{item.include ? fileName(position, item.label) : 'Não será gerado'}{item.cited ? '' : ' · não citado na petição'}</p></div>
          <div className="grid gap-1.5"><Label htmlFor={`annex-start-${index}`}>De</Label><Input id={`annex-start-${index}`} type="number" min={1} max={plan.pageCount} value={item.startPage} onChange={event => update(index, { startPage: Number(event.target.value) })} className="h-11 md:h-9" /></div>
          <div className="grid gap-1.5"><Label htmlFor={`annex-end-${index}`}>Até</Label><Input id={`annex-end-${index}`} type="number" min={1} max={plan.pageCount} value={item.endPage} onChange={event => update(index, { endPage: Number(event.target.value) })} className="h-11 md:h-9" /></div>
          <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${item.label}`}><ArrowUp aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={index === plan.items.length - 1} onClick={() => move(index, 1)} aria-label={`Descer ${item.label}`}><ArrowDown aria-hidden="true" /></Button></div>
        </div>;
      })}</div>
      <div className="grid gap-1.5 sm:max-w-sm"><Label htmlFor="annex-folder">Pasta de destino</Label><Input id="annex-folder" value={folderName} maxLength={120} onChange={event => setFolderName(event.target.value)} className="h-11 md:h-9" /></div>
      <Button type="button" size="lg" className="justify-self-start" disabled={Boolean(busy) || !included.length || invalid} onClick={() => void generate()}>
        {busy === 'files' && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{busy === 'files' ? 'Gerando…' : `Gerar ${included.length} ${included.length === 1 ? 'anexo' : 'anexos'}`}</Button>
      {invalid && <p className="text-xs text-destructive">Confira os nomes e as páginas: o PDF tem {plan.pageCount} páginas.</p>}
    </section>}

    {result && <section aria-labelledby="annex-done" className="grid gap-3 border-t pt-6">
      <h2 id="annex-done" className="font-medium">Anexos gerados</h2>
      <div className="divide-y border-y">{result.documents.map(document => <a key={document.id} href={`/api/vault/documents/${document.id}/download`} className="flex min-h-11 items-center text-sm underline-offset-4 hover:underline">{document.name}</a>)}</div>
      <div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href={`/app/vault/cases/${encodeURIComponent(caseId)}?folder=${encodeURIComponent(result.folderId)}`}>Abrir a pasta</Link></Button>
        <Button type="button" variant="ghost" onClick={() => { setResult(null); setPlan(null); }}>Separar outro PDF</Button></div>
    </section>}
  </div>;
}
