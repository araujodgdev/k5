'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, File, Inbox, Mails, Paperclip, PenLine, Search, Send, Star, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SmartOptions, type SmartOption } from '@/components/smart-options';
import type { OfficeRole } from '@/lib/offices';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { EmailTriageItem, EmailTriageResult } from '@/lib/google/gmail/triage-contracts';
import type { DigestPeriod, EmailDigest, ThreadInsight } from '@/lib/google/gmail/insights-contracts';
import { cn } from '@/lib/utils';
import { googleCall, GoogleClientError, GoogleConnectionNotice, type GoogleStatus, useGoogleAction } from './client';
import { EmailFrame } from './email-frame';
import { DigestView, periodNames, requestInsight, ThreadInsightView, type Pending } from './email-smart';

type ThreadSummary = CapabilityOutput<'k5_gmail_list_threads'>['threads'][number];
type Thread = CapabilityOutput<'k5_gmail_get_thread'>['thread'];
type DraftSummary = CapabilityOutput<'k5_gmail_list_drafts'>['drafts'][number];
type Draft = CapabilityOutput<'k5_gmail_get_draft'>['draft'];
type AttachmentRef = { kind: 'vault'; documentId: string; name: string } | { kind: 'upload'; uploadId: string; name: string } | {
  kind: 'draft'; partId: string; name: string };
type Editor = { draftId?: string; to: string; cc: string; bcc: string; subject: string; body: string;
  replyToMessageId: string | null; attachments: AttachmentRef[] };
type VaultCase = { id: string; name: string };
type VaultDocument = { id: string; name: string; status: string };
const blank = (): Editor => ({ to: '', cc: '', bcc: '', subject: '', body: '', replyToMessageId: null, attachments: [] });
const labels = { INBOX: 'Recebidos', STARRED: 'Com estrela', SENT: 'Enviados', DRAFT: 'Rascunhos', ALL: 'Todos' } as const;
const folderIcons: Record<keyof typeof labels, LucideIcon> = { INBOX: Inbox, STARRED: Star, SENT: Send, DRAFT: File, ALL: Mails };
type Folder = keyof typeof labels;
const categoryLabels: Record<EmailTriageItem['category'], string> = {
  clients: 'Clientes', proceedings: 'Processos', finance: 'Financeiro', scheduling: 'Agenda',
  informational: 'Informativo', other: 'Outros',
};
const priorityLabels: Record<EmailTriageItem['priority'], string> = { high: 'Alta', normal: 'Normal', low: 'Baixa' };
const priorityOrder = { high: 0, normal: 1, low: 2 };
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível carregar os e-mails.';
const splitAddresses = (value: string) => value.split(/[;,]/).map(x => x.trim()).filter(Boolean);
const address = (value: string) => value.match(/<([^<>]+)>/)?.[1] ?? value.trim();
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
/** Gmail-style list date: the time for today's messages, the day otherwise. */
const listDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
};
const selectClass = 'mt-1 h-11 w-full border border-input bg-background px-2 text-sm text-foreground md:h-9';

/** The reader's thread comes from its own route, which adds each message's HTML for the sandboxed frame. */
async function fetchThread(threadId: string): Promise<Thread> {
  const response = await fetch('/api/integrations/google/mail-thread', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId }), cache: 'no-store' });
  const result = await response.json().catch(() => null) as { thread?: Thread; error?: string } | null;
  if (!response.ok || !result?.thread) throw new GoogleClientError(result?.error ?? 'Não foi possível abrir a conversa.');
  return result.thread;
}

export function GmailPanel({ role, initialThreadId, initialDraftId }: { role: OfficeRole; initialThreadId?: string; initialDraftId?: string }) {
  const canWrite = role !== 'reviewer';
  const { run, approvalDialog } = useGoogleAction();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [folder, setFolder] = useState<Folder>('INBOX');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cases, setCases] = useState<VaultCase[]>([]);
  const [selectedCase, setSelectedCase] = useState('');
  const [vaultDocuments, setVaultDocuments] = useState<VaultDocument[]>([]);
  const [vaultDocumentId, setVaultDocumentId] = useState('');
  const [showVault, setShowVault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [triage, setTriage] = useState<{ pageKey: string; items: EmailTriageItem[] } | null>(null);
  const [triageBusy, setTriageBusy] = useState(false);
  const [triageMessage, setTriageMessage] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<EmailTriageItem['category'] | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<EmailTriageItem['priority'] | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'priority'>('recent');
  // Smart options: results live only while the page is open; nothing generated is stored.
  const [digestPeriod, setDigestPeriod] = useState<DigestPeriod | null>(null);
  const [digests, setDigests] = useState<Partial<Record<DigestPeriod, Pending<EmailDigest>>>>({});
  const [insights, setInsights] = useState<Record<string, Pending<ThreadInsight>>>({});
  const [insightOpen, setInsightOpen] = useState<string | null>(null);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const triageRequest = useRef(0);
  const smartRequests = useRef(new Map<string, AbortController>());
  const listScroller = useRef<HTMLDivElement>(null);
  const detailScroller = useRef<HTMLDivElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const hadMobileDetail = useRef(false);
  const detailVisible = Boolean(thread || editor || detailLoading || digestPeriod);
  const pageKey = JSON.stringify([folder, search, pageToken ?? '', revision]);
  const visibleTriage = useMemo(() => triage?.pageKey === pageKey ? triage.items : [], [triage, pageKey]);
  const triageById = useMemo(() => new Map(visibleTriage.map(item => [item.threadId, item])), [visibleTriage]);
  const visibleThreads = useMemo(() => {
    const filtered = threads.filter(item => {
      const result = triageById.get(item.id);
      return (categoryFilter === 'all' || result?.category === categoryFilter)
        && (priorityFilter === 'all' || result?.priority === priorityFilter);
    });
    return sortOrder === 'priority' ? filtered.sort((a, b) =>
      (priorityOrder[triageById.get(a.id)?.priority ?? 'normal'] - priorityOrder[triageById.get(b.id)?.priority ?? 'normal'])) : filtered;
  }, [threads, triageById, categoryFilter, priorityFilter, sortOrder]);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    if (detailVisible) {
      (detailHeading.current ?? detailScroller.current)?.focus();
      hadMobileDetail.current = true;
    } else if (hadMobileDetail.current) {
      listScroller.current?.focus();
      hadMobileDetail.current = false;
    }
  }, [detailVisible]);
  useEffect(() => { const requests = smartRequests.current; return () => requests.forEach(controller => controller.abort()); }, []);
  const enabled = Boolean(status?.configured && status.modules.some(m => m.module === 'gmail' && m.rolledOut && m.enabledByOffice && m.granted));

  useEffect(() => {
    let active = true;
    googleCall<GoogleStatus>('status').then(value => { if (active) setStatus(value); })
      .catch(error => { if (active) setFailure(message(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const request = ++listRequest.current;
    const promise = folder === 'DRAFT'
      ? googleCall<CapabilityOutput<'k5_gmail_list_drafts'>>('drafts', { pageToken, limit: 20 })
      : googleCall<CapabilityOutput<'k5_gmail_list_threads'>>('threads', { label: folder, query: search || undefined, pageToken, limit: 20 });
    promise.then(value => {
      if (!active || request !== listRequest.current) return;
      if ('drafts' in value) { setDrafts(value.drafts); setThreads([]); setNextToken(value.nextPageToken); }
      else { setThreads(value.threads); setDrafts([]); setNextToken(value.nextPageToken); }
    }).catch(error => { if (active && request === listRequest.current) setFailure(message(error)); })
      .finally(() => { if (active && request === listRequest.current) setListLoading(false); });
    return () => { active = false; };
  }, [enabled, folder, search, pageToken, revision]);
  useEffect(() => {
    if (!enabled || !canWrite) return;
    fetch('/api/vault/cases', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Não foi possível listar os casos do Cofre.');
      return response.json() as Promise<{ cases: VaultCase[] }>;
    }).then(value => setCases(value.cases ?? [])).catch(() => undefined);
  }, [enabled, canWrite]);
  useEffect(() => {
    if (!selectedCase || !showVault) return;
    let active = true;
    fetch(`/api/vault/documents?scope=case&caseId=${encodeURIComponent(selectedCase)}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível listar os documentos do caso.');
        return response.json() as Promise<{ documents: VaultDocument[] }>;
      }).then(value => { if (active) setVaultDocuments(value.documents ?? []); })
      .catch(error => { if (active) setFailure(message(error)); });
    return () => { active = false; };
  }, [selectedCase, showVault]);

  const invalidateTriage = () => { triageRequest.current += 1; setTriageBusy(false); setTriageMessage(''); setCategoryFilter('all'); setPriorityFilter('all'); setSortOrder('recent'); };
  const refresh = () => { invalidateTriage(); setListLoading(true); setRevision(value => value + 1); };
  const resetDetail = () => {
    detailRequest.current += 1;
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setDetailLoading(false); setThread(null); setEditor(null); setDigestPeriod(null); setInsightOpen(null);
  };
  const chooseFolder = (value: Folder) => {
    invalidateTriage(); resetDetail();
    if (listScroller.current) listScroller.current.scrollTop = 0;
    setListLoading(true);
    setFolder(value); setPageToken(undefined); setPrevious([]); setRevision(current => current + 1);
    setNotice(''); setFailure('');
  };
  const compose = () => { resetDetail(); setEditor(blank()); setFailure(''); setNotice(''); requestAnimationFrame(() => detailHeading.current?.focus()); };
  const openThread = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setDetailLoading(true); setThread(null); setEditor(null); setDigestPeriod(null); setInsightOpen(null); setFailure('');
    try { const value = await fetchThread(id);
      if (request === detailRequest.current) setThread(value); }
    catch (error) { if (request === detailRequest.current) setFailure(message(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, []);
  const openDraft = async (id: string) => {
    const request = ++detailRequest.current;
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setDetailLoading(true); setThread(null); setEditor(null); setDigestPeriod(null); setFailure('');
    try {
      const { draft } = await googleCall<{ draft: Draft }>('draft', { draftId: id });
      if (request !== detailRequest.current) return;
      setEditor({ draftId: draft.id, to: draft.to.join(', '), cc: draft.cc.join(', '), bcc: draft.bcc.join(', '),
        subject: draft.subject, body: draft.body, replyToMessageId: draft.replyToMessageId,
        attachments: draft.attachments.map(a => ({ kind: 'draft', partId: a.partId, name: a.filename })) });
      setThread(null);
    } catch (error) { if (request === detailRequest.current) setFailure(message(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  };
  const reply = (mail: Thread['messages'][number], body = '') => {
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    // Following up on one's own message goes back to the people it was sent to.
    const own = status?.connection?.email.toLowerCase();
    const to = own && address(mail.from).toLowerCase() === own ? mail.to.join(', ') : address(mail.from);
    setThread(null); setInsightOpen(null);
    setEditor({ ...blank(), to, body, subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
      replyToMessageId: mail.id });
    requestAnimationFrame(() => detailHeading.current?.focus());
  };
  useEffect(() => {
    if (!enabled || (!initialThreadId && !initialDraftId)) return;
    let active = true;
    if (initialDraftId) googleCall<{ draft: Draft }>('draft', { draftId: initialDraftId }).then(({ draft }) => {
      if (active) setEditor({ draftId: draft.id, to: draft.to.join(', '), cc: draft.cc.join(', '), bcc: draft.bcc.join(', '),
        subject: draft.subject, body: draft.body, replyToMessageId: draft.replyToMessageId,
        attachments: draft.attachments.map(a => ({ kind: 'draft', partId: a.partId, name: a.filename })) });
    }).catch(error => { if (active) setFailure(message(error)); });
    else if (initialThreadId) fetchThread(initialThreadId).then(value => {
      if (active) setThread(value);
    }).catch(error => { if (active) setFailure(message(error)); });
    return () => { active = false; };
  }, [enabled, initialThreadId, initialDraftId]);

  // ---------- Smart options ----------
  const loadDigest = (period: DigestPeriod, force = false) => {
    if (!force && digests[period] && digests[period]!.status !== 'failed') return;
    const key = `digest:${period}`;
    smartRequests.current.get(key)?.abort();
    const controller = new AbortController();
    smartRequests.current.set(key, controller);
    setDigests(current => ({ ...current, [period]: { status: 'loading' } }));
    requestInsight({ kind: 'digest', period }, controller.signal).then(result => {
      if ('digest' in result) setDigests(current => ({ ...current, [period]: { status: 'ready', value: result.digest } }));
    }).catch(error => {
      if (!controller.signal.aborted) setDigests(current => ({ ...current, [period]: { status: 'failed', error: message(error) } }));
    }).finally(() => { if (smartRequests.current.get(key) === controller) smartRequests.current.delete(key); });
  };
  const openDigest = (period: DigestPeriod) => {
    resetDetail(); setFailure(''); setNotice('');
    setDigestPeriod(period);
    loadDigest(period);
    requestAnimationFrame(() => detailHeading.current?.focus());
  };
  const loadInsight = (threadId: string, force = false) => {
    setInsightOpen(threadId);
    if (!force && insights[threadId] && insights[threadId].status !== 'failed') return;
    const key = `thread:${threadId}`;
    smartRequests.current.get(key)?.abort();
    const controller = new AbortController();
    smartRequests.current.set(key, controller);
    setInsights(current => ({ ...current, [threadId]: { status: 'loading' } }));
    requestInsight({ kind: 'thread', threadId }, controller.signal).then(result => {
      if ('insight' in result) setInsights(current => ({ ...current, [threadId]: { status: 'ready', value: result.insight } }));
    }).catch(error => {
      if (!controller.signal.aborted) setInsights(current => ({ ...current, [threadId]: { status: 'failed', error: message(error) } }));
    }).finally(() => { if (smartRequests.current.get(key) === controller) smartRequests.current.delete(key); });
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
  };
  const digestBusy = Object.values(digests).some(item => item?.status === 'loading');
  const mailboxOptions: SmartOption[] = [
    ...(Object.keys(periodNames) as DigestPeriod[]).map(period => ({ id: `digest-${period}`,
      label: { day: 'Resumo do dia', week: 'Resumo da semana', month: 'Resumo do mês' }[period],
      description: { day: 'O que chegou nas últimas 24 horas e o que pede ação.', week: 'Os últimos 7 dias, por assunto.', month: 'Os últimos 30 dias, por assunto.' }[period] })),
    ...(folder !== 'DRAFT' ? [{ id: 'triage', label: 'Classificar esta página', disabled: triageBusy || listLoading || !threads.length,
      description: 'Categoria e prioridade pelo TypeSafe AI, a partir de assunto, remetente e trecho. Não altera o Gmail.' }] : []),
  ];
  const onMailboxOption = (id: string) => {
    if (id === 'triage') void classifyPage();
    else openDigest(id.replace('digest-', '') as DigestPeriod);
  };
  const threadBusy = thread ? insights[thread.id]?.status === 'loading' : false;
  const threadOptions: SmartOption[] = thread ? [{ id: 'insight', label: canWrite ? 'Resumo e respostas rápidas' : 'Resumo da conversa',
    description: canWrite ? 'O essencial da conversa e respostas prontas para revisar.' : 'O essencial da conversa e o que ela pede.' }] : [];

  async function upload(file: File) {
    if (!editor) return;
    setBusy(true); setFailure('');
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/integrations/google/uploads', { method: 'POST', body: form });
      const result = await response.json() as { uploadId?: string; name?: string; error?: string };
      if (!response.ok || !result.uploadId) throw new Error(result.error ?? 'Não foi possível anexar o arquivo.');
      setEditor(current => current ? { ...current, attachments: [...current.attachments,
        { kind: 'upload', uploadId: result.uploadId!, name: result.name ?? file.name }] } : null);
    } catch (error) { setFailure(message(error)); }
    finally { setBusy(false); }
  }
  const attachVault = () => {
    const document = vaultDocuments.find(item => item.id === vaultDocumentId);
    if (!document || !editor) return;
    setEditor({ ...editor, attachments: [...editor.attachments, { kind: 'vault', documentId: document.id, name: document.name }] });
    setShowVault(false); setVaultDocumentId('');
  };
  const payload = (value: Editor) => ({
    draftId: value.draftId, to: splitAddresses(value.to), cc: splitAddresses(value.cc), bcc: splitAddresses(value.bcc),
    subject: value.subject, body: value.body, replyToMessageId: value.replyToMessageId,
    attachments: value.attachments.map(ref => ref.kind === 'vault' ? { kind: 'vault', documentId: ref.documentId }
      : ref.kind === 'upload' ? { kind: 'upload', uploadId: ref.uploadId } : { kind: 'draft', partId: ref.partId }),
    idempotencyKey: crypto.randomUUID(),
  });
  async function submit(kind: 'send' | 'draft-save') {
    if (!editor) return;
    setBusy(true); setFailure(''); setNotice('');
    try {
      if (kind === 'send') {
        const result = await run<CapabilityOutput<'k5_gmail_send'>>('send', payload(editor));
        if (result.operation.status === 'unknown') setNotice('O envio está em verificação no Google. Aguarde antes de tentar novamente.');
        else if (result.operation.status === 'succeeded') { setNotice('E-mail enviado.'); setEditor(null); setThread(null); refresh(); }
      } else {
        const result = await run<CapabilityOutput<'k5_gmail_save_draft'>>('draft-save', payload(editor));
        if (result.operation.status === 'unknown') setNotice('O salvamento está em verificação no Google.');
        else if (result.draft) { setNotice('Rascunho salvo no Gmail.'); await openDraft(result.draft.id); refresh(); }
      }
    } catch (error) { if (!(error instanceof GoogleClientError && error.code === 'CANCELLED')) setFailure(message(error)); }
    finally { setBusy(false); }
  }
  async function deleteDraft() {
    if (!editor?.draftId) return;
    setBusy(true); setFailure('');
    try {
      const result = await run<CapabilityOutput<'k5_gmail_delete_draft'>>('draft-delete', {
        draftId: editor.draftId, idempotencyKey: crypto.randomUUID() });
      if (result.success) { setEditor(null); setNotice('Rascunho excluído.'); refresh(); }
      else setNotice('A exclusão está em verificação no Google.');
    } catch (error) { if (!(error instanceof GoogleClientError && error.code === 'CANCELLED')) setFailure(message(error)); }
    finally { setBusy(false); }
  }
  async function importPart(mailId: string, partId: string) {
    if (!selectedCase) { setFailure('Escolha o caso que receberá o anexo.'); return; }
    setBusy(true); setFailure('');
    try {
      const result = await run<CapabilityOutput<'k5_gmail_import_attachment'>>('attachment-import', {
        messageId: mailId, partId, caseId: selectedCase, idempotencyKey: crypto.randomUUID() });
      setNotice(result.import.status === 'queued' ? 'Anexo enviado para importação no Cofre.' : 'Importação registrada no Cofre.');
    } catch (error) { if (!(error instanceof GoogleClientError && error.code === 'CANCELLED')) setFailure(message(error)); }
    finally { setBusy(false); }
  }

  async function classifyPage() {
    if (folder === 'DRAFT' || listLoading || !threads.length) return;
    const request = ++triageRequest.current;
    const requestedPage = pageKey;
    const threadIds = threads.map(item => item.id);
    setTriageBusy(true); setTriageMessage(''); setTriage(null); setCategoryFilter('all'); setPriorityFilter('all');
    try {
      const response = await fetch('/api/integrations/google/mail-triage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadIds }),
      });
      const result = await response.json() as EmailTriageResult & { error?: string };
      if (request !== triageRequest.current) return;
      if (!response.ok && !['disabled', 'unavailable', 'budget_exceeded'].includes(result.status)) {
        throw new Error(result.error || 'Não foi possível classificar esta página.');
      }
      if (result.status === 'disabled') { setTriageMessage('Classificação de e-mails não habilitada.'); return; }
      if (result.status === 'unavailable') { setTriageMessage('Classificação indisponível no momento. Tente novamente.'); return; }
      if (result.status === 'budget_exceeded') { setTriageMessage('Limite de classificação atingido. Tente novamente mais tarde.'); return; }
      setTriage({ pageKey: requestedPage, items: result.items.filter(item => threadIds.includes(item.threadId)) });
      setTriageMessage(result.status === 'partial' ? 'Classificação parcial. Algumas conversas ficaram sem análise.' : 'Página classificada pelo TypeSafe AI. As sugestões não alteram o Gmail.');
    } catch (error) {
      if (request === triageRequest.current) setTriageMessage(message(error));
    } finally {
      if (request === triageRequest.current) setTriageBusy(false);
    }
  }

  const folderButton = (item: Folder, rail: boolean) => {
    const Icon = folderIcons[item];
    const active = folder === item && !digestPeriod;
    const button = <button key={item} type="button" aria-current={folder === item ? 'page' : undefined} aria-label={rail ? labels[item] : undefined}
      onClick={() => chooseFolder(item)}
      className={cn('hover-rise flex h-10 w-full items-center gap-3 text-sm transition-colors duration-500 ease-(--ease) hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        rail ? 'justify-center' : 'px-4', active ? 'bg-foreground font-medium text-background before:hidden' : 'text-muted-foreground')}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />{!rail && labels[item]}
    </button>;
    return rail ? <Tooltip key={item}><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right">{labels[item]}</TooltipContent></Tooltip> : button;
  };

  return <div className="gmail-workspace flex min-h-0 flex-1 flex-col overflow-hidden max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3 md:px-10 lg:py-5">
      <h1 className="page-title leading-none max-md:sr-only">E-mails</h1>
      {enabled && <div className="flex items-center gap-1 lg:hidden">
        <SmartOptions options={mailboxOptions} onSelect={onMailboxOption} busy={digestBusy || triageBusy} align="end" />
        {canWrite && <Button type="button" onClick={compose}><PenLine aria-hidden="true" />Escrever</Button>}
      </div>}
    </div>
    {status && !enabled ? <div className="px-5 md:px-10"><GoogleConnectionNotice status={status} module="gmail" /></div> : null}
    {loading && !status ? <p className="px-5 py-8 text-sm text-muted-foreground md:px-10">Carregando conexão…</p> : null}
    {failure && <p role="alert" className="shrink-0 px-5 py-2 text-sm text-destructive md:px-10">{failure}</p>}
    {notice && <p role="status" className="shrink-0 px-5 py-2 text-sm text-muted-foreground md:px-10">{notice}</p>}
    {enabled && <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Gmail-like folder column: labels from xl, an icon rail on narrower desktops, a strip on phones. */}
      <TooltipProvider delayDuration={300}><aside aria-label="Caixa de e-mail" className="hidden w-14 shrink-0 flex-col border-r border-line lg:flex xl:w-56">
        <div className="flex items-center gap-1 border-b p-2 max-xl:flex-col">
          {canWrite && <><Tooltip><TooltipTrigger asChild><Button type="button" size="icon" aria-label="Escrever" className="xl:hidden" onClick={compose}><PenLine aria-hidden="true" /></Button></TooltipTrigger>
            <TooltipContent side="right">Escrever</TooltipContent></Tooltip>
            <Button type="button" className="hidden flex-1 justify-start xl:flex" onClick={compose}><PenLine aria-hidden="true" />Escrever</Button></>}
          <SmartOptions options={mailboxOptions} onSelect={onMailboxOption} busy={digestBusy || triageBusy} />
        </div>
        <nav aria-label="Pastas de e-mail" className="py-2">
          <div className="xl:hidden">{(Object.keys(labels) as Folder[]).map(item => folderButton(item, true))}</div>
          <div className="hidden xl:block">{(Object.keys(labels) as Folder[]).map(item => folderButton(item, false))}</div>
        </nav>
      </aside></TooltipProvider>
      <div className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex lg:w-80 lg:flex-none lg:border-r lg:border-line xl:w-96', detailVisible ? 'max-lg:hidden' : 'flex')}>
        <nav aria-label="Pastas de e-mail" className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 lg:hidden">
          {(Object.keys(labels) as Folder[]).map(item => { const Icon = folderIcons[item]; return <Button key={item} variant="ghost" type="button" aria-current={folder === item ? 'page' : undefined}
            className={folder === item ? 'bg-foreground text-background hover:bg-foreground hover:text-background' : 'text-muted-foreground'} onClick={() => chooseFolder(item)}>
            <Icon aria-hidden="true" />{labels[item]}</Button>; })}
        </nav>
        {folder !== 'DRAFT' && <form onSubmit={(event: FormEvent) => { event.preventDefault(); invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setSearch(query.trim()); setPageToken(undefined); setPrevious([]); setRevision(current => current + 1); }}
          className="flex shrink-0 gap-2 border-b px-4 py-3"><Input aria-label="Buscar e-mails" placeholder="Buscar no Gmail" value={query}
            onChange={event => setQuery(event.target.value)} maxLength={500} />
          <Button type="submit" variant="outline" size="icon" aria-label="Buscar"><Search aria-hidden="true" /></Button></form>}
        {folder !== 'DRAFT' && (triageBusy || triageMessage || visibleTriage.length > 0) && <div className="shrink-0 border-b px-4 py-3">
          {triageBusy && <p role="status" className="text-xs text-muted-foreground">Classificando esta página…</p>}
          {triageMessage && <p role="status" className="text-xs text-muted-foreground">{triageMessage}</p>}
          {visibleTriage.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="text-xs text-muted-foreground">Categoria
              <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as typeof categoryFilter)} className={selectClass}>
                <option value="all">Todas</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            <label className="text-xs text-muted-foreground">Prioridade
              <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as typeof priorityFilter)} className={selectClass}>
                <option value="all">Todas</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            <label className="text-xs text-muted-foreground">Ordenar
              <select value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)} className={selectClass}>
                <option value="recent">Mais recentes</option><option value="priority">Prioridade</option>
              </select></label>
            <p className="col-span-3 text-xs text-muted-foreground">Filtros e ordem valem apenas para esta página.</p>
          </div>}
        </div>}
        <div ref={listScroller} tabIndex={0} role="region" aria-label="Lista de e-mails" className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {listLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Carregando e-mails…</p>
          : folder === 'DRAFT' ? drafts.length ? <div>{drafts.map(item => <button key={item.id} type="button"
            onClick={() => void openDraft(item.id)} className={cn('block w-full border-b px-4 py-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', editor?.draftId === item.id && 'bg-accent')}>
            <span className="block truncate text-sm font-medium">{item.subject || '(sem assunto)'}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.to.join(', ') || 'Sem destinatário'} · {item.snippet}</span>
          </button>)}</div> : <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum rascunho.</p>
            : threads.length ? visibleThreads.length ? <div>{visibleThreads.map(item => <button key={item.id} type="button"
              aria-current={thread?.id === item.id ? 'true' : undefined}
              onClick={() => void openThread(item.id)} className={cn('relative block w-full border-b px-4 py-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                thread?.id === item.id && 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground')}>
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn('min-w-0 truncate text-sm', item.unread ? 'font-semibold' : 'text-muted-foreground')}>{item.from.replace(/<[^<>]*>/g, '').replace(/"/g, '').trim() || item.from}</span>
                <span className="label-mono shrink-0 text-subtle-foreground">{listDate(item.date)}</span>
              </span>
              <span className={cn('mt-0.5 block truncate text-sm', item.unread ? 'font-semibold' : 'font-medium')}>{item.subject || '(sem assunto)'}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.snippet}{item.hasAttachments ? ' · Anexo' : ''}</span>
              {triageById.has(item.id) && <span className="mt-1 block text-xs text-muted-foreground">{categoryLabels[triageById.get(item.id)!.category]} · Prioridade {priorityLabels[triageById.get(item.id)!.priority]}
                {triageById.get(item.id)!.uncertain ? ' · A conferir' : ''}{triageById.get(item.id)!.needsReply ? ' · Resposta sugerida' : ''}</span>}
            </button>)}</div> : <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum e-mail corresponde aos filtros desta página.</p>
              : <p className="px-4 py-6 text-sm text-muted-foreground">Nenhuma conversa nesta pasta.</p>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t px-2 py-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Página anterior" disabled={!previous.length}
            onClick={() => { invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setPageToken(previous.at(-1)); setPrevious(items => items.slice(0, -1)); }}><ChevronLeft /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Próxima página" disabled={!nextToken}
            onClick={() => { invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setPrevious(items => [...items, pageToken]); setPageToken(nextToken ?? undefined); }}><ChevronRight /></Button>
        </div>
      </div>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col px-5 lg:flex lg:px-8', detailVisible ? 'flex' : 'max-lg:hidden')} aria-label="Mensagem selecionada">
        {detailVisible && <Button type="button" variant="ghost" className="my-2 shrink-0 self-start lg:hidden" onClick={resetDetail}>
          <ArrowLeft aria-hidden="true" />Voltar à lista</Button>}
        {thread && <div className="flex shrink-0 items-center justify-between gap-3 border-b py-4">
          <h2 ref={detailHeading} tabIndex={-1} className="min-w-0 text-lg font-medium outline-none">{thread.subject || '(sem assunto)'}</h2>
          <SmartOptions options={threadOptions} onSelect={() => { if (thread) loadInsight(thread.id); }} busy={threadBusy} align="end" />
        </div>}
        {editor && <h2 ref={detailHeading} tabIndex={-1} className="shrink-0 border-b py-4 text-lg font-medium outline-none">{editor.draftId ? 'Editar rascunho' : editor.replyToMessageId ? 'Responder' : 'Novo e-mail'}</h2>}
        <div ref={detailScroller} tabIndex={0} role="region" aria-label="Conteúdo do e-mail" className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {detailLoading && <p className="py-6 text-sm text-muted-foreground">Carregando mensagem…</p>}
        {digestPeriod && <DigestView period={digestPeriod} state={digests[digestPeriod]} headingRef={detailHeading}
          onPeriod={period => { setDigestPeriod(period); loadDigest(period); }} onRetry={() => loadDigest(digestPeriod, true)}
          onOpenThread={id => void openThread(id)} onClose={resetDetail} />}
        {thread && <div className="pb-10">
          {insightOpen === thread.id && insights[thread.id] && <ThreadInsightView state={insights[thread.id]} canWrite={canWrite}
            onRetry={() => loadInsight(thread.id, true)} onClose={() => setInsightOpen(null)}
            onUseReply={body => { const latest = thread.messages.at(-1); if (latest) reply(latest, body); }} />}
          {thread.messages.map(mail => <article key={mail.id} className="border-b py-5">
            <p className="text-sm font-medium">{mail.from}</p>
            <p className="mt-1 text-xs text-muted-foreground">Para: {mail.to.join(', ')}{mail.cc.length ? ` · Cc: ${mail.cc.join(', ')}` : ''} · {formatDate(mail.date)}</p>
            {mail.html ? <EmailFrame html={mail.html} title={`Mensagem de ${mail.from}`} />
              : <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-6">{mail.text || 'Esta mensagem não tem texto legível.'}</div>}
            {!!mail.attachments.length && <div className="mt-5 border-t pt-4">
              <p className="mb-2 text-sm font-medium">Anexos</p>
              {canWrite && <div className="mb-3 grid max-w-sm gap-1.5"><Label htmlFor={`email-case-${mail.id}`}>Importar para o caso</Label>
                <select id={`email-case-${mail.id}`} value={selectedCase} onChange={event => setSelectedCase(event.target.value)}
                  className="h-11 border border-input bg-background px-3 text-sm md:h-9">
                  <option value="">Escolha um caso</option>{cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <p className="text-xs text-muted-foreground">A cópia passa a seguir as permissões e a retenção do Cofre.</p></div>}
              {mail.attachments.map(file => <div key={file.partId} className="flex min-h-11 items-center justify-between gap-3 border-b py-2 text-sm">
                <span className="min-w-0 truncate"><Paperclip aria-hidden="true" className="mr-2 inline size-4" />{file.filename} · {Math.ceil(file.size / 1024)} KB</span>
                {canWrite && file.importable && <Button type="button" variant="outline" disabled={busy || !selectedCase}
                  onClick={() => void importPart(mail.id, file.partId)}>Importar</Button>}
              </div>)}
            </div>}
            {canWrite && <Button type="button" variant="outline" className="mt-5" onClick={() => reply(mail)}>Responder</Button>}
          </article>)}
        </div>}
        {editor && canWrite && <div className="pb-10">
          <fieldset disabled={busy} className="grid gap-4 py-5">
            {(['to', 'cc', 'bcc'] as const).map(field => <div key={field} className="grid gap-1.5">
              <Label htmlFor={`mail-${field}`}>{field === 'to' ? 'Para' : field === 'cc' ? 'Cc' : 'Cco'}</Label>
              <Input id={`mail-${field}`} type="text" autoComplete="off" value={editor[field]} onChange={event => setEditor({ ...editor, [field]: event.target.value })}
                placeholder="nome@exemplo.com, outro@exemplo.com" /></div>)}
            <div className="grid gap-1.5"><Label htmlFor="mail-subject">Assunto</Label>
              <Input id="mail-subject" value={editor.subject} maxLength={998} onChange={event => setEditor({ ...editor, subject: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="mail-body">Mensagem</Label>
              <Textarea id="mail-body" className="min-h-52 resize-y" value={editor.body} maxLength={200000}
                onChange={event => setEditor({ ...editor, body: event.target.value })} /></div>
            {!!editor.attachments.length && <div><p className="mb-2 text-sm font-medium">Anexos</p>
              {editor.attachments.map((ref, index) => <div key={index} className="flex items-center justify-between border-b py-2 text-sm">
                <span className="truncate">{ref.name}</span><Button type="button" variant="ghost" onClick={() => setEditor({ ...editor,
                  attachments: editor.attachments.filter((_, i) => i !== index) })}>Remover</Button></div>)}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="mail-upload" className="inline-flex h-9 cursor-pointer items-center gap-2 border border-input px-3 text-sm hover:bg-accent">
                <Paperclip aria-hidden="true" className="size-4" />Anexar arquivo</Label>
              <Input id="mail-upload" type="file" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
              <Button type="button" variant="outline" onClick={() => setShowVault(value => !value)}>Anexar do Cofre</Button>
            </div>
            {showVault && <div className="grid max-w-lg gap-3 border-t pt-4">
              <div className="grid gap-1.5"><Label htmlFor="mail-vault-case">Caso</Label>
                <select id="mail-vault-case" className="h-11 border border-input bg-background px-3 text-sm md:h-9"
                  value={selectedCase} onChange={event => { setSelectedCase(event.target.value); setVaultDocumentId(''); setVaultDocuments([]); }}>
                  <option value="">Escolha um caso</option>{cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className="grid gap-1.5"><Label htmlFor="mail-vault-document">Documento</Label>
                <select id="mail-vault-document" className="h-11 border border-input bg-background px-3 text-sm md:h-9"
                  value={vaultDocumentId} onChange={event => setVaultDocumentId(event.target.value)}>
                  <option value="">Escolha um documento</option>{vaultDocuments.filter(item => item.status === 'ready').map(item =>
                    <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <Button type="button" variant="outline" disabled={!vaultDocumentId} onClick={attachVault}>Adicionar documento</Button>
            </div>}
            <div className="flex flex-wrap gap-2 border-t pt-5">
              <Button type="button" disabled={busy} onClick={() => void submit('send')}>Enviar</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void submit('draft-save')}>Salvar rascunho</Button>
              {editor.draftId && <Button type="button" variant="ghost" disabled={busy} onClick={() => void deleteDraft()}>Excluir rascunho</Button>}
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>Fechar</Button>
            </div>
          </fieldset>
        </div>}
        {!detailVisible && <div className="hidden py-12 text-sm text-muted-foreground lg:block">Escolha uma conversa para ler.</div>}
        </div>
      </section>
    </div>}
    {approvalDialog}
    {enabled && !cases.length && canWrite && <p className="sr-only">Nenhum caso do Cofre disponível para importar anexos. <Link href="/app/vault">Abrir Cofre</Link></p>}
  </div>;
}
