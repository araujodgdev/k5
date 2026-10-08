'use client';

import { useRouter } from '@/components/lume/canvas-navigation';
import { useState } from 'react';
import { CircleAlert, History, Info } from 'lucide-react';
import type { ClientBilling, FinancePayment } from '@/lib/billing/platform-billing';
import type { CreditOverview } from '@/lib/billing/credits';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from './ui/alert-dialog';
import { DataTable, Field, Pill } from './canvas/canvas-controls';
import {
  AdminBlock, AdminBlockHead, AdminDetailHead, AdminFact, AdminFacts, AdminFields, AdminGrid, AdminNote, AdminPages,
  adminButton, adminInput, adminQuietAction, adminSelect,
} from './admin/admin-blocks';
import { PlatformPayments, PAYMENTS_PER_PAGE, formatMoney, formatDate } from './platform-payments';
import { PlatformClientWhatsApp } from './platform-client-whatsapp';
import { PlatformClientCredits } from './platform-client-credits';

type Confirmation = { action: 'refund' | 'cancel'; targetId: string; amount: number; sandbox: boolean; credits?: boolean };
const subscriptionStatuses: Record<string,string> = { PENDING: 'Aguardando adesão', ACTIVE: 'Ativa', CANCELLED: 'Cancelada', EXPIRED: 'Expirada' };
const actionStatuses: Record<string,string> = { REQUESTED: 'Solicitada', SUCCEEDED: 'Confirmada', FAILED: 'Recusada', UNCERTAIN: 'Aguardando confirmação' };

/** The blocks an operation reports to; the confirmation dialog reports its own failures. */
type Place = 'plan' | 'charge' | 'subscriptions' | 'payments' | 'dialog';
type Notice = { place: Place; tone: 'status' | 'alert'; text: string };

function NoticeLine({ notice, place }: { notice: Notice | null; place: Place }) {
  if (notice?.place !== place) return null;
  if (notice.tone === 'status') return <p role="status" className="text-[12.5px] text-muted-foreground">{notice.text}</p>;
  return <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{notice.text}</p>;
}

export function PlatformClientBilling({ data, credits }: { data: ClientBilling; credits: CreditOverview }) {
  const router = useRouter();
  const [memberId,setMemberId] = useState(data.members[0]?.id ?? '');
  const [recurring,setRecurring] = useState(false);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState<Notice | null>(null);
  // A payment link to copy by hand, shown in the block that produced it.
  const [link,setLink] = useState<{ place: Place; url: string } | null>(null);
  const [confirmation,setConfirmation] = useState<Confirmation | null>(null);
  const openSubscription = data.subscriptions.some(item => ['ACTIVE','PENDING'].includes(item.status));
  // The server allows one active subscription per office, so its renewal is the one to cancel.
  const renewing = data.subscriptions.find(item => item.status === 'ACTIVE' && item.providerId);
  const failing = data.subscriptions.some(item => item.status === 'ACTIVE' && item.paymentFailed);
  const people = data.members.length;

  async function command(body: Record<string, unknown>, place: Place, failPlace: Place = place) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/platform/offices/${data.office.id}/billing`,{ method: 'POST',headers: { 'content-type': 'application/json' },body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
      if (typeof result.url === 'string') { setLink({ place, url: result.url }); setNotice({ place, tone: 'status', text: 'Link pronto para copiar e enviar ao cliente.' }); }
      else setNotice({ place, tone: 'status', text: body.action === 'refresh' ? 'Consulta concluída. Confira a situação atualizada abaixo.' : 'Solicitação enviada. A confirmação pode levar alguns instantes; use Atualizar pagamentos para conferir.' });
      setConfirmation(null); router.refresh();
    } catch (failure) { setNotice({ place: failPlace, tone: 'alert', text: failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.' }); }
    finally { setBusy(false); }
  }
  async function copy(url: string, place: Place) {
    try { await navigator.clipboard.writeText(url); setNotice({ place, tone: 'status', text: 'Link copiado.' }); }
    catch { setLink({ place, url }); setNotice({ place, tone: 'alert', text: 'Não foi possível copiar automaticamente. Selecione o link abaixo e copie.' }); }
  }
  const linkField = (place: Place) => link?.place === place && <div className="flex flex-col gap-2 sm:flex-row">
    <label className="min-w-0 flex-1"><span className="sr-only">Link de pagamento</span><Input className={adminInput} value={link.url} readOnly onFocus={event=>event.target.select()} /></label>
    <Button variant="outline" className={adminButton} onClick={()=>void copy(link.url, place)}>Copiar link</Button>
  </div>;
  function actions(payment: FinancePayment) {
    return <>
      {payment.status === 'PENDING' && <button type="button" className={adminQuietAction} onClick={()=>void copy(payment.url, 'payments')}>Copiar link</button>}
      {payment.status === 'PAID' && payment.kind !== 'SUBSCRIPTION' && !payment.actionStatus && <button type="button" disabled={busy} className={adminQuietAction}
        onClick={()=>setConfirmation({ action: 'refund',targetId: payment.id,amount: payment.amount,sandbox: payment.devMode,credits: payment.kind === 'CREDITS' })}>Reembolsar</button>}
    </>;
  }
  const unconfigured = !data.overview.configured && <AdminNote icon={Info}>Os pagamentos ainda não foram configurados neste ambiente.</AdminNote>;

  return <>
    <AdminDetailHead back={{ href: '/app/admin/clients', label: 'Voltar para clientes' }} title={data.office.name}
      sub={`Cliente desde ${formatDate(data.office.createdAt)} · ${people} ${people === 1 ? 'pessoa' : 'pessoas'}`} />
    <AdminGrid>
      <PlatformClientWhatsApp key={data.office.id} officeId={data.office.id} />

      <AdminBlock half card labelledBy="client-plan">
        <AdminBlockHead id="client-plan" level={3} title="Plano Lume" actions={
          <Button variant="outline" disabled={busy || !data.overview.configured} className={adminButton} onClick={()=>void command({ action: 'refresh' }, 'plan')}>{busy ? 'Aguarde…' : 'Atualizar pagamentos'}</Button>
        } />
        <AdminFacts>
          {data.overview.paidUntil
            ? <AdminFact label={data.overview.active ? 'Pago até' : 'Venceu em'} mono>{formatDate(data.overview.paidUntil)}</AdminFact>
            : <AdminFact label="Situação">Sem período pago</AdminFact>}
        </AdminFacts>
        {unconfigured}
        <NoticeLine notice={notice} place="plan" />
      </AdminBlock>

      <PlatformClientCredits officeId={data.office.id} credits={credits} />

      <AdminBlock half card labelledBy="new-payment">
        <AdminBlockHead id="new-payment" level={3} title="Gerar cobrança" sub={recurring
          ? `${formatMoney(data.overview.price)} por mês no cartão, até o cancelamento.`
          : `${formatMoney(data.overview.price)} por PIX ou cartão. Adiciona um mês ao prazo, sem renovação.`} />
        {unconfigured}
        <AdminFields>
          <Field label="Responsável no escritório" htmlFor="charge-member" className="min-w-[140px] flex-[1_1_0]">
            <select id="charge-member" value={memberId} onChange={event=>setMemberId(event.target.value)} className={adminSelect}><option value="" disabled>Selecione o advogado</option>{data.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select>
          </Field>
          <Field label="Tipo de cobrança" htmlFor="charge-kind" className="min-w-[140px] flex-[1_1_0]">
            <select id="charge-kind" value={recurring ? 'subscription' : 'one-time'} onChange={event=>setRecurring(event.target.value === 'subscription')} className={adminSelect}><option value="one-time">Um mês avulso</option><option value="subscription" disabled={openSubscription}>Assinatura mensal</option></select>
          </Field>
          <Button variant="outline" disabled={busy || !memberId || !data.overview.configured || (recurring && openSubscription)} className={adminButton} onClick={()=>void command({ action: 'checkout',memberId,recurring }, 'charge')}>{busy ? 'Aguarde…' : 'Gerar link de pagamento'}</Button>
        </AdminFields>
        {!recurring && openSubscription && <AdminNote icon={Info}>Este cliente já tem uma assinatura ativa ou aguardando adesão. Uma cobrança avulsa será adicional.</AdminNote>}
        {!people && <AdminNote icon={Info}>O cliente precisa de um advogado cadastrado para gerar uma cobrança.</AdminNote>}
        {linkField('charge')}
        <NoticeLine notice={notice} place="charge" />
      </AdminBlock>

      <AdminBlock half card labelledBy="subscriptions">
        <AdminBlockHead id="subscriptions" level={3} title="Assinaturas" actions={renewing &&
          <Button variant="outline" disabled={busy} className={adminButton} onClick={()=>setConfirmation({ action: 'cancel',targetId: renewing.providerId!,amount: renewing.amount,sandbox: renewing.devMode })}>Cancelar renovação</Button>
        } />
        {failing && <AdminNote icon={CircleAlert}>Falha na última cobrança. Aguardando nova tentativa da AbacatePay.</AdminNote>}
        <DataTable label="Assinaturas do cliente" tall rows={data.subscriptions} rowKey={subscription => subscription.id} empty="Nenhuma assinatura criada para este cliente." columns={[
          { header: 'Assinatura', width: 'minmax(0, 1fr)', cell: subscription => `Assinatura mensal${subscription.devMode ? ' · Teste' : ''}`,
            sub: subscription => `${formatMoney(subscription.amount)} por mês` },
          { header: 'Situação', width: '132px', align: 'end', cell: subscription =>
            <Pill tone={subscription.status === 'ACTIVE' && subscription.paymentFailed ? 'accent' : 'muted'}>{subscriptionStatuses[subscription.status] ?? subscription.status}</Pill> },
        ]} />
        <NoticeLine notice={notice} place="subscriptions" />
      </AdminBlock>

      <AdminBlock card labelledBy="payments">
        <AdminBlockHead id="payments" level={3} title="Pagamentos" />
        <PlatformPayments payments={data.payments} actions={actions} />
        {linkField('payments')}
        <NoticeLine notice={notice} place="payments" />
        {data.total > PAYMENTS_PER_PAGE && <AdminPages label="Páginas de pagamentos" page={data.page} pages={Math.ceil(data.total / PAYMENTS_PER_PAGE)}
          summary={`${data.total} ${data.total === 1 ? 'cobrança' : 'cobranças'}`} href={page => `/app/admin/clients/${data.office.id}${page > 1 ? `?page=${page}` : ''}`} />}
      </AdminBlock>

      <AdminBlock card labelledBy="activity">
        <AdminBlockHead id="activity" level={3} title="Últimas ações" />
        {data.actions.length === 0 ? <AdminNote icon={History}>Nenhum reembolso ou cancelamento.</AdminNote> : (
          <DataTable label="Últimas ações de cobrança" rows={data.actions} rowKey={action => action.id} columns={[
            { header: 'Ação', width: 'minmax(0, 1fr)', cell: action => `${action.action === 'refund' ? 'Reembolso' : 'Cancelamento'} · ${actionStatuses[action.status] ?? action.status}` },
            { header: 'Quem', width: '190px', cell: action => action.actorName ?? 'Administrador removido' },
            { header: 'Quando', width: '96px', align: 'end', mono: true, cell: action => formatDate(action.createdAt) },
          ]} />
        )}
      </AdminBlock>
    </AdminGrid>

    <AlertDialog open={Boolean(confirmation)} onOpenChange={open=>{ if (!open && !busy) { setConfirmation(null); setNotice(null); } }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{confirmation?.action === 'refund' ? 'Confirmar reembolso integral' : 'Cancelar renovação mensal'}</AlertDialogTitle><AlertDialogDescription>{data.office.name} · {formatMoney(confirmation?.amount ?? 0)}{confirmation?.sandbox ? ' · Pagamento de teste' : ''}. {confirmation?.action === 'refund' ? (confirmation.credits ? 'O valor integral será devolvido e os créditos do pacote serão retirados do saldo, mesmo que já tenham sido usados. Esta ação não pode ser desfeita.' : 'O valor integral será devolvido, e o mês correspondente e seus créditos serão retirados. Esta ação não pode ser desfeita.') : 'Nenhuma nova cobrança será feita nesta assinatura. O período já pago será preservado. Para voltar, o cliente precisará concluir uma nova adesão.'}</AlertDialogDescription></AlertDialogHeader>
      <NoticeLine notice={notice} place="dialog" />
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel><Button disabled={busy} onClick={()=>confirmation && void command({ action: confirmation.action,targetId: confirmation.targetId }, confirmation.action === 'refund' ? 'payments' : 'subscriptions', 'dialog')}>{busy ? 'Aguarde…' : confirmation?.action === 'refund' ? 'Confirmar reembolso' : 'Confirmar cancelamento'}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
