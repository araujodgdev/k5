'use client';

import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLumeWorkspace } from '@/components/lume/workspace-context';
import { documentHref } from '@/lib/document-ref';

type Choice = { id: string; name: string };
type Preview = { approvalId: string; title: string; content: string; destination: string; audience: string; artifactVersion: number };

async function read(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Não foi possível publicar o documento.');
  return body;
}

export function PublishDocument({ artifactId, beforePublish }: { artifactId: string; beforePublish: () => Promise<boolean> }) {
  const { navigate } = useLumeWorkspace();
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<Choice[] | null>(null);
  const [caseId, setCaseId] = useState('');
  const [path, setPath] = useState<Choice[]>([]);
  const [folders, setFolders] = useState<Choice[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const folderId = path.at(-1)?.id ?? null;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch('/api/vault/cases', { signal: controller.signal, cache: 'no-store' }).then(read)
      .then(body => setCases(body.cases)).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    if (!open || !caseId) return;
    const controller = new AbortController();
    fetch(`/api/vault/folders?caseId=${encodeURIComponent(caseId)}${folderId ? `&parentId=${encodeURIComponent(folderId)}` : ''}`, { signal: controller.signal, cache: 'no-store' }).then(read)
      .then(body => setFolders(body.folders)).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open, caseId, folderId]);
  async function review() {
    setBusy(true); setError('');
    try {
      if (!await beforePublish()) throw new Error('Salve as alterações antes de publicar.');
      const { artifact } = await read(await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: 'no-store' }));
      setPreview(await read(await fetch(`/api/cases/${encodeURIComponent(caseId)}/pages/publication`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artifactId, artifactVersion: artifact.version, folderId }),
      })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revisar.'); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const { page } = await read(await fetch(`/api/cases/${encodeURIComponent(caseId)}/pages/publication`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactId, artifactVersion: preview.artifactVersion, folderId, approvalId: preview.approvalId }),
      }));
      setOpen(false);
      await navigate(documentHref({ kind: 'case-page', caseId, id: page.id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível publicar.'); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Publicar no caso" onClick={() => { setPreview(null); setError(''); setOpen(true); }}><Share2 /></Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Publicar no caso</DialogTitle><DialogDescription>Uma cópia será compartilhada. O documento original e a conversa continuam particulares.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!preview ? <div className="grid gap-4">
          <label className="grid gap-2 text-sm">Caso<select className="min-h-11 w-full rounded-md border bg-background px-3" value={caseId} onChange={event => { setCaseId(event.target.value); setPath([]); setFolders(null); }}><option value="">Escolha o caso</option>{cases?.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          {!cases && <p role="status" className="text-sm">Carregando casos…</p>}
          {cases?.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não participa de um caso.</p>}
          {caseId && <div className="grid gap-2"><p className="text-sm">Pasta de destino</p><div className="flex flex-wrap items-center gap-1"><Button variant="ghost" className="min-h-11" onClick={() => { setPath([]); setFolders(null); }}>Raiz do caso</Button>{path.map((folder, index) => <Button variant="ghost" className="min-h-11" key={folder.id} onClick={() => { setPath(path.slice(0, index + 1)); setFolders(null); }}>{folder.name}</Button>)}</div>
            {!folders && <p role="status" className="text-sm">Carregando pastas…</p>}
            {folders?.map(folder => <Button key={folder.id} variant="outline" className="min-h-11 justify-start" onClick={() => { setPath([...path, folder]); setFolders(null); }}>{folder.name}</Button>)}
            {folders?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma subpasta neste destino.</p>}
          </div>}
          <Button className="min-h-11" disabled={!caseId || busy || !folders} onClick={() => void review()}>{busy ? 'Preparando…' : 'Revisar publicação'}</Button>
        </div> : <div className="grid min-w-0 gap-4">
          <p className="text-sm">Destino: {preview.destination}</p><p className="text-sm text-muted-foreground">{preview.audience}</p>
          <p className="text-sm">Versão particular {preview.artifactVersion}</p><h3 className="display text-2xl">{preview.title}</h3>
          <pre className="max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border p-4 font-sans text-sm">{preview.content}</pre>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setPreview(null)}>Voltar</Button><Button className="min-h-11" disabled={busy} onClick={() => void publish()}>{busy ? 'Publicando…' : 'Confirmar publicação'}</Button></div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
