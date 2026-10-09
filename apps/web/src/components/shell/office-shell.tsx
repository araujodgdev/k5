'use client';

import { usePathname } from '@/components/lume/canvas-navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { FeedbackDialog } from '@/components/feedback-dialog';
import { NotificationPanel } from '@/components/notification-panel';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AccountMenu, type Person } from './account-menu';
import { OfficeBar } from './office-bar';
import type { LauncherAccess } from './launcher';
import { usePanelMotion, type PanelMotionRefs } from './panel-motion';
import { PhoneBar, PhonePill } from './phone-canvas';
import { SearchDialog } from './search-dialog';
import { ShellContext } from './shell-context';
import { useLogout, useQueryOpener, useSessionWatch, useUnreadNotifications } from './use-office-chrome';
import { useRedesignShellState } from '@/components/lume/redesign-shell-state';
import { canonicalCanvasHref } from '@/lib/lume-workspace';
import { useLumeWorkspace } from '@/components/lume/workspace-context';
import { useLumeState } from '@/components/lume/workspace-context';

type Feedback = { open: boolean; view: 'form' | 'history' };

export type OfficeShellProps = LauncherAccess & {
  userId: string;
  officeId: string;
  officeName: string;
  person: Person;
  /** The Lume's panel, mounted once and kept while it is collapsed. */
  lume: ReactNode;
  children: ReactNode;
};

const subscribeMobile = (listener: () => void) => {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

/**
 * The office bar runs across the top; under it the Lume's panel and the canvas sit side by side. The
 * chrome shares the workspace controller and keeps the chat mounted.
 */
export function OfficeShell({ officeName, person, platformAdmin, whatsappEnabled, adsEnabled, lume, children }: OfficeShellProps) {
  const pathname = usePathname();
  const access = useMemo<LauncherAccess>(() => ({ platformAdmin, whatsappEnabled, adsEnabled }), [platformAdmin, whatsappEnabled, adsEnabled]);
  const { shell, tabs, active, go, close } = useRedesignShellState(access);
  const state = useLumeState();
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const row = useRef<HTMLDivElement>(null), slot = useRef<HTMLDivElement>(null), aside = useRef<HTMLElement>(null), bar = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const motion = useMemo<PanelMotionRefs>(() => ({ row, slot, panel: aside, bar, toggle }), []);
  usePanelMotion(state.mode, mobile, motion);
  const { navigate, controller } = useLumeWorkspace();
  function interceptLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor || !anchor.closest('#main-content') || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.hash) return;
    const href = canonicalCanvasHref(url.pathname + url.search);
    if (!href) return;
    event.preventDefault(); event.stopPropagation();
    void navigate(url.pathname + url.search);
  }
  const unread = useUnreadNotifications();
  const { logout, pending, error, confirmDiscard, setConfirmDiscard } = useLogout();
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ open: false, view: 'form' });
  const opener = useRef<HTMLElement | null>(null);
  useSessionWatch();
  useQueryOpener('feedback', 'relatos', () => setFeedback({ open: true, view: 'history' }));
  useQueryOpener('notificacoes', '1', () => setNotifications(true));

  const { panel, setPanel } = shell;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') { event.preventDefault(); setSearch((value) => !value); }
      if (key === 'j') { event.preventDefault(); setPanel(panel === 'open' ? 'collapsed' : 'open'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, setPanel]);

  const restoreFocus = () => {
    const from = opener.current;
    if (from?.isConnected && from.offsetParent !== null) from.focus();
    else document.getElementById('main-content')?.focus();
  };
  function openNotifications(from: HTMLElement) { opener.current = from; setNotifications(true); }
  function openFeedback(from: HTMLElement) { opener.current = from; setFeedback({ open: true, view: 'form' }); }

  return (
    <ShellContext value={shell}>
      <div onClickCapture={interceptLink} data-lume-shell data-mode={state.mode} data-mobile-surface={state.mobile} className="lume-workspace relative flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <a href="#main-content" onClick={event => {
          event.preventDefault();
          if (controller.getSnapshot().mode === 'focused') controller.dispatch({ type: 'mode', mode: 'floating' });
          controller.dispatch({ type: 'mobile', mobile: 'canvas' });
          requestAnimationFrame(() => document.getElementById('main-content')?.focus());
        }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-popover focus:px-3 focus:py-2">Ir para o conteúdo</a>
        <OfficeBar access={access} tabs={tabs} active={active} unread={unread} panel={state.mode === 'collapsed' ? 'collapsed' : 'open'} activity={shell.activity}
          onPanel={setPanel} onGo={go} onClose={close} onSearch={() => setSearch(true)} onNotifications={openNotifications}
          lumeRef={bar} toggleRef={toggle}
          account={<AccountMenu person={person} officeName={officeName} pending={pending} onFeedback={openFeedback} onLogout={() => void logout()} />} />
        <div ref={row} className="relative flex min-h-0 flex-1 md:pb-2.5">
          <div ref={slot} className="lume-panel-slot relative z-[2] flex h-full w-full flex-none md:ml-2.5 md:w-[clamp(360px,33.333%,500px)]">
            <aside ref={aside} id="lume-panel" aria-label="Lume" tabIndex={-1} inert={shell.panel === 'collapsed'}
              className="lume-panel relative flex h-full w-full flex-none flex-col overflow-hidden bg-background outline-none md:rounded-xl md:border md:border-border md:bg-pane md:shadow-[var(--shadow-float)]">
              {lume}
            </aside>
          </div>
          <section tabIndex={-1} aria-label="Canvas do escritório"
            className="lume-canvas relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background outline-none md:mx-2.5 md:rounded-xl md:border md:border-border">
            <PhoneBar access={access} unread={unread} pending={pending} onSearch={() => setSearch(true)}
              onNotifications={openNotifications} onFeedback={openFeedback} onLogout={() => void logout()} />
            {error && <p role="alert" className="border-b border-border px-4 py-2 text-[13px] text-destructive">{error}</p>}
            <main id="main-content" tabIndex={-1} className="lume-canvas-content canvas-scroll flex min-h-0 flex-1 flex-col overflow-y-auto max-md:pb-24 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
              {children}
            </main>
            <PhonePill />
          </section>
        </div>
      </div>
      <SearchDialog open={search} onOpenChange={setSearch} access={access} places={state.tabs} />
      <NotificationPanel open={notifications} onOpenChange={setNotifications} onCloseFocus={restoreFocus} />
      <FeedbackDialog open={feedback.open} initialView={feedback.view} pathname={pathname}
        onOpenChange={(open) => setFeedback((current) => ({ ...current, open }))} onCloseFocus={restoreFocus} />
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>Não foi possível salvar suas alterações. Se sair agora, os rascunhos não salvos serão descartados e sua conta sairá de todos os dispositivos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Continuar editando</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" variant="destructive" onClick={() => void logout(true)}>Sair sem salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ShellContext>
  );
}
