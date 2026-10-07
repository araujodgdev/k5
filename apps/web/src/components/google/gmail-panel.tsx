'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, File, Inbox, Mail, Mails, Paperclip, PenLine, Search, Send, Star, type LucideIcon } from 'lucide-react';
import { CanvasTrail, Chip, Field } from '@/components/canvas/canvas-controls';
import { CanvasHeader, CanvasPage, CanvasRow } from '@/components/canvas/canvas-page';
import { CanvasMeta } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SmartOptions, type SmartOption } from '@/components/smart-options';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { EmailTriageItem, EmailTriageResult } from '@/lib/google/gmail/triage-contracts';
import type { DigestPeriod, EmailDigest, ThreadInsight } from '@/lib/google/gmail/insights-contracts';
import { googleCall, GoogleClientError, GoogleConnectionNotice, type GoogleStatus, useGoogleAction } from './client';
import { EmailFrame } from './email-frame';
import { DigestView, periodNames, requestInsight, ThreadInsightView, type Pending } from './email-smart';
import { useVaultDocumentOptions, VaultDocumentOptionsMore } from '@/components/vault-document-options';

type ThreadSummary = CapabilityOutput<'k5_gmail_list_threads'>['threads'][number];
type Thread = CapabilityOutput<'k5_gmail_get_thread'>['thread'];
type DraftSummary = CapabilityOutput<'k5_gmail_list_drafts'>['drafts'][number];
type Draft = CapabilityOutput<'k5_gmail_get_draft'>['draft'];
type AttachmentRef = { kind: 'vault'; documentId: string; name: string } | { kind: 'upload'; uploadId: string; name: string } | {
  kind: 'draft'; partId: string; name: string };
type Editor = { draftId?: string; to: string; cc: string; bcc: string; subject: string; body: string;
  replyToMessageId: string | null; attachments: AttachmentRef[] };
type VaultCase = { id: string; name: string };
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
const selectClass = 'h-11 w-full rounded-md border bg-background text-[13.5px] text-foreground md:h-9';

/** The reader's thread comes from its own route, which adds each message's HTML for the sandboxed frame. */
async function fetchThread(threadId: string): Promise<Thread> {
  const response = await fetch('/api/integrations/google/mail-thread', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId }), cache: 'no-store' });
  const result = await response.json().catch(() => null) as { thread?: Thread; error?: string } | null;
  if (!response.ok || !result?.thread) throw new GoogleClientError(result?.error ?? 'Não foi possível abrir a conversa.');
  return result.thread;
}

export function GmailPanel({ initialThreadId, initialDraftId }: { initialThreadId?: string; initialDraftId?: string }) {
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
  const [vaultDocumentId, setVaultDocumentId] = useState('');
  const [showVault, setShowVault] = useState(false);
  const vaultOptions = useVaultDocumentOptions(selectedCase && showVault ? `scope=case&caseId=${encodeURIComponent(selectedCase)}` : null);
  const vaultDocuments = vaultOptions.documents;
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
  const hadDetail = useRef(false);
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
    if (detailVisible) {
      (detailHeading.current ?? detailScroller.current)?.focus();
      hadDetail.current = true;
    } else if (hadDetail.current) {
      listScroller.current?.focus();
      hadDetail.current = false;
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
    if (!enabled) return;
    fetch('/api/vault/cases', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Não foi possível listar os casos do Cofre.');
      return response.json() as Promise<{ cases: VaultCase[] }>;
    }).then(value => setCases(value.cases ?? [])).catch(() => undefined);
  }, [enabled]);

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
  const threadOptions: SmartOption[] = thread ? [{ id: 'insight', label: 'Resumo e respostas rápidas',
    description: 'O essencial da conversa e respostas prontas para revisar.' }] : [];

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

  const quiet = 'text-[13.5px] text-muted-foreground';
  const control = 'h-11 md:h-[34px]';
  const sender = (from: string) => from.replace(/<[^<>]*>/g, '').replace(/"/g, '').trim() || from;
  const turnPage = (direction: 'previous' | 'next') => {
    invalidateTriage(); setListLoading(true);
    if (direction === 'previous') { setPageToken(previous.at(-1)); setPrevious(items => items.slice(0, -1)); }
    else { setPrevious(items => [...items, pageToken]); setPageToken(nextToken ?? undefined); }
  };
  const detailTitle = thread ? thread.subject || '(sem assunto)' : editor ? editor.draftId ? 'Editar rascunho' : editor.replyToMessageId ? 'Responder' : 'Novo e-mail'
    : digestPeriod ? { day: 'Resumo do dia', week: 'Resumo da semana', month: 'Resumo do mês' }[digestPeriod] : 'Mensagem';
  const messages = <>
    {failure && <p role="alert" className="text-[13.5px] text-destructive">{failure}</p>}
    {notice && <p role="status" className={quiet}>{notice}</p>}
  </>;

  if (enabled && detailVisible) return <>
    <CanvasMeta title="E-mails" subject={{ kind: 'module', slug: 'email', title: 'E-mails' }} />
    <CanvasTrail back={{ label: labels[folder], onClick: resetDetail }} icon={<Mail />} current={detailTitle}
      actions={thread && <SmartOptions options={threadOptions} onSelect={() => { if (thread) loadInsight(thread.id); }} busy={threadBusy} align="end" />} />
    <div ref={detailScroller} tabIndex={-1} className="mx-auto flex outline-none w-full max-w-[760px] flex-col gap-6 px-4 pt-6 pb-24 md:px-10 md:pt-10 md:pb-16">
      {messages}
      {detailLoading && <p role="status" className={quiet}>Carregando mensagem…</p>}
      {digestPeriod && <DigestView period={digestPeriod} state={digests[digestPeriod]} headingRef={detailHeading}
        onPeriod={period => { setDigestPeriod(period); loadDigest(period); }} onRetry={() => loadDigest(digestPeriod, true)}
        onOpenThread={id => void openThread(id)} onClose={resetDetail} />}
      {thread && <>
        <h1 ref={detailHeading} tabIndex={-1} className="text-[24px] leading-[1.3] font-semibold tracking-[-0.02em] outline-none md:text-[26px]">{thread.subject || '(sem assunto)'}</h1>
        {insightOpen === thread.id && insights[thread.id] && <ThreadInsightView state={insights[thread.id]}
          onRetry={() => loadInsight(thread.id, true)} onClose={() => setInsightOpen(null)}
          onUseReply={body => { const latest = thread.messages.at(-1); if (latest) reply(latest, body); }} />}
        {thread.messages.map(mail => <article key={mail.id} className="flex flex-col gap-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <p className="text-sm font-medium">{mail.from}</p>
            <time dateTime={mail.date ?? undefined} className="font-mono text-[12.5px] text-muted-foreground">{formatDate(mail.date)}</time>
          </div>
          <p className="-mt-2 text-[12.5px] text-muted-foreground">Para: {mail.to.join(', ')}{mail.cc.length ? ` · Cc: ${mail.cc.join(', ')}` : ''}</p>
          {mail.html ? <EmailFrame html={mail.html} title={`Mensagem de ${mail.from}`} />
            : <div className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.7]">{mail.text || 'Esta mensagem não tem texto legível.'}</div>}
          {!!mail.attachments.length && <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <p className="text-[13.5px] font-medium">Anexos</p>
            <Field label="Importar para o caso" htmlFor={`email-case-${mail.id}`} className="max-w-sm">
              <select id={`email-case-${mail.id}`} value={selectedCase} onChange={event => setSelectedCase(event.target.value)} className={selectClass}>
                <option value="">Escolha um caso</option>{cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </Field>
            <p className="-mt-1 text-xs text-muted-foreground">A cópia passa a seguir as permissões e a retenção do Cofre.</p>
            <div className="flex flex-col">{mail.attachments.map(file => <div key={file.partId} className="flex min-h-11 items-center justify-between gap-3 text-[13.5px]">
              <span className="flex min-w-0 items-center gap-2"><Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{file.filename}</span><span className="shrink-0 font-mono text-[12.5px] text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span></span>
              {file.importable && <Button type="button" variant="outline" className="h-11 md:h-8" disabled={busy || !selectedCase}
                onClick={() => void importPart(mail.id, file.partId)}>Importar</Button>}
            </div>)}</div>
          </div>}
          <div><Button type="button" variant="outline" size="lg" className={control} onClick={() => reply(mail)}>Responder</Button></div>
        </article>)}
      </>}
      {editor && <>
        <h1 ref={detailHeading} tabIndex={-1} className="text-[24px] leading-[1.3] font-semibold tracking-[-0.02em] outline-none md:text-[26px]">{detailTitle}</h1>
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">{detailTitle}</legend>
          {(['to', 'cc', 'bcc'] as const).map(field => <Field key={field} label={field === 'to' ? 'Para' : field === 'cc' ? 'Cc' : 'Cco'} htmlFor={`mail-${field}`}>
            <Input id={`mail-${field}`} type="text" autoComplete="off" value={editor[field]} onChange={event => setEditor({ ...editor, [field]: event.target.value })}
              placeholder="nome@exemplo.com, outro@exemplo.com" className="h-11 md:h-9" /></Field>)}
          <Field label="Assunto" htmlFor="mail-subject">
            <Input id="mail-subject" value={editor.subject} maxLength={998} onChange={event => setEditor({ ...editor, subject: event.target.value })} className="h-11 md:h-9" /></Field>
          <Field label="Mensagem" htmlFor="mail-body">
            <Textarea id="mail-body" className="min-h-52 resize-y text-[14.5px] leading-[1.6]" value={editor.body} maxLength={200000}
              onChange={event => setEditor({ ...editor, body: event.target.value })} /></Field>
          {!!editor.attachments.length && <div className="flex flex-col gap-1"><p className="text-xs text-muted-foreground">Anexos</p>
            {editor.attachments.map((ref, index) => <div key={index} className="flex min-h-11 items-center justify-between gap-3 text-[13.5px] md:min-h-9">
              <span className="flex min-w-0 items-center gap-2"><Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{ref.name}</span></span>
              <Button type="button" variant="ghost" className="h-11 text-muted-foreground md:h-8" onClick={() => setEditor({ ...editor,
                attachments: editor.attachments.filter((_, i) => i !== index) })}>Remover</Button></div>)}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="mail-upload" className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-sm border border-input px-3 text-[13.5px] font-normal transition-colors hover:bg-accent has-[+input:focus-visible]:outline-2 has-[+input:focus-visible]:outline-ring md:h-[34px]">
              <Paperclip aria-hidden="true" className="size-4" />Anexar arquivo</Label>
            <Input id="mail-upload" type="file" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
            <Button type="button" variant="outline" size="lg" className={control} onClick={() => setShowVault(value => !value)}>Anexar do Cofre</Button>
          </div>
          {showVault && <div className="flex max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <Field label="Caso" htmlFor="mail-vault-case">
              <select id="mail-vault-case" className={selectClass} value={selectedCase} onChange={event => { setSelectedCase(event.target.value); setVaultDocumentId(''); }}>
                <option value="">Escolha um caso</option>{cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Documento" htmlFor="mail-vault-document">
              <select id="mail-vault-document" className={selectClass} value={vaultDocumentId} onChange={event => setVaultDocumentId(event.target.value)}>
                <option value="">Escolha um documento</option>{vaultDocuments.filter(item => item.status === 'ready').map(item =>
                  <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <VaultDocumentOptionsMore {...vaultOptions} />
            <div><Button type="button" variant="outline" size="lg" className={control} disabled={!vaultDocumentId} onClick={attachVault}>Adicionar documento</Button></div>
          </div>}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" size="lg" className={control} disabled={busy} onClick={() => void submit('send')}><Send aria-hidden="true" />Enviar</Button>
            <Button type="button" variant="outline" size="lg" className={control} disabled={busy} onClick={() => void submit('draft-save')}>Salvar rascunho</Button>
            {editor.draftId && <Button type="button" variant="ghost" size="lg" className={control} disabled={busy} onClick={() => void deleteDraft()}>Excluir rascunho</Button>}
            <Button type="button" variant="ghost" size="lg" className={control} disabled={busy} onClick={() => setEditor(null)}>Fechar</Button>
          </div>
        </fieldset>
      </>}
    </div>
    {approvalDialog}
  </>;

  return <CanvasPage className="md:gap-6">
    <CanvasMeta title="E-mails" subject={{ kind: 'module', slug: 'email', title: 'E-mails' }} />
    <CanvasHeader eyebrow={status?.connection?.email ?? 'Gmail'} title="E-mails" actions={enabled && <>
      <SmartOptions options={mailboxOptions} onSelect={onMailboxOption} busy={digestBusy || triageBusy} align="end" />
      <Button type="button" variant="outline" size="lg" className={control} onClick={compose}><PenLine className="size-3.5" aria-hidden="true" />Escrever</Button>
    </>} />
    {status && !enabled && <GoogleConnectionNotice status={status} module="gmail" />}
    {loading && !status && <p role="status" className={quiet}>Carregando conexão…</p>}
    {messages}
    {enabled && <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Pastas de e-mail" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {(Object.keys(labels) as Folder[]).map(item => { const Icon = folderIcons[item]; return <Chip key={item} pressed={folder === item} onClick={() => chooseFolder(item)}>
            <Icon aria-hidden="true" className="size-3.5" />{labels[item]}</Chip>; })}
        </div>
        {folder !== 'DRAFT' && <form role="search" className="md:w-64" onSubmit={(event: FormEvent) => { event.preventDefault(); invalidateTriage(); setListLoading(true); setSearch(query.trim()); setPageToken(undefined); setPrevious([]); setRevision(current => current + 1); }}>
          <label className="flex h-11 items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground focus-within:ring-3 focus-within:ring-ring/50 md:h-[34px]">
            <Search aria-hidden="true" className="size-3.5 shrink-0" />
            <input type="search" aria-label="Buscar e-mails" placeholder="Buscar no Gmail" value={query} maxLength={500} onChange={event => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-subtle-foreground" />
          </label>
        </form>}
      </div>
      {folder !== 'DRAFT' && (triageBusy || triageMessage || visibleTriage.length > 0) && <div className="flex flex-col gap-3">
        {triageBusy && <p role="status" className={quiet}>Classificando esta página…</p>}
        {triageMessage && <p role="status" className={quiet}>{triageMessage}</p>}
        {visibleTriage.length > 0 && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Categoria" htmlFor="mail-filter-category">
            <select id="mail-filter-category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as typeof categoryFilter)} className={selectClass}>
              <option value="all">Todas</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
          <Field label="Prioridade" htmlFor="mail-filter-priority">
            <select id="mail-filter-priority" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as typeof priorityFilter)} className={selectClass}>
              <option value="all">Todas</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></Field>
          <Field label="Ordenar" htmlFor="mail-filter-order">
            <select id="mail-filter-order" value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)} className={selectClass}>
              <option value="recent">Mais recentes</option><option value="priority">Prioridade</option>
            </select></Field>
          <p className="text-xs text-muted-foreground sm:col-span-3">Filtros e ordem valem apenas para esta página.</p>
        </div>}
      </div>}
      <div ref={listScroller} role="region" aria-label="Lista de e-mails" tabIndex={-1} className="flex flex-col gap-0.5 outline-none">
        {listLoading ? <p role="status" className={quiet}>Carregando e-mails…</p>
          : folder === 'DRAFT' ? drafts.length ? drafts.map(item => <CanvasRow key={item.id} stacked icon={<File />} onClick={() => void openDraft(item.id)}
            title={item.subject || '(sem assunto)'} detail={`${item.to.join(', ') || 'Sem destinatário'} · ${item.snippet}`} />)
            : <p className={quiet}>Nenhum rascunho.</p>
          : threads.length ? visibleThreads.length ? visibleThreads.map(item => {
            const triaged = triageById.get(item.id);
            return <CanvasRow key={item.id} stacked icon={item.hasAttachments ? <Paperclip /> : <Mail />} urgent={item.unread} onClick={() => void openThread(item.id)}
              title={<>{item.subject || '(sem assunto)'}{item.unread && <span className="sr-only">, não lido</span>}</>}
              detail={`${sender(item.from)} · ${item.snippet}`} meta={listDate(item.date)}
              status={triaged && `${categoryLabels[triaged.category]} · ${priorityLabels[triaged.priority]}${triaged.needsReply ? ' · responder' : ''}${triaged.uncertain ? ' · a conferir' : ''}`} />;
          }) : <p className={quiet}>Nenhum e-mail corresponde aos filtros desta página.</p>
            : <p className={quiet}>Nenhuma conversa nesta pasta.</p>}
      </div>
      {(previous.length > 0 || nextToken) && <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Página anterior" disabled={!previous.length} onClick={() => turnPage('previous')}><ChevronLeft /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Próxima página" disabled={!nextToken} onClick={() => turnPage('next')}><ChevronRight /></Button>
      </div>}
    </>}
    {approvalDialog}
    {enabled && !cases.length && <p className="sr-only">Nenhum caso do Cofre disponível para importar anexos. <Link href="/app/vault">Abrir Cofre</Link></p>}
  </CanvasPage>;
}
