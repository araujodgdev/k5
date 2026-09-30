'use client';
import { useEffect, useRef, useState } from 'react';
import { portalViewDto, type PortalView } from '@/lib/client-portal/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { controlClass, Failure, Field } from '@/components/honorarios/fields';
import { money, dateLabel } from '@/components/honorarios/editor';
import { portalCall } from './client';

export function ClientPortal({ accesses }: { accesses: { id: string; officeName: string; clientName: string }[] }) {
  const [accessId, setAccessId] = useState(accesses[0]?.id ?? '');
  const [data, setData] = useState<PortalView | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [installmentId, setInstallmentId] = useState('');
  const [pending, setPending] = useState(false);
  const attempt = useRef(crypto.randomUUID());
  const running = useRef(false);
  useEffect(() => {
    if (!accessId) return;
    const controller = new AbortController();
    void portalCall(`/api/client-portal/${accessId}`, { signal: controller.signal }).then(body => { setData(portalViewDto.parse(body)); setError(''); })
      .catch(cause => { if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o portal.'); } });
    return () => controller.abort();
  }, [accessId, revision]);
  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file || running.current) return;
    running.current = true; setPending(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.set('file', file); form.set('idempotencyKey', attempt.current); if (installmentId) form.set('installmentId', installmentId);
      await portalCall(`/api/client-portal/${accessId}/files`, { method: 'POST', body: form });
      setFile(null); attempt.current = crypto.randomUUID(); setRevision(value => value + 1);
      setNotice(installmentId ? 'Comprovante enviado. O escritório fará a conferência do pagamento.' : 'Arquivo enviado ao escritório.');
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível enviar. Tente novamente.'); }
    finally { running.current = false; setPending(false); }
  }
  return <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-7 md:px-10 md:py-10">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="page-title">Portal do cliente</h1><Button className="min-h-11" variant="outline" disabled={pending} onClick={() => setRevision(value => value + 1)}>Atualizar documentos</Button></div>
    {!accesses.length ? <p className="py-8 text-sm text-muted-foreground">Nenhum acesso ativo. Peça um convite ao seu escritório ou um novo link se o acesso foi revogado.</p> : <>
      <div className="max-w-lg py-6"><Field label="Escritório e cliente">{id => <select id={id} className={controlClass} disabled={pending} value={accessId} onChange={event => { setData(null); setInstallmentId(''); setFile(null); setAccessId(event.target.value); }}>{accesses.map(access => <option key={access.id} value={access.id}>{access.officeName} · {access.clientName}</option>)}</select>}</Field></div>
      {!data ? <p role="status" className="py-4">{error ? 'Portal indisponível.' : 'Carregando documentos…'}</p> : <div className="grid min-w-0 gap-9 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-8">
          <section><h2 className="border-b pb-4 font-medium">Documentos e arquivos</h2>{data.files.length ? <div className="divide-y">{data.files.map(row => <div key={row.id} className="min-w-0 py-4"><a className="inline-flex min-h-11 items-center break-all text-sm underline underline-offset-4" href={row.url}>{row.name}</a><p className="text-xs text-muted-foreground">{row.kind === 'published' ? 'Recebido do escritório' : row.kind === 'proof' ? 'Comprovante enviado para conferência' : 'Arquivo enviado'} · {new Date(row.createdAt).toLocaleString('pt-BR')}</p></div>)}</div> : <p className="py-6 text-sm text-muted-foreground">Nenhum documento compartilhado ainda.</p>}</section>
          <section><h2 className="border-b pb-4 font-medium">Pagamentos</h2>{data.charges.length ? <div className="divide-y">{data.charges.map(charge => <div key={charge.id} className="grid gap-2 py-5"><h3 className="break-words text-sm font-medium">{charge.title} · Parcela {charge.number}</h3><p className="text-sm">{charge.status === 'received' ? 'Pagamento confirmado pelo escritório' : charge.status === 'cancelled' ? 'Cobrança cancelada' : `Saldo a pagar: ${money(charge.pendingCents)}`} · {dateLabel(charge.dueOn)}</p>{charge.pdfUrl && <><p className="whitespace-pre-wrap break-words py-2 text-sm text-muted-foreground">{charge.message}</p><div className="flex flex-wrap gap-3"><a className="inline-flex min-h-11 items-center text-sm underline" href={charge.pdfUrl}>Baixar cobrança em PDF</a>{charge.boletoUrl && <a className="inline-flex min-h-11 items-center text-sm underline" href={charge.boletoUrl}>Baixar boleto</a>}<Button variant="outline" className="min-h-11" disabled={pending} onClick={() => { setInstallmentId(charge.id); document.getElementById('portal-upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Enviar comprovante desta parcela</Button></div></>}</div>)}</div> : <p className="py-6 text-sm text-muted-foreground">Nenhuma cobrança publicada para você.</p>}</section>
        </div>
        <section id="portal-upload" className="min-w-0"><h2 className="border-b pb-4 font-medium">Enviar ao escritório</h2><p className="py-4 text-sm text-muted-foreground">Envie documentos ou comprovantes em PDF, DOCX, PNG ou JPG, de até 20 MB. O escritório confere os comprovantes antes de confirmar o pagamento.</p>
          <p className="pb-4 text-sm text-muted-foreground">Se o escritório pedir assinatura pelo gov.br, baixe o PDF recebido, <a className="underline" href="https://assinador.iti.br/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">assine no gov.br</a> e envie o PDF assinado pelo formulário do portal. O escritório fará a conferência.</p>
          <form onSubmit={upload} className="grid min-w-0 gap-4"><fieldset className="grid min-w-0 gap-4" disabled={pending}><Field label="Tipo de envio">{id => <select id={id} className={controlClass} value={installmentId} onChange={event => { setInstallmentId(event.target.value); attempt.current = crypto.randomUUID(); }}><option value="">Documento para o escritório</option>{data.charges.filter(charge => charge.pdfUrl).map(charge => <option key={charge.id} value={charge.id}>Comprovante: {charge.title}, parcela {charge.number}</option>)}</select>}</Field><Field label="Arquivo para enviar">{id => <Input id={id} className="min-h-11" type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" onChange={event => { setFile(event.target.files?.[0] ?? null); attempt.current = crypto.randomUUID(); }} />}</Field><Button className="min-h-11 justify-self-start" type="submit" disabled={!file}>{pending ? 'Enviando…' : 'Enviar arquivo ao escritório'}</Button></fieldset></form>
        </section>
      </div>}
    </>}
    <Failure message={error} />{notice && <p role="status" className="mt-5 text-sm">{notice}</p>}
  </main>;
}
