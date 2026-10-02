'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { portalManageDto, type PortalManage } from '@/lib/client-portal/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { controlClass, Failure, Field } from '@/components/honorarios/fields';
import { portalCall, portalMutation } from './client';

const states = { invited: 'Convite aguardando aceite', active: 'Acesso ativo', expired: 'Convite expirado', revoked: 'Acesso revogado' };
export function PortalManager({ clientId, initialEmail }: { clientId: string; initialEmail: string }) {
  const [data, setData] = useState<PortalManage | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [invitation, setInvitation] = useState('');
  const [artifactId, setArtifactId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const running = useRef(false);
  const uploadKey = useRef(crypto.randomUUID());
  const artifactAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void portalCall(`/api/client-portal/manage?clientId=${encodeURIComponent(clientId)}`, { signal: controller.signal }).then(body => { setData(portalManageDto.parse(body)); setError(''); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o portal.'); });
    return () => controller.abort();
  }, [clientId, revision]);
  async function perform(action: () => Promise<void>) {
    if (running.current) return; running.current = true; setPending(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível conectar. Tente novamente.'); }
    finally { running.current = false; setPending(false); }
  }
  async function invite() {
    const result = portalManageDto.extend({ invitationPath: z.string() }).parse(await portalMutation('invite', { clientId, email, version: data?.access?.version ?? 0 }));
    setData(result); setInvitation(new URL(result.invitationPath, window.location.origin).href); setNotice('Convite criado. Copie o link e envie ao cliente. O link vence em 7 dias.');
  }
  async function publishArtifact() {
    const artifact = data?.artifacts.find(row => row.id === artifactId);
    if (!artifact) throw new Error('Escolha um documento.');
    const fingerprint = JSON.stringify([clientId, artifact.id, artifact.version]);
    if (artifactAttempt.current?.fingerprint !== fingerprint) artifactAttempt.current = { fingerprint, key: crypto.randomUUID() };
    await portalMutation('publish-artifact', { clientId, artifactId: artifact.id, version: artifact.version, idempotencyKey: artifactAttempt.current.key });
    setRevision(value => value + 1); setNotice('A versão selecionada foi publicada em PDF para este cliente.');
  }
  async function publishFile() {
    if (!file) throw new Error('Escolha um PDF.');
    const form = new FormData(); form.set('file', file); form.set('idempotencyKey', uploadKey.current);
    await portalCall(`/api/client-portal/manage/${clientId}/files`, { method: 'POST', body: form });
    setFile(null); uploadKey.current = crypto.randomUUID(); setRevision(value => value + 1); setNotice('PDF publicado para este cliente.');
  }
  return <section aria-labelledby="client-portal-title" className="min-w-0 border-t py-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="client-portal-title" className="font-medium">Portal do cliente</h2><Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => setRevision(value => value + 1)}>Atualizar portal</Button></div>
    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">O cliente acessa documentos publicados, envia arquivos e confere cobranças liberadas para ele. Observações internas e casos do Cofre permanecem no escritório.</p>
    {!data ? <p role="status" className="py-4">Carregando portal…</p> : <div className="mt-5 grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="grid min-w-0 content-start gap-4">
        {data.access ? <p className="break-words text-sm">{states[data.access.state]} · {data.access.email}</p> : <p className="text-sm text-muted-foreground">Este cliente ainda não tem acesso.</p>}
        <><form className="grid gap-3" onSubmit={event => { event.preventDefault(); void perform(invite); }}><Field label="E-mail para acesso ao portal">{id => <Input id={id} className="min-h-11" type="email" required maxLength={254} value={email} disabled={pending} onChange={event => setEmail(event.target.value)} />}</Field><Button className="min-h-11 justify-self-start" disabled={pending} type="submit">{data.access ? 'Gerar novo convite' : 'Convidar cliente'}</Button></form>
          {data.access?.state === 'active' && <p className="text-xs text-muted-foreground">Um novo convite encerra o acesso atual até que seja aceito.</p>}
          {invitation && <div className="grid gap-2"><Field label="Link do convite">{id => <Input id={id} className="min-h-11" readOnly value={invitation} onFocus={event => event.target.select()} />}</Field><Button className="min-h-11 justify-self-start" variant="outline" disabled={pending} onClick={() => void perform(async () => { await navigator.clipboard.writeText(invitation); setNotice('Link copiado.'); })}>Copiar convite</Button></div>}
          {data.access && data.access.state !== 'revoked' && <Button className="min-h-11 justify-self-start" variant="ghost" disabled={pending} onClick={() => void perform(async () => { setData(portalManageDto.parse(await portalMutation('revoke', { clientId, version: data.access?.version }))); setInvitation(''); setNotice('Acesso e convite revogados.'); })}>Revogar acesso ao portal</Button>}
        </>
      </div>
      <div className="grid min-w-0 content-start gap-5">
        <><form className="grid gap-3" onSubmit={event => { event.preventDefault(); void perform(publishArtifact); }}><Field label="Publicar documento do Lume em PDF">{id => <select id={id} className={controlClass} disabled={pending} value={artifactId} onChange={event => setArtifactId(event.target.value)}><option value="">Escolha um documento</option>{data.artifacts.map(row => <option key={row.id} value={row.id}>{row.title} · versão {row.version}</option>)}</select>}</Field><Button className="min-h-11 justify-self-start" variant="outline" type="submit" disabled={pending || !artifactId}>Publicar versão em PDF</Button></form>
          <form className="grid gap-3 border-t pt-5" onSubmit={event => { event.preventDefault(); void perform(publishFile); }}><Field label="Publicar PDF do computador (até 20 MB)">{id => <Input id={id} className="min-h-11" type="file" accept=".pdf,application/pdf" disabled={pending} onChange={event => { setFile(event.target.files?.[0] ?? null); uploadKey.current = crypto.randomUUID(); }} />}</Field><Button className="min-h-11 justify-self-start" variant="outline" type="submit" disabled={pending || !file}>Publicar PDF para o cliente</Button></form>
          <p className="text-xs text-muted-foreground">Publique cobranças dentro da parcela em Honorários. Comprovantes enviados pelo cliente aguardam conferência; não dão baixa automática.</p>
        </>
        <div className="border-t pt-5"><h3 className="text-sm font-medium">Documentos e arquivos trocados</h3>{data.files.length ? <div className="mt-2 divide-y">{data.files.map(row => <div key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><a href={row.url} className="inline-flex min-h-11 items-center break-all text-sm underline underline-offset-4">{row.name}</a><p className="text-xs text-muted-foreground">{row.kind === 'published' ? 'Publicado pelo escritório' : row.kind === 'proof' ? 'Comprovante para conferência' : 'Enviado pelo cliente'} · {new Date(row.createdAt).toLocaleString('pt-BR')}</p>{row.kind === 'proof' && <Link href={`/app/honorarios?clientId=${clientId}`} className="inline-flex min-h-11 items-center text-xs underline">Conferir nos honorários</Link>}</div><Button className="min-h-11" variant="ghost" disabled={pending} aria-label={`Retirar ${row.name} do portal`} onClick={() => void perform(async () => { await portalMutation('remove-file', { clientId, fileId: row.id }); setRevision(value => value + 1); setNotice('Arquivo retirado do portal.'); })}>Retirar do portal</Button></div>)}</div> : <p className="py-4 text-sm text-muted-foreground">Nenhum documento publicado ou enviado.</p>}</div>
      </div>
    </div>}
    <Failure message={error} />{notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
  </section>;
}
