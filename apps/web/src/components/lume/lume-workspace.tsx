'use client';

import { documentKey } from '@/lib/document-ref';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Columns2, Maximize2, Minimize2, PanelLeftClose } from 'lucide-react';
import { AgentChat } from '@/components/agent-chat';
import { AiDataNotice } from '@/components/legal-gate';
import { LumeMark } from '@/components/lume-mark';
import { useDocumentDrafts } from '@/components/document/document-drafts-provider';
import { authClient } from '@/lib/auth-client';
import type { Modalities } from '@/lib/ai-modalities';
import { CanvasResourceReadError, canonicalCanvasHref, LumeWorkspaceController, moduleResource, resourceKey, restoreTabHrefs, tabStorageKey, type CanvasResource, type PanelMode, type ResourceAccess } from '@/lib/lume-workspace';
import { WorkspaceContext, type WorkspaceActions } from './workspace-context';
import type { WorkspaceMenuProps } from './workspace-menu';
import { OfficeShell } from '@/components/shell/office-shell';

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
      if (live && !error && !data) { router.replace('/sign-in'); router.refresh(); }
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
  const { saveOpen, invalidate: invalidateDraft } = useDocumentDrafts();
  const sender = useRef<((text: string) => void) | null>(null);

  const storageKey = tabStorageKey(identity.userId, identity.officeId);
  const allowedModule = useCallback((value: string) => {
    const resource = moduleResource(value);
    if (resource?.kind !== 'module') return null;
    if ((resource.slug === 'whatsapp' && !menu.whatsappEnabled) || (resource.slug === 'ads' && !menu.adsEnabled) || (resource.slug === 'admin' && !menu.platformAdmin)) return null;
    return resource;
  }, [menu.adsEnabled, menu.platformAdmin, menu.whatsappEnabled]);

  useLayoutEffect(() => {
    const resource = allowedModule(href);
    controller.dispatch({ type: 'destination', href, resource });
    if (resource) controller.dispatch({ type: 'authorized', resource });
  }, [controller, href, allowedModule]);

  useNavigationSession(href);

  useEffect(() => {
    for (const tab of state.tabs) router.prefetch(tab.href);
  }, [router, state.tabs]);

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

  const navigate = useCallback(async (requested: string) => {
    const target = canonicalCanvasHref(requested);
    if (!target) return false;
    if (!await saveOpen()) { setError('Não foi possível salvar o documento. Suas alterações continuam no editor.'); return false; }
    setError('');
    const resource = allowedModule(target);
    if (target !== controller.getSnapshot().href) controller.dispatch({ type: 'destination', href: target, resource, explicit: true });
    if (resource) controller.dispatch({ type: 'authorized', resource });
    if (controller.getSnapshot().mode === 'focused') controller.dispatch({ type: 'mode', mode: 'floating' });
    controller.dispatch({ type: 'mobile', mobile: 'canvas' });
    router.push(requested, { scroll: false });
    return true;
  }, [allowedModule, controller, router, saveOpen]);

  const clearRevokedDrafts = useCallback((previousTabs: CanvasResource[], resource: CanvasResource | null) => {
    const retained = controller.getSnapshot().tabs;
    for (const tab of previousTabs) if (tab.kind === 'document' && !retained.some(current => resourceKey(current) === resourceKey(tab))) invalidateDraft(documentKey(tab.document));
    if (resource?.kind === 'document') invalidateDraft(documentKey(resource.document));
  }, [controller, invalidateDraft]);

  const invalidateResource = useCallback((access: ResourceAccess) => {
    const previousTabs = controller.getSnapshot().tabs;
    if (controller.invalidateResource(access)) clearRevokedDrafts(previousTabs, access.resource);
  }, [controller, clearRevokedDrafts]);

  const resolveResource = useCallback(async (requested: string) => {
    const target = canonicalCanvasHref(requested);
    if (!target) throw new Error('Destino inválido para o canvas.');
    const previousTabs = controller.getSnapshot().tabs;
    const result = await controller.resolveResource(target, async () => {
      const response = await fetch(`/api/canvas/resource?href=${encodeURIComponent(target)}`, { cache: 'no-store' });
      if (!response.ok) throw new CanvasResourceReadError(response.status);
      return ((await response.json()) as { resource: CanvasResource }).resource;
    }).catch(cause => {
      if (cause instanceof CanvasResourceReadError && cause.status === 401) { router.replace('/sign-in'); router.refresh(); }
      throw cause;
    });
    if (result.status === 'revoked') {
      clearRevokedDrafts(previousTabs, result.resource);
      throw new CanvasResourceReadError(404);
    }
    return result.status === 'authorized' ? result.resource : null;
  }, [controller, clearRevokedDrafts, router]);

  const openResource = useCallback(async (requested: string, navigation?: number) => {
    const origin = controller.getSnapshot();
    const started = navigation ?? origin.navigation;
    const canContinue = () => {
      const current = controller.getSnapshot();
      return controller.canPresentResult(started) || navigation === undefined && current.href === origin.href
        && current.revokedHref === origin.href && controller.canPresentResult(started + 1);
    };
    try {
      const resource = await resolveResource(requested);
      if (!resource) return;
      if (controller.getSnapshot().resource?.href === resource.href) {
        if (navigation === undefined && canContinue()) {
          setError('');
          if (controller.getSnapshot().mode === 'focused') controller.dispatch({ type: 'mode', mode: 'floating' });
          controller.dispatch({ type: 'mobile', mobile: 'canvas' });
        }
        return;
      }
      if (!canContinue()) return;
      if (!await saveOpen()) { setError('Salve ou resolva o conflito do documento antes de abrir outro recurso.'); return; }
      if (!canContinue()) return;
      setError('');
      controller.dispatch({ type: 'destination', href: resource.href, resource: resource.kind === 'module' ? resource : null, explicit: true });
      if (resource.kind === 'module') controller.dispatch({ type: 'authorized', resource });
      if (controller.getSnapshot().mode === 'focused') controller.dispatch({ type: 'mode', mode: 'floating' });
      controller.dispatch({ type: 'mobile', mobile: 'canvas' });
      router.push(resource.href, { scroll: false });
    } catch (cause) {
      if (controller.canPresentResult(started) || controller.getSnapshot().revokedHref === canonicalCanvasHref(requested)) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o recurso.');
    }
  }, [controller, resolveResource, router, saveOpen]);

  useEffect(() => {
    let cancelled = false;
    let hrefs: string[] = [];
    try { hrefs = restoreTabHrefs(localStorage.getItem(storageKey)); } catch {}
    void Promise.allSettled(hrefs.map(resolveResource)).then(() => {
      if (cancelled) return;
      setRestored(true);
    });
    return () => { cancelled = true; };
  }, [controller, resolveResource, storageKey]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state.tabs.map(tab => tab.href))); } catch {}
  }, [restored, state.tabs, storageKey]);

  const requestedConversation = params.get('conversationId');
  const focusRequested = params.get('lume') === '1';
  const [handledConversation, setHandledConversation] = useState<string | null>(null);
  if (requestedConversation !== handledConversation) {
    setHandledConversation(requestedConversation);
    if (requestedConversation) setConversationIntent(value => ({ id: requestedConversation, serial: (value?.serial ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!requestedConversation && !focusRequested) return;
    controller.dispatch({ type: 'mode', mode: 'floating' });
    controller.dispatch({ type: 'mobile', mobile: pathname.startsWith('/app/vault/') || pathname.startsWith('/app/documents/') ? 'canvas' : 'chat' });
    const url = new URL(window.location.href);
    url.searchParams.delete('conversationId'); url.searchParams.delete('lume');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [controller, requestedConversation, focusRequested, pathname]);

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
  return <WorkspaceContext value={actions}>
    <OfficeShell userId={identity.userId} officeId={identity.officeId} {...menu}
      lume={<>
        {!aiNoticeAccepted && <header className="lume-panel-header"><LumeMark width={22} height={22} /><span className="font-medium">Lume</span><div className="ml-auto flex gap-1">{panelControls}</div></header>}
        {aiNoticeAccepted ? <AgentChat identityKey={`${identity.userId}:${identity.officeId}`} displayName={menu.person.name} modalities={modalities} panelControls={panelControls} /> : <div className="min-h-0 flex-1 overflow-y-auto"><AiDataNotice /></div>}
        {state.mode === 'focused' && <button type="button" className="lume-open-canvas" onClick={() => mode('floating')}><Columns2 className="size-4" />Abrir canvas</button>}
      </>}>
      {state.revokedHref === state.href ? <p className="px-5 py-4 text-sm">Este recurso não está mais disponível. Abra outro destino no canvas.</p> : children}
    </OfficeShell>
    {error && <p className="fixed bottom-4 right-4 z-50 rounded-lg border bg-popover p-4 text-sm text-destructive" role="alert">{error}</p>}
  </WorkspaceContext>;
}
