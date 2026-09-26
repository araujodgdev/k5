'use client';

import { ArrowRight, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SmartMark } from '@/components/smart-options';
import type { DigestPeriod, DigestThread, EmailDigest, EmailInsightResult, ThreadInsight } from '@/lib/google/gmail/insights-contracts';
import { cn } from '@/lib/utils';

export type Pending<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; error: string };

export const periodNames: Record<DigestPeriod, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };
const periodSpan: Record<DigestPeriod, string> = { day: 'das últimas 24 horas', week: 'dos últimos 7 dias', month: 'dos últimos 30 dias' };

export async function requestInsight(body: { kind: 'digest'; period: DigestPeriod } | { kind: 'thread'; threadId: string }, signal?: AbortSignal): Promise<EmailInsightResult> {
  const response = await fetch('/api/integrations/google/mail-insights', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal });
  const result = await response.json().catch(() => null) as (EmailInsightResult & { error?: string }) | null;
  if (!response.ok || !result || result.status !== 'ready') {
    throw new Error(result?.error && response.status < 500 ? result.error : body.kind === 'digest'
      ? 'Não foi possível preparar o resumo. Tente novamente.' : 'Não foi possível resumir esta conversa. Tente novamente.');
  }
  return result;
}

const when = (value: string) => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const sender = (value: string) => value.replace(/<[^<>]*>/g, '').replace(/"/g, '').trim() || value;

/** The Lume at work: the mark trades its strokes while the text says what is happening. */
function Working({ children }: { children: React.ReactNode }) {
  return <p role="status" className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
    <span className="smart-options grid size-6 place-items-center text-module-lume" data-busy><SmartMark width={18} height={18} /></span>{children}
  </p>;
}

function ThreadRow({ thread, detail, onOpen }: { thread: DigestThread; detail?: React.ReactNode; onOpen: (id: string) => void }) {
  return <button type="button" onClick={() => onOpen(thread.threadId)}
    className="group hover-rise block w-full border-b px-1 py-3 text-left transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
    <span className="flex items-baseline justify-between gap-3">
      <span className={cn('min-w-0 truncate text-sm', thread.unread ? 'font-semibold' : 'font-medium')}>{thread.subject}</span>
      <span className="label-mono shrink-0 text-subtle-foreground transition-colors duration-500 group-hover:text-brand-foreground">{when(thread.date)}</span>
    </span>
    <span className="mt-0.5 block truncate text-xs text-muted-foreground transition-colors duration-500 group-hover:text-brand-foreground">{sender(thread.from)}</span>
    {detail && <span className="mt-1 block text-sm text-muted-foreground transition-colors duration-500 group-hover:text-brand-foreground">{detail}</span>}
  </button>;
}

export function DigestView({ period, state, onPeriod, onOpenThread, onRetry, onClose, headingRef }: {
  period: DigestPeriod; state: Pending<EmailDigest> | undefined; onPeriod: (period: DigestPeriod) => void;
  onOpenThread: (id: string) => void; onRetry: () => void; onClose: () => void; headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const digest = state?.status === 'ready' ? state.value : null;
  return <section aria-labelledby="email-digest-title" className="pb-10">
    <div className="flex items-center justify-between gap-3 border-b py-4">
      <h2 id="email-digest-title" ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">Resumo dos e-mails</h2>
      <Button type="button" variant="ghost" size="icon" aria-label="Fechar resumo" onClick={onClose}><X /></Button>
    </div>
    <div role="group" aria-label="Período do resumo" className="mt-5 inline-grid grid-cols-3 border border-input">
      {(Object.keys(periodNames) as DigestPeriod[]).map(value => <button key={value} type="button" aria-pressed={period === value}
        onClick={() => onPeriod(value)}
        className={cn('h-9 min-w-20 px-4 text-sm transition-colors duration-300 ease-(--ease) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:h-11 [&+&]:border-l [&+&]:border-input',
          period === value ? 'bg-foreground text-background' : 'hover:bg-accent')}>{periodNames[value]}</button>)}
    </div>
    {(!state || state.status === 'loading') && <Working>Lendo seus e-mails {periodSpan[period]}…</Working>}
    {state?.status === 'failed' && <div className="py-8"><p role="alert" className="text-sm text-destructive">{state.error}</p>
      <Button type="button" variant="outline" className="mt-3" onClick={onRetry}><RotateCcw aria-hidden="true" />Tentar novamente</Button></div>}
    {digest && <div className="mt-6">
      <p className="border-l-2 border-brand pl-4 text-base leading-7">{digest.headline}</p>
      {digest.attention.length > 0 && <div className="mt-8">
        <p className="label-mono mb-1 flex items-center gap-2 text-subtle-foreground"><span className="square-dot text-brand" aria-hidden="true" />Pedem atenção</p>
        {digest.attention.map(item => <ThreadRow key={item.threadId} thread={item} onOpen={onOpenThread}
          detail={<>{item.reason}{item.needsReply ? ' Aguarda sua resposta.' : ''}</>} />)}
      </div>}
      {digest.themes.map(theme => <div key={theme.title} className="mt-8">
        <h3 className="text-sm font-medium">{theme.title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{theme.summary}</p>
        {theme.threads.length > 0 && <div className="mt-2">{theme.threads.map(thread => <ThreadRow key={thread.threadId} thread={thread} onOpen={onOpenThread} />)}</div>}
      </div>)}
      <p className="mt-8 text-xs leading-5 text-subtle-foreground">
        {digest.count === 1 ? '1 conversa' : `${digest.count} conversas`} {periodSpan[period]} na caixa de entrada{digest.truncated ? ', as mais recentes' : ''}, sem promoções e redes sociais.
        {digest.judged ? ' Prioridade e respostas pendentes julgadas pelo Jev (TypeSafe AI).' : ''} Resumo escrito pelo Lume; confira os e-mails antes de agir.
      </p>
    </div>}
  </section>;
}

export function ThreadInsightView({ state, canWrite, onUseReply, onRetry, onClose }: {
  state: Pending<ThreadInsight>; canWrite: boolean; onUseReply: (body: string) => void; onRetry: () => void; onClose: () => void;
}) {
  if (state.status === 'loading') return <div className="border-b"><Working>Lendo a conversa…</Working></div>;
  if (state.status === 'failed') return <div className="border-b py-5"><p role="alert" className="text-sm text-destructive">{state.error}</p>
    <Button type="button" variant="outline" className="mt-3" onClick={onRetry}><RotateCcw aria-hidden="true" />Tentar novamente</Button></div>;
  const insight = state.value;
  return <section aria-label="Resumo do Lume" className="border-b py-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 border-l-2 border-brand pl-4">
        <p className="label-mono text-subtle-foreground">Resumo do Lume</p>
        <p className="mt-2 text-sm leading-6">{insight.overview}</p>
        {insight.points.length > 0 && <div className="mt-3 divide-y border-y">{insight.points.map(point => <p key={point} className="py-2 text-sm text-muted-foreground">{point}</p>)}</div>}
        {insight.needsReply === true && <p className="mt-3 text-sm font-medium">Aguarda sua resposta.</p>}
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="Fechar resumo" onClick={onClose}><X /></Button>
    </div>
    {canWrite && insight.replies.length > 0 && <div className="mt-6">
      <p className="label-mono mb-1 text-subtle-foreground">Respostas rápidas</p>
      {insight.replies.map(reply => <button key={reply.intent} type="button" onClick={() => onUseReply(reply.body)}
        className="group hover-rise flex w-full items-start justify-between gap-4 border-b px-1 py-3 text-left transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{reply.label}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground transition-colors duration-500 group-hover:text-brand-foreground">{reply.body}</span>
        </span>
        <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 transition-transform duration-300 ease-(--ease) group-hover:translate-x-1" />
      </button>)}
      <p className="mt-2 text-xs text-subtle-foreground">A resposta abre no editor para você revisar; nada é enviado sem você.</p>
    </div>}
    {canWrite && insight.replies.length === 0 && <p className="mt-4 text-xs text-subtle-foreground">Esta conversa não parece pedir resposta.</p>}
  </section>;
}
