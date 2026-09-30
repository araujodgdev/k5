'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import Link from 'next/link';
import { signatureDto, signatureLabels, type Signature } from '@/lib/signatures/contracts';
import { portalFileDto } from '@/lib/client-portal/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { controlClass, Failure, Field } from '@/components/honorarios/fields';
import { portalCall } from '@/components/client-portal/client';

const list = z.object({ signatures: z.array(signatureDto) });
function SignatureRows({ rows, pending, refresh, cancel, recover, client }: { rows: Signature[]; pending: boolean; refresh?: (id: string) => void;
  cancel?: (id: string) => void; recover?: (id: string, token: string) => void; client: boolean }) {
  const [cancelId, setCancelId] = useState('');
  return <div className="divide-y">{rows.map(row => <div key={row.id} className="grid min-w-0 gap-2 py-4"><p className="break-all text-sm font-medium">{row.name}</p>
    <p className="break-words text-sm">{signatureLabels[row.state]} · {row.method === 'certificate' ? 'Certificado digital' : 'Código por e-mail'}{row.environment === 'sandbox' ? ' · Ambiente de teste' : ''}</p>
    {!client && <p className="break-all text-xs text-muted-foreground">Destinatário: {row.recipientEmail}</p>}
    {row.signedAt && <p className="text-xs text-muted-foreground">Assinatura registrada pelo provedor em {new Date(row.signedAt).toLocaleString('pt-BR')}</p>}
    <div className="flex flex-wrap gap-3">{client && row.signUrl && <a className="inline-flex min-h-11 items-center text-sm underline" href={row.signUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Assinar na ZapSign</a>}
      {row.downloadUrl && <a className="inline-flex min-h-11 items-center text-sm underline" href={row.downloadUrl}>Baixar PDF assinado</a>}
      <a className="inline-flex min-h-11 items-center text-sm underline" href={row.evidenceUrl}>Baixar evidências</a>
      {refresh && !['signed','cancelled'].includes(row.state) && <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => refresh(row.id)}>Atualizar assinatura</Button>}
      {cancel && row.state === 'pending' && <Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => setCancelId(row.id)}>Cancelar solicitação</Button>}</div>
    {cancelId === row.id && cancel && <div className="grid gap-2"><p className="text-sm">Cancelar esta solicitação na ZapSign? A exclusão no provedor é definitiva.</p><div className="flex flex-wrap gap-3"><Button className="min-h-11" disabled={pending} onClick={() => { cancel(row.id); setCancelId(''); }}>Confirmar cancelamento</Button><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => setCancelId('')}>Manter solicitação</Button></div></div>}
    {row.state === 'uncertain' && <><p className="text-sm text-muted-foreground">O envio não teve confirmação. O Lume não repete o envio automaticamente.</p>{recover && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); recover(row.id, String(form.get('providerToken') ?? '').trim()); }}><p className="break-all text-xs text-muted-foreground">Confira na conta ZapSign o documento com ID externo {row.id}. Se ele foi criado, vincule seu token para recuperar o resultado.</p><Field label="Token do documento criado na ZapSign">{id => <Input id={id} className="min-h-11" name="providerToken" required disabled={pending} maxLength={36} />}</Field><Button className="min-h-11 justify-self-start" variant="outline" type="submit" disabled={pending}>Vincular documento existente</Button></form>}</>}
  </div>)}</div>;
}
export function SignatureManager({ clientId, files, active, canManage }: { clientId: string; files: z.output<typeof portalFileDto>[]; active: boolean; canManage: boolean }) {
  const [rows, setRows] = useState<Signature[] | null>(null), [fileId, setFileId] = useState(''), [method, setMethod] = useState<'email' | 'certificate'>('email');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const busy = useRef(false), attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const url = `/api/signatures/manage/${clientId}`;
  useEffect(() => { const controller = new AbortController(); void portalCall(url, { signal: controller.signal }).then(body => { setRows(list.parse(body).signatures); setError(''); })
    .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as assinaturas.'); }); return () => controller.abort(); }, [url, revision]);
  async function mutate(input: unknown) {
    if (busy.current) return; busy.current = true; setPending(true); setError(''); setNotice('');
    try { const result = list.parse(await portalCall(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); setRows(result.signatures); setNotice('Solicitações atualizadas. Confira o status abaixo.'); }
    catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível conectar. Tente novamente.'); }
    finally { busy.current = false; setPending(false); }
  }
  const available = files.filter(file => file.kind === 'published' && file.byteSize <= 10_000_000 && !rows?.some(row => row.fileId === file.id));
  return <section className="mt-7 min-w-0 border-t pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Assinaturas</h3><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => setRevision(value => value + 1)}>Atualizar lista de assinaturas</Button></div>
    {canManage && <><p className="my-4 max-w-2xl text-sm text-muted-foreground">A ZapSign envia o PDF e o convite de assinatura por e-mail ao cliente do portal. <Link href="/app/integrations" className="underline">Configure a conexão em Integrações.</Link> A opção com certificado exige um certificado do cliente compatível com o provedor.</p>
      {!active && <p className="mb-4 text-sm">O cliente precisa aceitar o convite do portal para receber uma solicitação.</p>}
      <form className="grid max-w-xl gap-4" onSubmit={event => { event.preventDefault(); const fingerprint = JSON.stringify([clientId, fileId, method]); if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }; void mutate({ operation: 'request', fileId, method, idempotencyKey: attempt.current.key }); }}>
        <Field label="PDF publicado para assinatura (até 10 MB)">{id => <select id={id} className={controlClass} disabled={pending || !active || !rows} required value={fileId} onChange={event => setFileId(event.target.value)}><option value="">Escolha um PDF</option>{available.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select>}</Field>
        <Field label="Forma de assinatura">{id => <select id={id} className={controlClass} disabled={pending} value={method} onChange={event => setMethod(event.target.value === 'certificate' ? 'certificate' : 'email')}><option value="email">Assinatura e código por e-mail · sem certificado</option><option value="certificate">Certificado digital do cliente</option></select>}</Field>
        <Button className="min-h-11 justify-self-start" type="submit" disabled={pending || !active || !available.some(file => file.id === fileId)}>Enviar PDF para assinatura</Button>
      </form></>}
    {!rows ? <p role="status" className="py-4">{error ? 'Assinaturas indisponíveis.' : 'Carregando assinaturas…'}</p> : rows.length ? <SignatureRows rows={rows} pending={pending} client={false}
      refresh={canManage ? id => void mutate({ operation: 'refresh', id }) : undefined} cancel={canManage ? id => void mutate({ operation: 'cancel', id }) : undefined}
      recover={canManage ? (id, providerToken) => void mutate({ operation: 'recover', id, providerToken }) : undefined} /> : <p className="py-4 text-sm text-muted-foreground">Nenhuma assinatura solicitada.</p>}
    <Failure message={error} />{notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
  </section>;
}
export function ClientSignatures({ accessId }: { accessId: string }) {
  const [rows, setRows] = useState<Signature[] | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), url = `/api/signatures/client/${accessId}`;
  useEffect(() => { const controller = new AbortController(); void portalCall(url, { signal: controller.signal }).then(body => { setRows(list.parse(body).signatures); setError(''); })
    .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as assinaturas.'); }); return () => controller.abort(); }, [url]);
  async function refresh(id: string) {
    if (busy.current) return; busy.current = true; setPending(true); setError('');
    try { setRows(list.parse(await portalCall(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })).signatures); }
    catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível confirmar. Tente novamente.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="min-w-0"><h2 className="border-b pb-4 font-medium">Assinaturas</h2>{!rows ? <p role="status" className="py-4">{error ? 'Assinaturas indisponíveis.' : 'Carregando assinaturas…'}</p> : rows.length ? <SignatureRows client rows={rows} pending={pending} refresh={id => void refresh(id)} /> : <p className="py-4 text-sm text-muted-foreground">Nenhuma assinatura solicitada.</p>}
    <p className="mt-4 text-sm text-muted-foreground">Se o escritório pedir assinatura pelo gov.br, baixe o PDF recebido, <a className="underline" href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">assine no gov.br</a> e envie o PDF assinado pelo formulário do portal. O escritório fará a conferência.</p><Failure message={error} />
  </section>;
}
