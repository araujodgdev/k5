'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from '@/components/lume/canvas-navigation';
import { Grid2X2, LogOut, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { appNavigation, adminNavigation, profileNavigation, navIsBeta } from '@/lib/navigation';
import { navIcons } from '@/components/nav-icons';
import { ThemeSwitch } from '@/components/theme-provider';
import { InstallApp } from '@/components/pwa-provider';
import { Avatar } from '@/components/profile/avatar';
import { FeedbackDialog, FeedbackTrigger } from '@/components/feedback-dialog';
import { NotificationPanel, NotificationTrigger } from '@/components/notification-panel';
import { TutorialTrigger } from '@/components/onboarding-tour';
import { BetaLabel } from '@/components/ads/beta-label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useSaveDocumentsBeforeExit } from '@/components/document/document-drafts-provider';
import { useLumeWorkspace } from './workspace-context';

export type WorkspaceMenuProps = {
  officeName: string;
  person: { name: string; avatarUrl: string | null };
  platformAdmin: boolean;
  whatsappEnabled: boolean;
  adsEnabled: boolean;
};

export function WorkspaceMenu({ officeName, person, platformAdmin, whatsappEnabled, adsEnabled, children }: WorkspaceMenuProps & { children: ReactNode }) {
  const { navigate, controller } = useLumeWorkspace();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const saveBeforeExit = useSaveDocumentsBeforeExit();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState(false);
  const [feedback, setFeedback] = useState<{ open: boolean; view: 'form' | 'history' }>({ open: false, view: 'form' });
  const opener = useRef<HTMLElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void fetch('/api/notifications/count', { cache: 'no-store' }).then(async response => {
        if (!response.ok) return;
        const value = await response.json() as { unread?: number };
        if (live) setUnread(Math.max(0, Number(value.unread ?? 0)));
      }).catch(() => {});
    };
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'K5_NOTIFICATION') load(); };
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('k5-notifications') : null;
    channel?.addEventListener('message', load);
    load();
    const timer = window.setInterval(load, 60_000);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('online', load);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('online', load);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      channel?.close();
    };
  }, [pathname]);

  const reportsRequested = params.get('feedback') === 'relatos';
  const notificationsRequested = params.get('notificacoes') === '1';
  const [handled, setHandled] = useState('');
  const requested = `${reportsRequested}:${notificationsRequested}`;
  if (handled !== requested) {
    setHandled(requested);
    if (reportsRequested) setFeedback({ open: true, view: 'history' });
    if (notificationsRequested) setNotifications(true);
  }
  useEffect(() => {
    if (!reportsRequested && !notificationsRequested) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('feedback');
    url.searchParams.delete('notificacoes');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [reportsRequested, notificationsRequested]);

  function restoreFocus() {
    if (opener.current?.isConnected && opener.current.offsetParent !== null) opener.current.focus();
    else menuButton.current?.focus();
  }
  async function logout(force = false) {
    if (pending) return;
    setPending(true); setError(''); setAccountOpen(false);
    if (!force && !await saveBeforeExit()) { setPending(false); setDiscard(true); return; }
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('logout');
      router.replace('/sign-in'); router.refresh();
    } catch { setError('Não foi possível sair. Tente novamente.'); setPending(false); setAccountOpen(true); }
  }
  function go(href: string) { setOpen(false); setAccountOpen(false); void navigate(href); }

  return <>
    <header className="lume-toolbar" aria-label="Barra do escritório">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button ref={menuButton} variant="ghost" size="icon" className="lume-icon" aria-label="Abrir módulos" data-tutorial="navigation"><Grid2X2 /></Button></PopoverTrigger>
        <PopoverContent align="start" className="lume-menu w-72 p-2">
          <p className="truncate px-3 py-2 text-xs text-muted-foreground">{officeName}</p>
          <nav aria-label="Módulos" className="grid max-h-[60dvh] overflow-y-auto">
            {appNavigation.filter(item => (item.slug !== 'whatsapp' || whatsappEnabled) && (item.slug !== 'ads' || adsEnabled)).map(item => {
              const Icon = navIcons[item.slug];
              return <button key={item.slug} type="button" className="lume-menu-row" onClick={() => {
                if (item.slug === 'agents') { setOpen(false); controller.dispatch({ type: 'mode', mode: 'focused' }); }
                else go(`/app/${item.slug}`);
              }}><Icon className="size-4" aria-hidden="true" /><span>{item.label}</span>{navIsBeta(item) && <BetaLabel className="ml-auto" />}</button>;
            })}
            {platformAdmin && <button type="button" className="lume-menu-row" onClick={() => go(adminNavigation.href)}><ShieldCheck className="size-4" />{adminNavigation.label}</button>}
          </nav>
          <div className="mt-2 border-t pt-1"><TutorialTrigger onOpen={() => setOpen(false)} /></div>
        </PopoverContent>
      </Popover>
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <NotificationTrigger unread={unread} onOpen={element => { opener.current = element; setNotifications(true); }} />
        <Popover open={accountOpen} onOpenChange={setAccountOpen}>
          <PopoverTrigger asChild><button type="button" className="lume-icon" aria-label={`Conta de ${person.name}`}><Avatar name={person.name} src={person.avatarUrl} className="size-7" /></button></PopoverTrigger>
          <PopoverContent align="end" className="lume-menu w-72 p-2">
            <button type="button" className="lume-menu-row w-full" onClick={() => go(profileNavigation.href)}><span className="min-w-0 text-left"><span className="block truncate text-foreground">{person.name}</span><span className="text-xs text-muted-foreground">Meu perfil</span></span></button>
            <TutorialTrigger onOpen={() => setAccountOpen(false)} />
            <div className="flex items-center gap-1 border-y py-2">
              <FeedbackTrigger onOpen={element => { opener.current = element; setAccountOpen(false); setFeedback({ open: true, view: 'form' }); }} />
              <InstallApp /><ThemeSwitch />
            </div>
            <button type="button" className="lume-menu-row w-full" disabled={pending} onClick={() => void logout()}><LogOut className="size-4" />{pending ? 'Saindo…' : 'Sair'}</button>
            {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
          </PopoverContent>
        </Popover>
      </div>
    </header>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
      <AlertDialogDescription>Não foi possível salvar suas alterações. Se sair agora, os rascunhos não salvos serão descartados e sua conta sairá de todos os dispositivos.</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Continuar editando</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void logout(true)}>Sair sem salvar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <FeedbackDialog open={feedback.open} initialView={feedback.view} pathname={pathname} onOpenChange={next => setFeedback(value => ({ ...value, open: next }))} onCloseFocus={restoreFocus} />
    <NotificationPanel open={notifications} onOpenChange={setNotifications} onCloseFocus={restoreFocus} />
  </>;
}
