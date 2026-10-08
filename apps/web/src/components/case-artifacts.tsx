'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { VaultContextSection } from './agent-sources-panel';
import { useLumeState, useLumeWorkspace } from './lume/workspace-context';
import type { CaseArtifact } from '@/lib/case-artifacts';
import { SaveForm } from './agent-artifacts-panel';
import { useCanvasRevision, useCanvasActive } from './lume/canvas-host';

export function CaseArtifacts({ caseId, caseName }: { caseId: string; caseName: string }) {
  const revision = useCanvasRevision(), active = useCanvasActive();
  const { controller } = useLumeWorkspace();
  const state = useLumeState();
  const [items, setItems] = useState<CaseArtifact[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [seed,setSeed] = useState({revision,active});
  if (seed.revision !== revision || seed.active !== active) { setSeed({revision,active}); setItems(null); setSaved(''); }
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/vault/cases/${encodeURIComponent(caseId)}/artifacts`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar os artefatos deste caso.');
        const result = await response.json() as { artifacts: CaseArtifact[] };
        if (!abort.signal.aborted) setItems(result.artifacts);
      }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível conectar.'); });
    return () => abort.abort();
  }, [caseId, retry, revision, active]);
  return <section aria-label="Artefatos do caso" className="py-4">
    <h2 className="text-lg font-medium">Artefatos do caso</h2>
    <p className="mt-1 text-sm text-muted-foreground">Seus documentos privados vinculados ao caso e as cópias salvas no Cofre.</p>
    {saved && <p role="status" className="mt-3 text-sm">{saved}</p>}
    {error ? <div className="mt-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => { setError(''); setRetry(value => value + 1); }}>Tentar novamente</Button></div>
      : items === null ? <p role="status" className="py-4 text-sm">Carregando artefatos…</p>
      : items.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nenhum artefato vinculado a este caso ainda.</p>
      : <div className="mt-4 divide-y">{items.map(item => <article key={`${item.place}:${item.id}`} className="min-w-0 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={item.href} className="min-w-0 rounded-lg px-2 py-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="text-xs text-muted-foreground">{item.place === 'private' ? 'Privado, só você' : 'Salvo no Cofre'} · Versão {item.version}</span>
          </Link>
          {item.place === 'private' && item.conversationId && saving !== item.id && <Button variant="outline" onClick={() => setSaving(item.id)}>Salvar no Cofre</Button>}
        </div>
        {saving === item.id && item.conversationId && <SaveForm conversationId={item.conversationId} initialCaseId={caseId}
          source={{ kind: 'document', id: item.id, version: Number(item.version) }} onCancel={() => setSaving(null)}
          onSaved={copy => { setSaving(null); setSaved(`${copy.name} foi salvo em ${copy.place}.`); setRetry(value => value + 1); }} />}
      </article>)}</div>}
    <VaultContextSection context={{ ...state.sources, caseId, caseLabel: caseName }} lockedCase
      onChange={sources => controller.dispatch({ type: 'sources', sources })} />
  </section>;
}
