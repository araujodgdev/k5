"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/markdown';
import { humanReviewResponse, type HumanReviewItem } from '@/lib/document-human-review-contract';

export function HumanChecklist({ artifactId, version, dirty, refresh, onPendingChange }: { artifactId: string; version: number; dirty: boolean; refresh: boolean; onPendingChange: (count: number) => void }) {
  const [items, setItems] = useState<HumanReviewItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/artifacts/${artifactId}/human-review`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Não foi possível carregar a revisão humana.');
      const data = humanReviewResponse.parse(await response.json());
      if (controller.signal.aborted) return;
      if (data.version !== version) throw new Error('O documento mudou. Reabra a versão atual.');
      setError(''); setItems(data.items); onPendingChange(data.items.filter(item => item.decision !== 'confirmed').length);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a revisão.'); });
    return () => controller.abort();
  }, [artifactId, version, refresh, onPendingChange, attempt]);
  async function save(item: HumanReviewItem, decision: HumanReviewItem['decision'], note: string) {
    setBusy(item.key); setError('');
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/human-review`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version, itemKey: item.key, decision, note, revision: item.revision }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Não foi possível salvar a decisão.');
      const data = humanReviewResponse.parse(body);
      if (data.version !== version) throw new Error('O documento mudou. Reabra a versão atual.');
      setItems(data.items); onPendingChange(data.items.filter(row => row.decision !== 'confirmed').length);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(''); }
  }
  return <section aria-labelledby="human-review-heading" className="mb-8 border-b pb-5">
    <h2 id="human-review-heading" className="font-medium">Revisão humana</h2>
    <p className="mt-1 text-xs text-muted-foreground">Confirme cada item antes de usar o documento. A decisão não altera o resultado da conferência automática.</p>
    {dirty && <p role="status" className="mt-2 text-sm">Salve as alterações antes de confirmar. Uma nova versão exige nova revisão.</p>}
    {!items && !error && <p role="status" className="mt-3 text-sm">Carregando checklist…</p>}
    {items && <p className="mt-3 text-xs" aria-live="polite">{items.filter(item => item.decision === 'confirmed').length} de {items.length} confirmados na versão {version}.</p>}
    <div className="mt-2 divide-y">{items?.map(item => <DecisionRow key={`${item.key}:${item.revision}`} item={item} disabled={dirty || !!busy || refresh} saving={busy === item.key} onSave={(decision, note) => void save(item, decision, note)} />)}</div>
    {error && <div className="mt-3 grid gap-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="min-h-11 justify-self-start" disabled={!!busy} onClick={() => setAttempt(value => value + 1)}>Atualizar revisão</Button></div>}
  </section>;
}

function DecisionRow({ item, disabled, saving, onSave }: { item: HumanReviewItem; disabled: boolean; saving: boolean; onSave: (decision: HumanReviewItem['decision'], note: string) => void }) {
  const [note, setNote] = useState(item.note);
  const [decision, setDecision] = useState(item.decision);
  return <div className="grid gap-2 py-4 text-sm">
    <p className="font-medium">{item.label}</p>
    <p className="text-xs text-muted-foreground">Conferência automática: {item.automaticStatus}</p>
    {item.excerpt && <div className="break-words text-[13px] text-subtle-foreground"><Markdown text={item.excerpt} /></div>}
    <label className="grid gap-1 text-xs">Decisão para {item.label}
      <select className="min-h-11 border bg-background px-2 text-sm" value={decision} disabled={disabled} onChange={event => setDecision(event.target.value === 'confirmed' ? 'confirmed' : event.target.value === 'needs_adjustment' ? 'needs_adjustment' : 'pending')}>
        <option value="pending">Pendente</option><option value="confirmed">Confirmado</option><option value="needs_adjustment">Precisa de ajuste</option>
      </select>
    </label>
    <label className="grid gap-1 text-xs">Observação para {item.label}
      <textarea className="min-h-16 border bg-background p-2 text-sm" value={note} maxLength={2000} disabled={disabled} onChange={event => setNote(event.target.value)} />
    </label>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={disabled || (note === item.note && decision === item.decision)} onClick={() => onSave(decision, note)}>{saving ? 'Salvando decisão…' : 'Salvar decisão'}</Button>
      {item.updatedAt && <p className="text-xs text-muted-foreground">Decisão registrada em {new Date(item.updatedAt).toLocaleString('pt-BR')}.</p>}
    </div>
  </div>;
}
