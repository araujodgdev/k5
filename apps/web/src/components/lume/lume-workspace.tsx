'use client';

import { documentKey } from '@/lib/document-ref';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Columns2, Maximize2, Minimize2, PanelLeftClose } from 'lucide-react';
import { AgentChat, clearIdentityChatCache } from '@/components/agent-chat';
import { AiDataNotice } from '@/components/legal-gate';
import { LumeMark } from '@/components/lume-mark';
import { useDocumentDrafts } from '@/components/document/document-drafts-provider';
import { authClient } from '@/lib/auth-client';
import type { Modalities } from '@/lib/ai-modalities';
import { CanvasResourceReadError, canonicalCanvasHref, LumeWorkspaceController, resourceKey, restoreTabHrefs, tabStorageKey, type CanvasResource, type PanelMode, type ResourceAccess } from '@/lib/lume-workspace';
import { WorkspaceContext, type WorkspaceActions } from './workspace-context';
import type { WorkspaceMenuProps } from './workspace-menu';
import { OfficeShell } from '@/components/shell/office-shell';
import { CanvasHost, CanvasRegistry, CanvasFailure, canvasViewKey, type CanvasLeaf } from './canvas-host';
import { registerWorkspaceNavigator } from './canvas-navigation';

const subscribeMobile = (listener: () => void) => {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

function useNavigationSession(href: string) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    void authClient.getSession().then(({ data, error }) => {
      if (live && !error && !data) { window.dispatchEvent(new Event('lume:session-ended')); router.replace('/sign-in'); router.refresh(); }
    }).catch(() => {});
    return () => { live = false; };
  }, [href, router]);
}

export function LumeWorkspace({ identity, aiNoticeAccepted, modalities, children, ...menu }: WorkspaceMenuProps & {
  identity: { userId: string; officeId: string };
  aiNoticeAccepted: boolean;
  modalities: Modalities;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const href = canonicalCanvasHref(pathname + (params.size ? `?${params}` : '')) ?? '/app/command-center';
  const [controller] = useState(() => new LumeWorkspaceController(href, pathname === '/app/command-center' && !params.size ? 'chat' : 'canvas'));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const [conversationIntent, setConversationIntent] = useState<WorkspaceActions['conversationIntent']>(null);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const { saveOpen, drafts, invalidate: invalidateDraft } = useDocumentDrafts();
  const [leaves, setLeaves] = useState<CanvasLeaf[]>([]);
  const [activeView, setActiveView] = useState<string | null>(null);
  const leavesRef = useRef(leaves);
  const intent = useRef<{ href: string; nonce: string; serial: number; access?: ResourceAccess } | null>(null);
  const serial = useRef(0);
  const completion = useRef<((success: boolean) => void) | null>(null);
  const finishNavigation = useCallback((success: boolean) => {
    const resolve = completion.current;
    completion.current = null;
    resolve?.(success);
  }, []);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const expiredRef = useRef(false);
  const sender = useRef<((text: string) => void) | null>(null);

  const storageKey = tabStorageKey(identity.userId, identity.officeId);

  useNavigationSession(href);
  useEffect(() => {
    const clear = () => {
      if (expiredRef.current) return;
      expiredRef.current = true; ++serial.current; intent.current = null;
      finishNavigation(false);
      leavesRef.current = []; setLeaves([]); setExpired(true); drafts.clear();
      clearIdentityChatCache(identity.userId + ':' + identity.officeId);
      router.replace('/sign-in'); router.refresh();
    };
    window.addEventListener('lume:session-ended', clear);
    return () => { window.removeEventListener('lume:session-ended', clear); };
  }, [drafts,finishNavigation,identity.userId,identity.officeId,router]);
  useEffect(() => () => clearIdentityChatCache(identity.userId + ':' + identity.officeId), [identity.userId,identity.officeId]);

  useEffect(() => {
    const showTutorial = (event: Event) => {
      const surface = (event as CustomEvent<unknown>).detail;
      if (surface !== 'chat' && surface !== 'canvas') return;
      controller.dispatch({ type: 'mode', mode: 'floating' });
      controller.dispatch({ type: 'mobile', mobile: surface });
    };
    window.addEventListener('lume:tutorial-surface', showTutorial);
    return () => window.removeEventListener('lume:tutorial-surface', showTutorial);
  }, [controller]);

  const clearRevokedDrafts = useCallback((previousTabs: CanvasResource[], resource: CanvasResource | null) => {
    const retained = controller.getSnapshot().tabs;
    for (const tab of previousTabs) if (tab.kind === 'document' && !retained.some(current => resourceKey(current) === resourceKey(tab))) invalidateDraft(documentKey(tab.document));
    if (resource?.kind === 'document') invalidateDraft(documentKey(resource.document));
  }, [controller, invalidateDraft]);

  const invalidateResource = useCallback((access: ResourceAccess) => {
    const previousTabs = controller.getSnapshot().tabs;
    if (controller.invalidateResource(access)) clearRevokedDrafts(previousTabs, access.resource);
  }, [controller, clearRevokedDrafts]);

  const resolveResource = useCallback(async (requested: string, remember = true) => {
    const target = canonicalCanvasHref(requested);
    if (!target) throw new Error('Destino inválido para o canvas.');
    const previousTabs = controller.getSnapshot().tabs;
    const result = await controller.resolveResource(target, async () => {
      const response = await fetch(`/api/canvas/resource?href=${encodeURIComponent(target)}`, { cache: 'no-store' });
      if (!response.ok) throw new CanvasResourceReadError(response.status);
      return ((await response.json()) as { resource: CanvasResource }).resource;
    }, remember).catch(cause => {
      if (cause instanceof CanvasResourceReadError && cause.status === 401) { window.dispatchEvent(new Event('lume:session-ended')); router.replace('/sign-in'); router.refresh(); }
      throw cause;
    });
    if (result.status === 'revoked') {
      clearRevokedDrafts(previousTabs, result.resource);
      throw new CanvasResourceReadError(404);
    }
    return result.status === 'authorized' ? result.resource : null;
  }, [controller, clearRevokedDrafts, router]);

  const activate = useCallback(async (requested: string, navigation?: number, replace = false) => {
    finishNavigation(false);
    const requestSerial = ++serial.current;
    const origin = controller.getSnapshot();
    if (origin.mode === 'focused') controller.dispatch({ type: 'mode', mode: 'floating' });
    controller.dispatch({ type: 'mobile', mobile: 'canvas' });
    const nonce = crypto.randomUUID();
    intent.current = { href: canonicalCanvasHref(requested) ?? requested, nonce, serial: requestSerial };
    setLoading(true);
    const started = navigation ?? origin.navigation;
    const canContinue = () => {
      const current = controller.getSnapshot();
      return controller.canPresentResult(started) || navigation === undefined && current.href === origin.href
        && current.revokedHref === origin.href;
    };
    try {
      const resource = await resolveResource(requested, false);
      if (!resource || requestSerial !== serial.current || !canContinue()) {
        if (requestSerial === serial.current) { intent.current = null; setLoading(false); }
        return false;
      }
      await Promise.all(origin.tabs.filter(tab => resourceKey(tab) !== resourceKey(resource)).map(async tab => {
        try { await resolveResource(tab.href, false); }
        catch (cause) { if (!(cause instanceof CanvasResourceReadError && (cause.status === 403 || cause.status === 404))) throw cause; }
      }));
      const selected = controller.getSnapshot().sources;
      const documents = await Promise.all(selected.documentIds.map(async id => {
        try { return await resolveResource(`/app/vault/files/${encodeURIComponent(id)}`, false) ? id : null; }
        catch (cause) { if (cause instanceof CanvasResourceReadError && (cause.status === 403 || cause.status === 404)) return null; throw cause; }
      }));
      let references = selected.researchReferenceIds;
      if (selected.caseId && references.length) {
        const response = await fetch(`/api/research/cases/${encodeURIComponent(selected.caseId)}/references`, {cache:'no-store'});
        if (response.ok) {
          const body = await response.json() as {references:{id:string}[]};
          references = references.filter(id => body.references.some(item => item.id === id));
        } else if (response.status === 403 || response.status === 404) references = [];
        else throw new CanvasResourceReadError(response.status);
      }
      if (requestSerial !== serial.current) return false;
      const latestSources = controller.getSnapshot().sources;
      if (latestSources === selected) controller.dispatch({type:'sources',sources:{...selected,documentIds:documents.filter((id): id is string => id !== null),researchReferenceIds:references}});
      if (!await saveOpen()) throw new Error('Salve ou resolva o conflito do documento antes de abrir outro recurso.');
      if (requestSerial !== serial.current || !canContinue()) { if (requestSerial === serial.current) { intent.current = null; setLoading(false); } return false; }
      setError('');
      intent.current = { href: resource.href, nonce, serial: requestSerial, access: controller.captureResourceAccess(resource) };
      setLoading(true);
      const requestedUrl = new URL(requested, window.location.origin);
      const target = new URL(resource.href, window.location.origin);
      for (const key of ['conversationId', 'lume', 'feedback', 'notificacoes']) {
        const value = requestedUrl.searchParams.get(key);
        if (value !== null) target.searchParams.set(key, value);
      }
      if (requestedUrl.pathname === '/app/agents') target.searchParams.set('lume', '1');
      target.searchParams.set('__canvas', nonce);
      // Republishing a framework navigation must not pull the browser back once a newer one has started.
      if (replace && canonicalCanvasHref(window.location.pathname + window.location.search) !== canonicalCanvasHref(requested)) {
        intent.current = null; setLoading(false);
        return false;
      }
      const committed = new Promise<boolean>(resolve => { completion.current = resolve; });
      if (replace) router.replace(target.pathname + target.search, { scroll: false });
      else router.push(target.pathname + target.search, { scroll: false });
      return await committed;
    } catch (cause) {
      if (requestSerial === serial.current) {
        finishNavigation(false);
        intent.current = null;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o recurso.');
        if (replace) router.replace(origin.href, { scroll: false });
      }
      return false;
    }
  }, [controller, finishNavigation, resolveResource, router, saveOpen]);
  const navigate = useCallback((requested: string) => activate(requested), [activate]);
  useEffect(() => registerWorkspaceNavigator(navigate), [navigate]);
  const loadFailed = useCallback(() => {
    if (!intent.current) return;
    ++serial.current; intent.current = null;
    finishNavigation(false);
    setLoading(false); setError('Não foi possível abrir a tela. O conteúdo anterior foi preservado.');
    router.replace(controller.getSnapshot().href, { scroll: false });
  }, [controller, finishNavigation, router]);
  const openResource = useCallback(async (requested: string, navigation?: number) => {
    if (navigation === undefined) { await activate(requested); return; }
    try {
      const resource = await resolveResource(requested, false);
      if (!resource) return;
      const current = controller.getSnapshot();
      if (current.tabs.length >= 20 && drafts.hasUnsaved() && !current.tabs.some(tab => resourceKey(tab) === resourceKey(resource))) return;
      controller.dispatch({ type: 'tab', resource });
      if (controller.canPresentResult(navigation) && !intent.current) await activate(resource.href, navigation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o recurso.');
    }
  }, [activate, controller, drafts, resolveResource]);
  useLayoutEffect(() => {
    if (leavesRef.current.length && href !== controller.getSnapshot().href && !intent.current) {
      void activate(href, undefined, true);
    }
  }, [activate, controller, href]);
  const publish = useCallback((leaf: CanvasLeaf) => {
    if (expiredRef.current) return;
    const pending = intent.current;
    if (pending ? pending.href !== leaf.href || pending.nonce !== leaf.nonce
      : leaf.href !== canonicalCanvasHref(window.location.pathname + window.location.search)) return;
    if (pending?.access && !controller.isResourceAccessCurrent(pending.access)) { loadFailed(); return; }
    if (!pending && leavesRef.current.length && leaf.href !== controller.getSnapshot().href) {
      void activate(leaf.href, undefined, true);
      return;
    }
    const generation = serial.current;
    void (async () => {
      if (!await saveOpen()) {
        if (generation !== serial.current) return;
        setError('Não foi possível salvar o documento. Suas alterações continuam no editor.');
        intent.current = null; finishNavigation(false); setLoading(false);
        router.replace(controller.getSnapshot().href, { scroll: false });
        return;
      }
      if (generation !== serial.current || leaf.href !== canonicalCanvasHref(window.location.pathname + window.location.search)) return;
      if (pending?.access && !controller.isResourceAccessCurrent(pending.access)) { loadFailed(); return; }
      const key = canvasViewKey(leaf.href);
      let retained = leavesRef.current;
      if (!retained.some(entry => canvasViewKey(entry.href) === key) && retained.length >= 20) {
        if (drafts.hasUnsaved()) {
          setError('Salve seus documentos antes de abrir mais telas.');
          router.replace(controller.getSnapshot().href, { scroll: false });
          intent.current = null; finishNavigation(false);
          setLoading(false);
          return;
        }
        const currentResource = controller.getSnapshot().resource;
        const oldest = retained.find(entry => entry.href !== '/app/command-center' && (!currentResource || resourceKey(entry.resource) !== resourceKey(currentResource)));
        if (!oldest) {
          setError('Feche uma tela antes de abrir mais destinos.');
          intent.current = null; finishNavigation(false);
          setLoading(false); router.replace(controller.getSnapshot().href, {scroll:false}); return;
        }
        if (oldest) { retained = retained.filter(entry => entry !== oldest); controller.dispatch({ type: 'close', key: resourceKey(oldest.resource) }); }
      }
      const next = retained.some(entry => canvasViewKey(entry.href) === key)
        ? retained.map(entry => canvasViewKey(entry.href) === key ? leaf : entry) : [...retained, leaf];
      leavesRef.current = next;
      setLeaves(next);
      setActiveView(key);
      intent.current = null;
      setLoading(false);
      controller.dispatch({ type: 'destination', href: leaf.href, resource: leaf.resource, mobile: controller.getSnapshot().mobile });
      controller.dispatch({ type: 'authorized', resource: leaf.resource });
      finishNavigation(true);
      const url = new URL(window.location.href);
      const conversationId = url.searchParams.get('conversationId');
      if (conversationId) setConversationIntent(value => ({ id: conversationId, serial: (value?.serial ?? 0) + 1 }));
      if (conversationId || url.searchParams.get('lume') === '1') {
        controller.dispatch({ type: 'mode', mode: 'floating' });
        controller.dispatch({ type: 'mobile', mobile: url.pathname.startsWith('/app/vault/') || url.pathname.startsWith('/app/documents/') ? 'canvas' : 'chat' });
      }
      if (url.searchParams.has('__canvas') || url.searchParams.has('conversationId') || url.searchParams.has('lume')) {
        for (const key of ['__canvas', 'conversationId', 'lume']) url.searchParams.delete(key);
        // A null state lets Next and vinext sync usePathname/useSearchParams; their own state object is skipped.
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    })();
  }, [activate, controller, drafts, finishNavigation, loadFailed, router, saveOpen]);


  useLayoutEffect(() => {
    const retained = leavesRef.current.filter(leaf => state.tabs.some(tab => resourceKey(tab) === resourceKey(leaf.resource)));
    for (const leaf of leavesRef.current) if (leaf.resource.kind === 'document' && !retained.some(entry => resourceKey(entry.resource) === resourceKey(leaf.resource))) invalidateDraft(documentKey(leaf.resource.document));
    leavesRef.current = retained;
    setLeaves(retained);
  }, [state.tabs, invalidateDraft]);

  useEffect(() => {
    let cancelled = false;
    let hrefs: string[] = [];
    try { hrefs = restoreTabHrefs(localStorage.getItem(storageKey)); } catch {}
    void Promise.allSettled(hrefs.map(target => resolveResource(target))).then(() => {
      if (cancelled) return;
      setRestored(true);
    });
    return () => { cancelled = true; };
  }, [controller, resolveResource, storageKey]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state.tabs.map(tab => tab.href))); } catch {}
  }, [restored, state.tabs, storageKey]);

  const actions = useMemo<WorkspaceActions>(() => ({
    controller, navigate, openResource, invalidateResource, conversationIntent,
    registerSender(send) {
      sender.current = send;
      return () => { if (sender.current === send) sender.current = null; };
    },
    async ask(request) {
      if (!sender.current) throw new Error('Abra uma conversa para pedir ao Lume.');
      const resource = controller.getSnapshot().resource;
      if (resource?.kind !== 'document' || documentKey(resource.document) !== documentKey(request.document)) throw new Error('Aguarde o documento carregar antes de pedir ao Lume.');
      controller.selectExcerpt({ document: request.document, excerpt: request.excerpt });
      try {
        sender.current(request.instruction);
        controller.dispatch({ type: 'mode', mode: 'floating' });
        controller.dispatch({ type: 'mobile', mobile: 'chat' });
      } catch (cause) { controller.selectExcerpt(undefined); throw cause; }
    },
  }), [controller, navigate, openResource, invalidateResource, conversationIntent]);

  const chatHidden = mobile ? state.mobile !== 'chat' : state.mode === 'collapsed';
  const canvasHidden = mobile ? state.mobile !== 'canvas' : state.mode === 'focused';
  useLayoutEffect(() => {
    const active = document.activeElement;
    const panel = document.getElementById('lume-panel');
    const canvas = document.getElementById('main-content');
    if (chatHidden && panel?.contains(active)) canvas?.focus();
    if (canvasHidden && canvas?.contains(active)) panel?.focus();
  }, [chatHidden, canvasHidden]);

  function mode(next: PanelMode) {
    controller.dispatch({ type: 'mode', mode: mobile ? 'floating' : next });
    if (mobile) controller.dispatch({ type: 'mobile', mobile: next === 'collapsed' ? 'canvas' : 'chat' });
    requestAnimationFrame(() => document.getElementById(next === 'collapsed' ? 'main-content' : 'lume-panel')?.focus());
  }
  const panelControls = <>
    <button type="button" className="lume-icon" aria-label={state.mode === 'focused' ? 'Voltar ao painel flutuante' : 'Ampliar conversa'} onClick={() => mode(state.mode === 'focused' ? 'floating' : 'focused')}>{state.mode === 'focused' ? <Minimize2 /> : <Maximize2 />}</button>
    <button type="button" className="lume-icon" aria-label="Recolher o Lume" onClick={() => mode('collapsed')}><PanelLeftClose /></button>
  </>;
  if (expired) return null;
  return <WorkspaceContext value={actions}><CanvasRegistry value={publish}><CanvasFailure value={loadFailed}>
    <OfficeShell userId={identity.userId} officeId={identity.officeId} {...menu}
      lume={<>
        {!aiNoticeAccepted && <header className="lume-panel-header"><LumeMark width={22} height={22} /><span className="font-medium">Lume</span><div className="ml-auto flex gap-1">{panelControls}</div></header>}
        {aiNoticeAccepted ? <AgentChat identityKey={`${identity.userId}:${identity.officeId}`} displayName={menu.person.name} modalities={modalities} panelControls={panelControls} /> : <div className="min-h-0 flex-1 overflow-y-auto"><AiDataNotice /></div>}
        {state.mode === 'focused' && <button type="button" className="lume-open-canvas" onClick={() => mode('floating')}><Columns2 className="size-4" />Abrir canvas</button>}
      </>}>
      <div hidden={leaves.length > 0} aria-hidden={leaves.length > 0}>{children}</div>
      <CanvasHost leaves={leaves} active={state.revokedHref === state.href ? null : activeView} />
      {state.revokedHref === state.href && <p className="px-5 py-4 text-sm">Este recurso não está mais disponível. Abra outro destino no canvas.</p>}
      {loading && <p role="status" className="pointer-events-none absolute bottom-4 right-4 text-[13px] text-muted-foreground">Abrindo…</p>}
    </OfficeShell>
    {error && <p className="fixed bottom-4 right-4 z-50 rounded-lg border bg-popover p-4 text-sm text-destructive" role="alert">{error}</p>}
  </CanvasFailure></CanvasRegistry></WorkspaceContext>;
}
