'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { z } from 'zod';
import type { driveFileDto, driveImportDto, drivePermissionDto } from '@/lib/capabilities/google';
import type { OfficeRole } from '@/lib/offices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DrivePicker } from './drive-picker';
import { GoogleConnectionNotice, googleCall, useGoogleAction, type GoogleStatus } from './client';

type DriveFile = z.infer<typeof driveFileDto>;
type Import = z.infer<typeof driveImportDto>;
type Permission = z.infer<typeof drivePermissionDto>;
type VaultDoc = { id: string; name: string; status: string; byteSize: number };
const row = 'flex min-h-12 flex-wrap items-center gap-3 border-b py-2 text-sm';
const select = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9';
const when = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const kindLabel: Record<DriveFile['kind'], string> = {
  document: 'Documento', spreadsheet: 'Planilha', presentation: 'Apresentação', pdf: 'PDF', other: 'Outro formato',
};
function importState(value: Import) {
  return value.status === 'completed' ? 'Copiado para o Cofre' : value.status === 'queued' ? 'Na fila'
    : value.status === 'running' ? 'Copiando' : `Falhou: ${value.errorMessage ?? 'tente importar novamente'}`;
}
function operationState(status: string) {
  return status === 'succeeded' ? 'Concluído no Google' : status === 'failed' ? 'O Google recusou a ação'
    : 'Resultado em verificação. Aguarde antes de repetir.';
}

/** Selected Drive files stay personal; the picker copies them to this Vault destination. */
export function DrivePanel({ role, initialCaseId, initialFolderId, onImported }: {
  role: OfficeRole; initialCaseId?: string; initialFolderId?: string | null; onImported?: () => void;
}) {
  const canWrite = role !== 'reviewer';
  const { run, approvalDialog } = useGoogleAction();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [imports, setImports] = useState<Import[]>([]);
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [docText, setDocText] = useState('');
  const [revisionId, setRevisionId] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [rename, setRename] = useState('');
  const [email, setEmail] = useState('');
  const [shareRole, setShareRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const completedImports = useRef(new Set<string>());
  const selected = files.find(file => file.id === selectedId) ?? null;
  const available = !!status?.connection && status.connection.status === 'active' &&
    !!status.modules.find(module => module.module === 'drive' && module.granted && module.rolledOut && module.enabledByOffice);

  const refresh = useCallback(async () => {
    const [filePage, imported] = await Promise.all([
      googleCall<{ files: DriveFile[] }>('drive-files', { limit: 100, offset: 0 }),
      googleCall<{ imports: Import[] }>('drive-imports', { ...(initialCaseId ? { caseId: initialCaseId, folderId: initialFolderId ?? null } : { scope: 'library' }), limit: 100 }),
    ]);
    setFiles(filePage.files); setImports(imported.imports);
    const newlyCompleted = imported.imports.some(item => item.status === 'completed' && !completedImports.current.has(item.id));
    for (const item of imported.imports) if (item.status === 'completed') completedImports.current.add(item.id);
    if (newlyCompleted) onImported?.();
  }, [initialCaseId, initialFolderId, onImported]);
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const current = await googleCall<GoogleStatus>('status');
      if (!active) return;
      setStatus(current);
      const feature = current.modules.find(item => item.module === 'drive');
      if (current.connection?.status === 'active' && feature?.granted && feature.rolledOut && feature.enabledByOffice) await refresh();
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Não foi possível carregar o Drive.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (!available || !imports.some(item => item.status === 'queued' || item.status === 'running')) return;
    const timer = window.setTimeout(() => { void refresh().catch(() => undefined); }, 4000);
    return () => window.clearTimeout(timer);
  }, [available, imports, refresh]);
  useEffect(() => {
    if (!available) return;
    let active = true;
    fetch(`/api/vault/documents?${initialCaseId ? `caseId=${encodeURIComponent(initialCaseId)}` : 'scope=library'}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() as Promise<{ documents: VaultDoc[] }> : { documents: [] })
      .then(data => { if (active) setVaultDocs(data.documents.filter(doc => doc.status === 'ready' && doc.byteSize <= 50 * 1024 * 1024)); })
      .catch(() => { if (active) setVaultDocs([]); });
    return () => { active = false; };
  }, [initialCaseId, available, imports]);

  async function act<T>(work: () => Promise<T>, done: (result: T) => void) {
    setBusy(true); setError(''); setMessage('');
    try { done(await work()); }
    catch (e) { if (!(e instanceof Error && e.message === 'Operação cancelada.')) setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(false); }
  }
  const destination = { scope: initialCaseId ? 'case' as const : 'library' as const,
    caseId: initialCaseId ?? null, folderId: initialFolderId ?? null };
  async function picked(ids: string[]) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await googleCall<{ files: DriveFile[] }>('drive-register', { googleFileIds: ids });
      setFiles(current => [...result.files, ...current.filter(file => !result.files.some(picked => picked.id === file.id))]);
      setSelectedId(result.files[0]?.id ?? null);
      setRename(result.files[0]?.name ?? '');
      setPermissions(null); setDocText(''); setRevisionId(''); setDocumentId('');
      const importable = result.files.filter(file => file.state === 'available' && file.importFormat && file.capabilities.canDownload);
      const copies = await Promise.allSettled(importable.map(file => googleCall<{ import: Import }>('drive-import',
        { fileId: file.id, ...destination, idempotencyKey: crypto.randomUUID() })));
      const queued = copies.filter((copy): copy is PromiseFulfilledResult<{ import: Import }> => copy.status === 'fulfilled');
      setImports(current => [...queued.map(copy => copy.value.import), ...current]);
      setMessage(`${queued.length} arquivo(s) enviado(s) para ${initialCaseId ? 'este caso' : 'a Biblioteca'}.`);
      const failures = copies.filter((copy): copy is PromiseRejectedResult => copy.status === 'rejected');
      if (failures.length) setError(`${failures.length} arquivo(s) não puderam ser importados. ${failures[0].reason instanceof Error ? failures[0].reason.message : ''}`);
      if (!importable.length) setMessage('Os arquivos escolhidos não estão disponíveis para importação.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível importar os arquivos.'); }
    finally { setBusy(false); }
  }
  async function doImport() {
    if (!selected) return;
    await act(() => googleCall<{ import: Import }>('drive-import', { fileId: selected.id, ...destination,
      idempotencyKey: crypto.randomUUID() }), result => {
      setImports(current => [result.import, ...current]);
      setMessage('A cópia entrou na fila do Cofre. O arquivo original no Google continua independente.');
    });
  }
  async function reloadFile(fileId: string) {
    await act(() => googleCall<{ file: DriveFile }>('drive-file-refresh', { fileId }), result => {
      setFiles(current => current.map(file => file.id === fileId ? result.file : file));
      setMessage(result.file.state === 'available' ? 'Arquivo atualizado.' : 'O arquivo não está mais disponível nesta conta.');
    });
  }
  async function loadPermissions(fileId: string) {
    await act(() => googleCall<{ permissions: Permission[] }>('drive-permissions', { fileId }), result => setPermissions(result.permissions));
  }
  async function loadDoc(fileId: string) {
    await act(() => googleCall<{ document: { text: string; revisionId: string } }>('docs-read', { fileId }), result => {
      setDocText(result.document.text); setRevisionId(result.document.revisionId);
    });
  }
  async function mutate<T extends { operation: { status: string } }>(operation: Parameters<typeof run>[0], payload: Record<string, unknown>, after?: (result: T) => void) {
    await act(() => run<T>(operation, payload), result => {
      after?.(result); setMessage(operationState(result.operation.status));
    });
  }
  function choose(file: DriveFile) {
    setSelectedId(file.id); setPermissions(null); setDocText(''); setRevisionId('');
    setRename(file.name); setFind(''); setReplace(''); setError(''); setMessage('');
  }
  return <section className="border-t py-6 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11" aria-label="Arquivos do Google Drive">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-medium">Google Drive</h2>
      {available && canWrite && <DrivePicker onPicked={picked} disabled={busy} />}
    </div>
    {loading && <p className="mt-4 text-sm text-muted-foreground" role="status">Carregando arquivos…</p>}
    {status && !available && <GoogleConnectionNotice status={status} module="drive" />}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}
    {available && !loading && <>
      <p className="mt-3 text-sm text-muted-foreground">Destino: {initialCaseId ? initialFolderId ? 'esta pasta' : 'este caso' : 'Biblioteca'}. A cópia fica no Cofre; o original permanece na sua conta Google.</p>
      {!files.length ? <p className="mt-6 text-sm text-muted-foreground">Nenhum arquivo escolhido. Abra o seletor para começar.</p> :
        <div className="mt-5 divide-y border-y" role="list" aria-label="Arquivos escolhidos">
          {files.map(file => <div key={file.id} role="listitem" className={row}>
            <button type="button" onClick={() => choose(file)} aria-expanded={selectedId === file.id}
              className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="block truncate font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">{file.kind === 'other' ? file.mimeType : kindLabel[file.kind]} · {file.sharedDrive ? 'Drive compartilhado' : 'Meu Drive'} · versão {file.version ?? 'não informada'} · {file.state === 'available' ? 'disponível' : 'acesso perdido'}</span>
            </button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void reloadFile(file.id)}>Atualizar</Button>
          </div>)}
        </div>}
      {selected && <div className="mt-6 border-t pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-medium">{selected.name}</h3><p className="text-xs text-muted-foreground">Última alteração: {when(selected.modifiedTime)} · {selected.sizeBytes === null ? 'tamanho não informado' : `${Math.ceil(selected.sizeBytes / 1024)} KB`}</p></div>
          {selected.webViewLink && <a href={selected.webViewLink} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Abrir no Google</a>}
        </div>
        {selected.state === 'available' && canWrite && <>
          <div className="mt-5 grid gap-3 border-t pt-5">
            <h4 className="font-medium">Copiar para o Cofre</h4>
            <p className="text-sm text-muted-foreground">Reimportar este arquivo cria outra versão da cópia neste destino.</p>
            <div><Button type="button" onClick={() => void doImport()} disabled={!selected.importFormat || !selected.capabilities.canDownload || busy}>Importar novamente</Button></div>
            {!selected.importFormat && <p className="text-sm text-muted-foreground">Este formato não pode ser importado para o Cofre.</p>}
          </div>
          {selected.capabilities.canRename && <form className="mt-5 flex flex-wrap items-end gap-3 border-t pt-5" onSubmit={(e: FormEvent) => {
            e.preventDefault(); void mutate<{ file: DriveFile | null; operation: { status: string } }>('drive-rename', { fileId: selected.id, name: rename },
              result => { if (result.file) setFiles(current => current.map(file => file.id === selected.id ? result.file! : file)); });
          }}><div className="grid min-w-48 flex-1 gap-1.5"><Label htmlFor="drive-rename">Renomear no Google</Label><Input id="drive-rename" value={rename} onChange={e => setRename(e.target.value)} maxLength={255} /></div>
            <Button variant="outline" disabled={busy || !rename.trim() || rename === selected.name}>Renomear</Button></form>}
          {selected.capabilities.canModifyContent && !selected.mimeType.startsWith('application/vnd.google-apps.') && <>
            <div className="mt-5 grid max-w-md gap-2 border-t pt-5"><Label htmlFor="drive-version">Enviar documento do Cofre como nova versão no Google</Label>
              <select id="drive-version" value={documentId} onChange={e => setDocumentId(e.target.value)} className={select}><option value="">Escolha um documento</option>
                {vaultDocs.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select>
              <div><Button variant="outline" disabled={busy || !documentId} onClick={() => void mutate('drive-version', { fileId: selected.id, documentId },
                (result: { file: DriveFile | null; operation: { status: string } }) => { if (result.file) setFiles(current => current.map(file => file.id === selected.id ? result.file! : file)); })}>Enviar versão</Button></div>
            </div>
          </>}
        </>}
        <div className="mt-5 border-t pt-5">
          <Button variant="outline" disabled={busy} onClick={() => void loadPermissions(selected.id)}>Ver acessos no Google</Button>
          {permissions && <div className="mt-3 divide-y border-y">{permissions.length ? permissions.map(p => <div key={p.id} className={row}>
            <span className="min-w-0 flex-1 break-words">{p.emailAddress ?? p.displayName ?? p.type} · {p.role} {p.inherited && '· herdado do Drive compartilhado'}</span>
            {canWrite && p.removable && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate('drive-revoke', { fileId: selected.id, permissionId: p.id },
              () => void loadPermissions(selected.id))}>Remover acesso</Button>}
          </div>) : <p className="py-3 text-sm text-muted-foreground">Nenhum acesso listado.</p>}</div>}
          {canWrite && selected.capabilities.canShare && <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => {
            e.preventDefault(); void mutate('drive-share', { fileId: selected.id, email, role: shareRole, notify: true },
              () => { setEmail(''); void loadPermissions(selected.id); });
          }}><div className="grid min-w-48 flex-1 gap-1.5"><Label htmlFor="drive-share-email">Compartilhar com uma pessoa</Label><Input id="drive-share-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="drive-share-role">Permissão</Label><select id="drive-share-role" className={select} value={shareRole} onChange={e => setShareRole(e.target.value as typeof shareRole)}>
              <option value="reader">Leitor</option><option value="commenter">Comentarista</option><option value="writer">Editor</option></select></div>
            <Button variant="outline" disabled={busy || !email}>Compartilhar</Button></form>}
        </div>
        {selected.mimeType === 'application/vnd.google-apps.document' && <div className="mt-5 grid gap-3 border-t pt-5">
          <div><Button variant="outline" disabled={busy} onClick={() => void loadDoc(selected.id)}>Ler no Google Docs</Button></div>
          {revisionId && <>
            <p className="text-xs text-muted-foreground">Revisão {revisionId}. O conteúdo abaixo vem do Google e deve ser conferido.</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-y py-3 text-sm font-sans">{docText}</pre>
            {canWrite && selected.capabilities.canEdit && <form className="grid gap-3" onSubmit={(e: FormEvent) => {
              e.preventDefault(); void mutate<{ revisionId: string | null; operation: { status: string } }>('docs-edit',
                { fileId: selected.id, revisionId, edits: [{ find, replace }] }, result => {
                  if (result.operation.status === 'succeeded') void loadDoc(selected.id);
                });
            }}><div className="grid gap-1.5"><Label htmlFor="docs-find">Trecho exato e único</Label><Textarea id="docs-find" value={find} onChange={e => setFind(e.target.value)} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="docs-replace">Substituir por</Label><Textarea id="docs-replace" value={replace} onChange={e => setReplace(e.target.value)} /></div>
              <div><Button disabled={busy || !find}>Revisar e editar no Google Docs</Button></div>
            </form>}
          </>}
        </div>}
      </div>}
      <div className="mt-7 border-t pt-5"><h3 className="font-medium">Cópias no Cofre</h3>
        {!imports.length ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma cópia criada nesta conta.</p> :
          <div className="mt-3 divide-y border-y">{imports.map(item => <div key={item.id} className={row}>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{item.fileName}</p>
              <p className="text-xs text-muted-foreground">{importState(item)} · {item.sourceAccount} · origem {item.sourceVersion ?? 'sem versão'} · {when(item.completedAt ?? item.createdAt)}{item.sha256 && ` · SHA-256 ${item.sha256.slice(0, 12)}…`}</p></div>
            {item.vaultDocumentId && <Link href={item.caseId ? `/app/vault/cases/${encodeURIComponent(item.caseId)}` : '/app/vault/library'} className="underline underline-offset-4">Abrir {item.caseId ? 'caso' : 'Biblioteca'}</Link>}
          </div>)}</div>}
      </div>
    </>}
    {approvalDialog}
  </section>;
}
