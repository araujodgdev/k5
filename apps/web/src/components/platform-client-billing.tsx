'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ClientBilling, FinancePayment } from '@/lib/billing/platform-billing';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from './ui/alert-dialog';
import { PlatformPayments, PaymentPagination, formatMoney, formatDate } from './platform-payments';

type Confirmation = { action: 'refund' | 'cancel'; targetId: string; amount: number; sandbox: boolean };
const subscriptionStatuses: Record<string,string> = { PENDING: 'Aguardando adesão', ACTIVE: 'Ativa', CANCELLED: 'Cancelada', EXPIRED: 'Expirada' };
const actionStatuses: Record<string,string> = { REQUESTED: 'Solicitada', SUCCEEDED: 'Confirmada', FAILED: 'Recusada', UNCERTAIN: 'Aguardando confirmação' };

export function PlatformClientBilling({ data }: { data: ClientBilling }) {
  const router = useRouter();
  const administrators = data.members.filter(member => member.role === 'administrator');
  const [memberId,setMemberId] = useState(administrators[0]?.id ?? '');
  const [recurring,setRecurring] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [link,setLink] = useState('');
  const [confirmation,setConfirmation] = useState<Confirmation | null>(null);
  const openSubscription = data.subscriptions.some(item => ['ACTIVE','PENDING'].includes(item.status));

  async function command(body: Record<string, unknown>) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/platform/offices/${data.office.id}/billing`,{ method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
      if (typeof result.url === 'string') { setLink(result.url); setMessage('Link pronto para copiar e enviar ao cliente.'); }
      else setMessage(body.action === 'refresh' ? 'Consulta concluída. Confira a situação atualizada abaixo.' : 'Solicitação enviada. A confirmação pode levar alguns instantes; use Atualizar pagamentos para conferir.');
      setConfirmation(null); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setMessage('Link copiado.'); setError(''); }
    catch { setLink(url); setError('Não foi possível copiar automaticamente. Selecione o link abaixo e copie.'); }
  }
  function actions(payment: FinancePayment) {
    return <>
      {payment.status === 'PENDING' && <Button variant="ghost" className="h-11 px-0 md:h-9" onClick={()=>void copy(payment.url)}>Copiar link</Button>}
      {payment.status === 'PAID' && payment.kind === 'ONE_TIME' && !payment.actionStatus && <Button variant="ghost" disabled={busy} className="h-11 px-0 md:h-9" onClick={()=>setConfirmation({ action: 'refund',targetId: payment.id,amount: payment.amount,sandbox: payment.devMode })}>Reembolsar</Button>}
    </>;
  }
  return <section className="space-y-8">
    <div><Link className="text-sm underline underline-offset-4" href="/app/admin/clients">Voltar para clientes</Link><h2 className="mt-4 break-words text-3xl tracking-tight">{data.office.name}</h2><p className="mt-2 text-sm text-muted-foreground">Cliente desde {formatDate(data.office.createdAt)} · {data.members.length} {data.members.length === 1 ? 'pessoa' : 'pessoas'}</p></div>
    <div className="flex flex-wrap items-end justify-between gap-4 border-y border-line py-5"><div><p className="label-mono text-muted-foreground">Plano Lume</p><p className="mt-2 text-xl">{data.overview.paidUntil ? `${data.overview.active ? 'Pago até' : 'Venceu em'} ${formatDate(data.overview.paidUntil)}` : 'Sem período pago'}</p></div><Button variant="outline" disabled={busy || !data.overview.configured} className="h-11 md:h-9" onClick={()=>void command({ action: 'refresh' })}>{busy ? 'Aguarde…' : 'Atualizar pagamentos'}</Button></div>
    <section aria-labelledby="new-payment" className="space-y-4">
      <h3 id="new-payment" className="label-mono">Gerar cobrança</h3>
      {!data.overview.configured && <p className="text-sm text-muted-foreground">Os pagamentos ainda não foram configurados neste ambiente.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm">Responsável no escritório<select value={memberId} onChange={event=>setMemberId(event.target.value)} className="h-11 min-w-0 border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"><option value="" disabled>Selecione um administrador</option>{administrators.map(member=><option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm">Tipo de cobrança<select value={recurring ? 'subscription' : 'one-time'} onChange={event=>setRecurring(event.target.value === 'subscription')} className="h-11 border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-ring"><option value="one-time">Um mês avulso · {formatMoney(data.overview.price)}</option><option value="subscription" disabled={openSubscription}>Assinatura mensal · {formatMoney(data.overview.price)}/mês</option></select></label>
      </div>
      <p className="text-sm text-muted-foreground">{recurring ? 'O cliente conclui a adesão no checkout seguro. Depois, a cobrança no cartão é automática a cada mês, até o cancelamento.' : 'O cliente paga por PIX ou cartão. O pagamento adiciona um mês ao prazo atual, sem renovação automática.'} O cadastro de cobrança existente será reutilizado.</p>
      {!recurring && openSubscription && <p className="text-sm">Este cliente já tem uma assinatura ativa ou aguardando adesão. Uma cobrança avulsa será adicional.</p>}
      {!administrators.length && <p className="text-sm">O cliente precisa de um administrador para gerar uma cobrança.</p>}
      <Button disabled={busy || !memberId || !data.overview.configured || (recurring && openSubscription)} className="h-11" onClick={()=>void command({ action: 'checkout',memberId,recurring })}>{busy ? 'Aguarde…' : 'Gerar link de pagamento'}</Button>
      {link && <div className="flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1"><span className="sr-only">Link de pagamento</span><Input className="h-11" value={link} readOnly onFocus={event=>event.target.select()} /></label><Button variant="outline" className="h-11" onClick={()=>void copy(link)}>Copiar link</Button></div>}
    </section>
    {message && <p role="status" className="border-l-2 border-brand pl-3 text-sm">{message}</p>}
    {error && !confirmation && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <section aria-labelledby="subscriptions" className="space-y-4"><h3 id="subscriptions" className="label-mono">Assinaturas</h3>
      {data.subscriptions.length ? <div className="divide-y border-y border-line">{data.subscriptions.map(subscription=><div key={subscription.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><p>{formatMoney(subscription.amount)}/mês · {subscriptionStatuses[subscription.status]}{subscription.devMode ? ' · Teste' : ''}</p><p className="mt-1 break-all text-xs text-muted-foreground">{subscription.providerId ?? subscription.checkoutId}</p>{subscription.paymentFailed && subscription.status === 'ACTIVE' && <p className="mt-2 text-sm">Falha na última cobrança. Aguardando nova tentativa da AbacatePay.</p>}</div>{subscription.status === 'ACTIVE' && subscription.providerId && <Button variant="outline" disabled={busy} className="h-11 md:h-9" onClick={()=>setConfirmation({ action: 'cancel',targetId: subscription.providerId!,amount: subscription.amount,sandbox: subscription.devMode })}>Cancelar renovação</Button>}</div>)}</div> : <p className="text-sm text-muted-foreground">Nenhuma assinatura criada para este cliente.</p>}
      <p className="text-xs text-muted-foreground">Cancelar interrompe as próximas cobranças e mantém o período já pago. Para retomar uma assinatura cancelada, gere uma nova adesão. A AbacatePay não oferece reembolso de assinaturas pela API.</p>
    </section>
    <section aria-labelledby="payments"><h3 id="payments" className="label-mono mb-4">Pagamentos</h3><PlatformPayments payments={data.payments} actions={actions} /><PaymentPagination page={data.page} total={data.total} href={page=>`/app/admin/clients/${data.office.id}?page=${page}`} /></section>
    {data.actions.length>0 && <section aria-labelledby="activity"><h3 id="activity" className="label-mono mb-4">Últimas ações</h3><div className="divide-y">{data.actions.map(action=><p className="py-3 text-sm" key={action.id}>{action.action === 'refund' ? 'Reembolso' : 'Cancelamento'} · {actionStatuses[action.status]}<span className="mt-1 block text-xs text-muted-foreground">{action.actorName ?? 'Administrador removido'} · {formatDate(action.createdAt)}</span></p>)}</div></section>}
    <AlertDialog open={Boolean(confirmation)} onOpenChange={open=>{ if (!open && !busy) { setConfirmation(null);setError(''); } }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{confirmation?.action === 'refund' ? 'Confirmar reembolso integral' : 'Cancelar renovação mensal'}</AlertDialogTitle><AlertDialogDescription>{data.office.name} · {formatMoney(confirmation?.amount ?? 0)}{confirmation?.sandbox ? ' · Pagamento de teste' : ''}. {confirmation?.action === 'refund' ? 'O valor integral será devolvido e o mês correspondente será removido do prazo pago. Esta ação não pode ser desfeita.' : 'Nenhuma nova cobrança será feita nesta assinatura. O período já pago será preservado. Para voltar, o cliente precisará concluir uma nova adesão.'}</AlertDialogDescription></AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel><Button disabled={busy} onClick={()=>confirmation && void command({ action: confirmation.action,targetId: confirmation.targetId })}>{busy ? 'Aguarde…' : confirmation?.action === 'refund' ? 'Confirmar reembolso' : 'Confirmar cancelamento'}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </section>;
}
