'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchVaultDocumentPage } from '@/lib/vault-document-page';
import type { VaultDocument } from '@/lib/vault';
import { useCanvasRevision, useCanvasActive } from './lume/canvas-host';

type Options = { query: string | null; documents: VaultDocument[]; total: number; offset: number; loading: boolean; error: string };

export function useVaultDocumentOptions(query: string | null, revision?: string) {
  const canvasRevision = useCanvasRevision(), active = useCanvasActive();
  const [state, setState] = useState<Options>({ query: null, documents: [], total: 0, offset: 0, loading: false, error: '' });
  const [seed, setSeed] = useState({canvasRevision, active});
  if (seed.canvasRevision !== canvasRevision || seed.active !== active) { setSeed({canvasRevision, active}); setState({ query:null,documents:[],total:0,offset:0,loading:false,error:'' }); }
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (offset: number) => {
    if (!query) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState(current => ({ ...current, query, ...(offset ? {} : { documents: [], total: 0, offset: 0 }), loading: true, error: '' }));
    try {
      let pageOffset = offset;
      while (true) {
        const page = await fetchVaultDocumentPage(query, pageOffset, controller.signal);
        if (controller.signal.aborted) return;
        if (!page.documents.length && pageOffset < page.total) throw new Error('Não foi possível carregar os arquivos.');
        const nextOffset = pageOffset + page.documents.length;
        const complete = nextOffset >= page.total;
        const append = pageOffset > 0;
        setState(current => ({ query, documents: [...new Map([...(append ? current.documents : []), ...page.documents].map(document => [document.id, document])).values()],
          total: page.total, offset: nextOffset, loading: !complete, error: '' }));
        if (complete) return;
        pageOffset = nextOffset;
      }
    } catch (cause) {
      if (!controller.signal.aborted) setState(current => ({ ...current, loading: false,
        error: cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Confira sua conexão e tente novamente.' }));
    } finally { if (!controller.signal.aborted) request.current = null; }
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(0), 0);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [load, revision, canvasRevision, active]);
  const current = state.query === query;
  return { documents: current ? state.documents : [], loading: query !== null && (!current || state.loading), error: current ? state.error : '',
    hasMore: current && state.offset < state.total, loadMore: () => load(current ? state.offset : 0) };
}

export function VaultDocumentOptionsMore({ loading, error, hasMore, loadMore }: Omit<ReturnType<typeof useVaultDocumentOptions>, 'documents'>) {
  return <div className="grid justify-items-start gap-2">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">Carregando arquivos…</p>
      : (error || hasMore) && <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()}>{error ? 'Tentar carregar arquivos novamente' : 'Carregar mais arquivos'}</Button>}
  </div>;
}
