'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useLumeWorkspace } from './lume/workspace-context';
import { documentHref } from '@/lib/document-ref';
import type { CasePage } from '@/lib/case-pages/contracts';
import type { VaultDocument } from '@/lib/vault';

export function CasePages({ caseId, folderId, documents }: { caseId: string; folderId: string | null; documents?: VaultDocument[] }) {
  const { navigate } = useLumeWorkspace();
  const [pages, setPages] = useState<Omit<CasePage, 'content'>[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const api = `/api/cases/${encodeURIComponent(caseId)}/pages`;
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${api}${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Não foi possível abrir as páginas.');
        if (!abort.signal.aborted) { setPages(body.pages); setError(''); }
      }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [api, folderId, retry]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderId, title, content: '' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível criar a página.');
      await navigate(documentHref({ kind: 'case-page', caseId, id: body.page.id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a página.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Páginas do caso" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3 py-3"><h2 className={documents ? 'sr-only' : 'display text-2xl'}>{documents ? 'Páginas e arquivos' : 'Páginas'}</h2><Button className="ml-auto min-h-11" onClick={() => setCreating(value => !value)}><Plus aria-hidden="true" />Nova página</Button></div>
    {creating && <form onSubmit={create} className="grid gap-3 border-b py-4"><Label htmlFor="case-page-title">Nome da página</Label><Input id="case-page-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required autoFocus /><p className="text-sm text-muted-foreground">Compartilhada com quem tem acesso a esta pasta do caso.</p><Button className="min-h-11 justify-self-start" disabled={busy || !title.trim()}>{busy ? 'Criando…' : 'Criar página'}</Button></form>}
    {error && <div role="alert" className="py-4 text-sm text-destructive">{error}<Button variant="ghost" className="min-h-11" onClick={() => setRetry(value => value + 1)}>Tentar novamente</Button></div>}
    {!pages && !error && <p role="status" className="py-4 text-sm text-muted-foreground">Carregando páginas…</p>}
    {pages?.length === 0 && !documents?.length && <p className="py-8 text-sm text-muted-foreground">{documents ? 'Nenhuma página ou arquivo nesta pasta.' : 'Nenhuma página nesta pasta. Crie a primeira para trabalhar com os participantes.'}</p>}
    <div aria-label={documents ? 'Páginas e arquivos' : 'Lista de páginas'} className="grid grid-cols-1 md:gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {pages?.map(page => <Link key={page.id} href={documentHref({ kind: 'case-page', caseId, id: page.id })} className="flex min-h-16 min-w-0 items-center gap-3 border-b py-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:block md:overflow-hidden md:rounded-xl md:border md:p-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted md:hidden"><FileText className="size-4" aria-hidden="true" /></div>
        <div className="hidden min-h-28 bg-muted p-4 md:block"><p className="line-clamp-4 break-words text-xs leading-5 text-muted-foreground">{page.preview || 'Página sem conteúdo.'}</p></div>
        <div className="min-w-0 flex-1 md:p-4"><p className="truncate text-sm font-medium">{page.title}</p><p className="mt-1 text-xs text-muted-foreground">Página · Versão {page.version} · {new Date(page.updatedAt).toLocaleDateString('pt-BR')}</p></div>
      </Link>)}
      {documents?.map(file => <Link key={file.id} href={`/app/vault/files/${encodeURIComponent(file.id)}`} className="flex min-h-16 min-w-0 items-center gap-3 border-b py-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:block md:overflow-hidden md:rounded-xl md:border md:p-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted md:min-h-28 md:w-full md:rounded-none"><FileText className="size-5 text-muted-foreground md:size-9" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1 md:p-4"><p className="truncate text-sm font-medium">{file.name}</p><p className="mt-1 break-words text-xs text-muted-foreground">{file.mimeType === 'application/pdf' ? 'PDF' : 'Arquivo'} · {(file.byteSize / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB · {new Date(file.createdAt).toLocaleDateString('pt-BR')}</p><p className={`mt-1 text-xs ${file.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{file.status === 'ready' ? 'Pronto' : file.status === 'queued' ? 'Na fila' : file.status === 'processing' ? `Processando ${file.progress}%` : 'Falhou. Abra Arquivos para tentar novamente.'}</p></div>
      </Link>)}
    </div>
  </section>;
}
