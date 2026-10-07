'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { chargeDto, type HonorarioCharge } from '@/lib/honorarios/charges-contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { honorariosCall } from './client';
import { controlClass, Failure, Field } from './fields';
import { money } from './editor';
import { AsaasChargeSection } from './asaas-charge';

export function ChargeForm({ installmentId, back, busy }: { installmentId: string; back: () => void; busy: (value: boolean) => void }) {
  const [charge, setCharge] = useState<HonorarioCharge | null>(null);
  const [pixKey, setPixKey] = useState('');
  const [instructions, setInstructions] = useState('');
  const [boleto, setBoleto] = useState<HonorarioCharge['boleto']>(null);
  const [reminders, setReminders] = useState(true);
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'other'>('whatsapp');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const running = useRef(false);
  const attempt = useRef<{ input: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void honorariosCall('charge-get', { installmentId }, chargeDto, controller.signal).then(value => {
      setCharge(value); setPixKey(value.pixKey); setInstructions(value.instructions); setBoleto(value.boleto); setReminders(value.remindersEnabled); setError('');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a cobrança.'); });
    return () => controller.abort();
  }, [installmentId, revision]);
  useEffect(() => { busy(pending); return () => busy(false); }, [busy, pending]);
  const dirty = Boolean(charge && (pixKey.trim() !== charge.pixKey || instructions.trim() !== charge.instructions || boleto?.id !== charge.boleto?.id || reminders !== charge.remindersEnabled));
  async function perform(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setPending(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { running.current = false; setPending(false); }
  }
  async function save(operation: 'charge-prepare' | 'charge-sent') {
    if (!charge) return;
    const input = operation === 'charge-prepare' ? { installmentId, version: charge.version, pixKey, instructions, boletoDocumentId: boleto?.id ?? null, remindersEnabled: reminders } : { installmentId, version: charge.version, channel };
    const fingerprint = JSON.stringify([operation, input]);
    if (attempt.current?.input !== fingerprint) attempt.current = { input: fingerprint, key: crypto.randomUUID() };
    const next = await honorariosCall(operation, { ...input, idempotencyKey: attempt.current.key }, chargeDto);
    setCharge(next); setNotice(operation === 'charge-prepare' ? 'Cobrança salva. Baixe o PDF ou copie a mensagem para enviar.' : 'Envio registrado no histórico.');
  }
  async function upload(file: File) {
    if (file.type !== 'application/pdf' || file.size > 10_000_000) throw new Error('Escolha um boleto em PDF de até 10 MB.');
    const body = new FormData(); body.set('file', file); body.set('scope', 'library');
    const response = await fetch('/api/vault/documents', { method: 'POST', body });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error('Não foi possível anexar o boleto. Confira o arquivo e tente novamente.');
    setBoleto(z.object({ document: z.object({ id: z.string(), name: z.string() }) }).parse(value).document);
    setNotice('Boleto anexado ao Cofre. Salve a cobrança para vinculá-lo à parcela.');
  }
  async function download() {
    if (!charge?.pdfUrl) return;
    const response = await fetch(charge.pdfUrl, { cache: 'no-store' });
    if (!response.ok) { const value = z.object({ error: z.string() }).safeParse(await response.json().catch(() => null)); throw new Error(value.success ? value.data.error : 'Não foi possível gerar o PDF.'); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'cobranca.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  async function publication() {
    if (!charge) return;
    const response = await fetch('/api/client-portal/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      operation: charge.portalPublished ? 'withdraw-charge' : 'publish-charge', data: { clientId: charge.installment.clientId, installmentId, version: charge.version },
    }) });
    const body: unknown = await response.json();
    if (!response.ok) { const result = z.object({ error: z.string() }).safeParse(body); throw new Error(result.success ? result.data.error : 'Não foi possível publicar a cobrança.'); }
    const result = z.object({ published: z.boolean() }).parse(body);
    setCharge({ ...charge, portalPublished: result.published }); setNotice(result.published ? 'Cobrança publicada no portal deste cliente.' : 'Cobrança retirada do portal.');
  }
  const inactive = charge?.installment.status === 'cancelled' || charge?.installment.pendingCents === 0;
  return <div className="grid min-w-0 gap-5">
    <div className="grid gap-1"><h3 className="text-[15px] font-semibold">Cobrança da parcela {charge?.installment.number}</h3><p className="text-[13.5px] text-muted-foreground">Emita a cobrança pelo Asaas ou prepare as instruções para pagamento direto ao advogado, com o boleto emitido pelo banco, se houver.</p></div>
    {!charge ? <><Failure message={error} /><p role="status" className="text-[13.5px] text-muted-foreground">Carregando cobrança…</p><Button variant="outline" size="lg" className="max-md:h-11" onClick={() => setRevision(value => value + 1)}>Tentar novamente</Button></> : <>
      <p className="text-[13.5px]">Saldo atual: <span className="font-mono text-[12.5px]">{money(charge.installment.pendingCents)}</span></p>
      <AsaasChargeSection installmentId={installmentId} busy={busy} changed={reload} />
      <h3 className="text-[15px] font-semibold">Instruções para pagamento direto</h3>
      <form onSubmit={event => { event.preventDefault(); void perform(() => save('charge-prepare')); }} className="grid gap-4">
        <fieldset disabled={pending || inactive} className="grid min-w-0 gap-4">
          <Field label="Chave PIX">{id => <Input id={id} className="max-md:h-11" maxLength={140} value={pixKey} onChange={event => setPixKey(event.target.value)} />}</Field>
          <Field label="Instruções de pagamento">{id => <Textarea id={id} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Nome do titular, banco e orientações para o cliente" />}</Field>
          <Field label="Boleto em PDF (até 10 MB)">{id => <Input id={id} className="max-md:h-11" type="file" accept="application/pdf,.pdf" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(() => upload(file)); }} />}</Field>
          {boleto && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-words">{boleto.name}</span><Button type="button" size="lg" className="max-md:h-11" variant="ghost" onClick={() => setBoleto(null)}>Remover da cobrança</Button></div>}
          <label className="flex min-h-11 items-start gap-2.5 text-[13.5px] md:min-h-8"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={reminders} onChange={event => setReminders(event.target.checked)} />Lembrar o responsável 3 dias antes, no vencimento e a cada 7 dias de atraso.</label>
          <Button type="submit" size="lg" className="max-md:h-11 justify-self-start">{pending ? 'Salvando…' : 'Salvar cobrança'}</Button>
        </fieldset>
      </form>
      {charge.version > 0 && <section className="grid min-w-0 gap-3 border-t border-border pt-4"><h3 className="text-[15px] font-semibold">Enviar ao cliente</h3><p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-4 py-3 text-[13.5px]">{charge.message}</p><p className="text-xs text-muted-foreground">Copie a mensagem para enviar no seu canal habitual. Registre o envio depois de realizá-lo.</p>
        <Button size="lg" className="max-md:h-11 justify-self-start" variant="outline" disabled={pending || dirty || (!charge.pdfUrl && !charge.portalPublished)} onClick={() => void perform(publication)}>{charge.portalPublished ? 'Retirar cobrança do portal' : 'Publicar cobrança no portal'}</Button>
        <div className="flex flex-wrap gap-2"><Button size="lg" className="max-md:h-11" variant="outline" disabled={pending || dirty || !charge.pdfUrl} onClick={() => void perform(download)}>Baixar PDF</Button><Button size="lg" className="max-md:h-11" variant="outline" disabled={pending || dirty || !charge.pdfUrl} onClick={() => void perform(async () => { await navigator.clipboard.writeText(charge.message); setNotice('Mensagem copiada.'); })}>Copiar mensagem</Button>{charge.boleto && <a className="inline-flex h-11 items-center rounded-md px-3 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground md:h-[34px]" href={`/api/vault/documents/${encodeURIComponent(charge.boleto.id)}/download`}>Baixar boleto</a>}</div>
        {dirty && <p role="status" className="text-[13.5px] text-muted-foreground">Salve as alterações antes de enviar.</p>}
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Field label="Canal de envio">{id => <select id={id} className={controlClass} value={channel} onChange={event => { const value = event.target.value; if (value === 'whatsapp' || value === 'email' || value === 'other') setChannel(value); }}><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="other">Outro</option></select>}</Field></div><Button size="lg" className="max-md:h-11" disabled={pending || dirty || !charge.pdfUrl} onClick={() => void perform(() => save('charge-sent'))}>Registrar envio realizado</Button></div>
      </section>}
      <section className="grid gap-1 border-t border-border pt-4"><h3 className="text-[15px] font-semibold">Histórico da cobrança</h3>{charge.history.length ? <div>{charge.history.map(event => <p key={event.id} className="py-2.5 text-[13.5px]">{event.operation === 'prepare' ? 'Cobrança salva' : `Envio registrado (${event.channel === 'whatsapp' ? 'WhatsApp' : event.channel === 'email' ? 'e-mail' : 'outro'})`} por {event.createdByName} em {new Date(event.createdAt).toLocaleString('pt-BR')}{event.notes && ` — ${event.notes}`}</p>)}</div> : <p className="py-1 text-[13.5px] text-muted-foreground">Nenhuma cobrança preparada.</p>}</section>
      <Failure message={error} />{notice && <p role="status" className="text-[13.5px] text-muted-foreground">{notice}</p>}
    </>}
    <Button variant="ghost" size="lg" className="max-md:h-11 justify-self-start" disabled={pending} onClick={back}>Voltar às parcelas</Button>
  </div>;
}
