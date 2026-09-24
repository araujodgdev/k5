'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Paperclip, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { OfficeRole } from '@/lib/offices';
import type { CapabilityOutput } from '@/lib/capabilities/contracts';
import type { EmailTriageItem, EmailTriageResult } from '@/lib/google/gmail/triage-contracts';
import { googleCall, GoogleClientError, GoogleConnectionNotice, type GoogleStatus, useGoogleAction } from './client';

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
const labels = { INBOX: 'Recebidos', SENT: 'Enviados', DRAFT: 'Rascunhos', STARRED: 'Com estrela', ALL: 'Todos' } as const;
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
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const triageRequest = useRef(0);
  const listScroller = useRef<HTMLDivElement>(null);
  const detailScroller = useRef<HTMLDivElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const hadMobileDetail = useRef(false);
  const detailVisible = Boolean(thread || editor || detailLoading);
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
  const chooseFolder = (value: Folder) => {
    invalidateTriage(); detailRequest.current += 1;
    if (listScroller.current) listScroller.current.scrollTop = 0;
    setListLoading(true);
    setFolder(value); setPageToken(undefined); setPrevious([]); setRevision(current => current + 1);
    setThread(null); setEditor(null); setNotice(''); setFailure('');
  };
  const openThread = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setDetailLoading(true); setThread(null); setEditor(null); setFailure('');
    try { const value = await googleCall<CapabilityOutput<'k5_gmail_get_thread'>>('thread', { threadId: id });
      if (request === detailRequest.current) setThread(value.thread); }
    catch (error) { if (request === detailRequest.current) setFailure(message(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, []);
  const openDraft = async (id: string) => {
    const request = ++detailRequest.current;
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setDetailLoading(true); setThread(null); setEditor(null); setFailure('');
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
  const reply = (mail: Thread['messages'][number]) => {
    if (detailScroller.current) detailScroller.current.scrollTop = 0;
    setThread(null);
    setEditor({ ...blank(), to: address(mail.from), subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
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
    else googleCall<{ thread: Thread }>('thread', { threadId: initialThreadId }).then(value => {
      if (active) setThread(value.thread);
    }).catch(error => { if (active) setFailure(message(error)); });
    return () => { active = false; };
  }, [enabled, initialThreadId, initialDraftId]);
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
      setTriageMessage(result.status === 'partial' ? 'Classificação parcial. Algumas conversas ficaram sem análise.' : 'Página classificada.');
    } catch (error) {
      if (request === triageRequest.current) setTriageMessage(message(error));
    } finally {
      if (request === triageRequest.current) setTriageBusy(false);
    }
  }

  return <div className="gmail-workspace flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4 md:px-10 md:py-6 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b pb-4">
      <h1 className="page-title leading-none max-md:sr-only">E-mails</h1>
      {enabled && canWrite && <Button type="button" onClick={() => { detailRequest.current += 1; setDetailLoading(false); if (detailScroller.current) detailScroller.current.scrollTop = 0; setEditor(blank()); setThread(null); setFailure(''); setNotice(''); }}>
        <Plus aria-hidden="true" />Novo e-mail</Button>}
    </div>
    {status && !enabled ? <GoogleConnectionNotice status={status} module="gmail" /> : null}
    {loading && !status ? <p className="py-8 text-sm text-muted-foreground">Carregando conexão…</p> : null}
    {failure && <p role="alert" className="shrink-0 py-2 text-sm text-destructive">{failure}</p>}
    {notice && <p role="status" className="shrink-0 py-2 text-sm text-muted-foreground">{notice}</p>}
    {enabled && <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className={`min-h-0 min-w-0 flex-1 flex-col lg:flex lg:w-96 lg:flex-none lg:border-r ${thread || editor || detailLoading ? 'max-lg:hidden' : 'flex'}`}>
        <nav aria-label="Pastas de e-mail" className="flex shrink-0 gap-1 overflow-x-auto border-b py-2 lg:flex-wrap">
          {(Object.keys(labels) as Folder[]).map(item => <Button key={item} variant="ghost" type="button" aria-current={folder === item ? 'page' : undefined}
            className={folder === item ? 'border-b-2 border-b-brand rounded-none' : ''} onClick={() => chooseFolder(item)}>{labels[item]}</Button>)}
        </nav>
        {folder !== 'DRAFT' && <form onSubmit={(event: FormEvent) => { event.preventDefault(); invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setSearch(query.trim()); setPageToken(undefined); setPrevious([]); setRevision(current => current + 1); }}
          className="flex shrink-0 gap-2 py-3"><Input aria-label="Buscar e-mails" placeholder="Buscar no Gmail" value={query}
            onChange={event => setQuery(event.target.value)} maxLength={500} />
          <Button type="submit" variant="outline" aria-label="Buscar"><Search aria-hidden="true" /></Button></form>}
        {folder !== 'DRAFT' && <div className="shrink-0 border-b py-3">
          <Button type="button" variant="outline" disabled={triageBusy || listLoading || !threads.length}
            onClick={() => void classifyPage()}>{triageBusy ? 'Classificando…' : 'Classificar esta página'}</Button>
          <p className="mt-2 text-xs text-muted-foreground">Ao classificar, assunto, remetente e trecho desta página são analisados pelo TypeSafe AI. As sugestões não alteram o Gmail.</p>
          {triageMessage && <p role="status" className="mt-2 text-xs text-muted-foreground">{triageMessage}</p>}
          {visibleTriage.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="text-xs text-muted-foreground">Categoria
              <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as typeof categoryFilter)}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground md:h-9">
                <option value="all">Todas</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            <label className="text-xs text-muted-foreground">Prioridade
              <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as typeof priorityFilter)}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground md:h-9">
                <option value="all">Todas</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            <label className="text-xs text-muted-foreground">Ordenar
              <select value={sortOrder} onChange={event => setSortOrder(event.target.value as typeof sortOrder)}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground md:h-9">
                <option value="recent">Mais recentes</option><option value="priority">Prioridade</option>
              </select></label>
            <p className="col-span-3 text-xs text-muted-foreground">Filtros e ordem valem apenas para esta página.</p>
          </div>}
        </div>}
        <div ref={listScroller} tabIndex={0} role="region" aria-label="Lista de e-mails" className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {listLoading ? <p className="py-6 text-sm text-muted-foreground">Carregando e-mails…</p>
          : folder === 'DRAFT' ? drafts.length ? <div>{drafts.map(item => <button key={item.id} type="button"
            onClick={() => void openDraft(item.id)} className="block w-full border-b px-1 py-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block truncate text-sm font-medium">{item.subject || '(sem assunto)'}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.to.join(', ') || 'Sem destinatário'} · {item.snippet}</span>
          </button>)}</div> : <p className="py-6 text-sm text-muted-foreground">Nenhum rascunho.</p>
            : threads.length ? visibleThreads.length ? <div>{visibleThreads.map(item => <button key={item.id} type="button"
              onClick={() => void openThread(item.id)} className="block w-full border-b px-1 py-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className={`block truncate text-sm ${item.unread ? 'font-semibold' : 'font-medium'}`}>{item.subject || '(sem assunto)'}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.from} · {item.snippet}</span>
              <span className="text-xs text-muted-foreground">{formatDate(item.date)}{item.hasAttachments ? ' · Anexo' : ''}</span>
              {triageById.has(item.id) && <span className="mt-1 block text-xs text-muted-foreground">{categoryLabels[triageById.get(item.id)!.category]} · Prioridade {priorityLabels[triageById.get(item.id)!.priority]}
                {triageById.get(item.id)!.uncertain ? ' · A conferir' : ''}{triageById.get(item.id)!.needsReply ? ' · Resposta sugerida' : ''}</span>}
            </button>)}</div> : <p className="py-6 text-sm text-muted-foreground">Nenhum e-mail corresponde aos filtros desta página.</p>
              : <p className="py-6 text-sm text-muted-foreground">Nenhuma conversa nesta pasta.</p>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t py-2">
          <Button type="button" variant="ghost" size="icon" aria-label="Página anterior" disabled={!previous.length}
            onClick={() => { invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setPageToken(previous.at(-1)); setPrevious(items => items.slice(0, -1)); }}><ChevronLeft /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Próxima página" disabled={!nextToken}
            onClick={() => { invalidateTriage(); if (listScroller.current) listScroller.current.scrollTop = 0; setListLoading(true); setPrevious(items => [...items, pageToken]); setPageToken(nextToken ?? undefined); }}><ChevronRight /></Button>
        </div>
      </div>
      <section className={`min-h-0 min-w-0 flex-1 flex-col lg:flex lg:pl-6 ${thread || editor || detailLoading ? 'flex' : 'max-lg:hidden'}`} aria-label="Mensagem selecionada">
        {(thread || editor || detailLoading) && <Button type="button" variant="ghost" className="my-2 shrink-0 self-start lg:hidden" onClick={() => { detailRequest.current += 1; setDetailLoading(false); setThread(null); setEditor(null); }}>
          <ArrowLeft aria-hidden="true" />Voltar à lista</Button>}
        {thread && <h2 ref={detailHeading} tabIndex={-1} className="shrink-0 border-b py-4 text-lg font-medium outline-none">{thread.subject || '(sem assunto)'}</h2>}
        {editor && <h2 ref={detailHeading} tabIndex={-1} className="shrink-0 border-b py-4 text-lg font-medium outline-none">{editor.draftId ? 'Editar rascunho' : editor.replyToMessageId ? 'Responder' : 'Novo e-mail'}</h2>}
        <div ref={detailScroller} tabIndex={0} role="region" aria-label="Conteúdo do e-mail" className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {detailLoading && <p className="py-6 text-sm text-muted-foreground">Carregando mensagem…</p>}
        {thread && <div className="pb-10">
          {thread.messages.map(mail => <article key={mail.id} className="border-b py-5">
            <p className="text-sm font-medium">{mail.from}</p>
            <p className="mt-1 text-xs text-muted-foreground">Para: {mail.to.join(', ')}{mail.cc.length ? ` · Cc: ${mail.cc.join(', ')}` : ''} · {formatDate(mail.date)}</p>
            <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-6">{mail.text || 'Esta mensagem não tem texto legível.'}</div>
            {!!mail.attachments.length && <div className="mt-5 border-t pt-4">
              <p className="mb-2 text-sm font-medium">Anexos</p>
              {canWrite && <div className="mb-3 grid max-w-sm gap-1.5"><Label htmlFor={`email-case-${mail.id}`}>Importar para o caso</Label>
                <select id={`email-case-${mail.id}`} value={selectedCase} onChange={event => setSelectedCase(event.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-3 text-sm md:h-9">
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
              <Label htmlFor="mail-upload" className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent">
                <Paperclip aria-hidden="true" className="size-4" />Anexar arquivo</Label>
              <Input id="mail-upload" type="file" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
              <Button type="button" variant="outline" onClick={() => setShowVault(value => !value)}>Anexar do Cofre</Button>
            </div>
            {showVault && <div className="grid max-w-lg gap-3 border-t pt-4">
              <div className="grid gap-1.5"><Label htmlFor="mail-vault-case">Caso</Label>
                <select id="mail-vault-case" className="h-11 rounded-md border border-input bg-background px-3 text-sm md:h-9"
                  value={selectedCase} onChange={event => { setSelectedCase(event.target.value); setVaultDocumentId(''); setVaultDocuments([]); }}>
                  <option value="">Escolha um caso</option>{cases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className="grid gap-1.5"><Label htmlFor="mail-vault-document">Documento</Label>
                <select id="mail-vault-document" className="h-11 rounded-md border border-input bg-background px-3 text-sm md:h-9"
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
        {!thread && !editor && !detailLoading && <div className="hidden py-12 text-sm text-muted-foreground lg:block">Escolha uma conversa para ler.</div>}
        </div>
      </section>
    </div>}
    {approvalDialog}
    {enabled && !cases.length && canWrite && <p className="sr-only">Nenhum caso do Cofre disponível para importar anexos. <Link href="/app/vault">Abrir Cofre</Link></p>}
  </div>;
}
