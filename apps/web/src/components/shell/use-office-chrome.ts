'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSaveDocumentsBeforeExit } from '@/components/document/document-drafts-provider';
import { authClient } from '@/lib/auth-client';

const UNREAD_POLL_MS = 60_000;

/** Refreshes the session cookie on navigation, without a timer extending idle sessions. */
export function useSessionWatch() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let mounted = true;
    authClient.getSession().then(({ data, error }) => {
      if (mounted && !error && !data) {
        window.dispatchEvent(new Event('lume:session-ended'));
        router.replace('/sign-in');
        router.refresh();
      }
    }).catch(() => { /* A transient network error does not end a valid session. */ });
    return () => { mounted = false; };
  }, [pathname, router]);
}

/** The unread count the bell shows; other tabs and the service worker ask it to refresh. */
export function useUnreadNotifications() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let mounted = true;
    let generation = 0;
    let pending: AbortController | undefined;
    const load = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const current = ++generation;
      pending?.abort(); pending = new AbortController();
      void fetch('/api/notifications/count', { cache: 'no-store', signal: pending.signal }).then(async (response) => {
        if (!response.ok || !mounted || current !== generation) return;
        const value = await response.json() as { unread?: number };
        if (mounted && current === generation) setUnread(Math.max(0, Number(value.unread ?? 0)));
      }).catch(() => {});
    };
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'K5_NOTIFICATION') load(); };
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('k5-notifications') : null;
    channel?.addEventListener('message', load);
    load();
    const timer = window.setInterval(load, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('online', load);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      mounted = false;
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('online', load);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      channel?.close();
    };
  }, [pathname]);
  return unread;
}

/**
 * Old links and notifications arrive with a query flag (?notificacoes=1, ?feedback=relatos) that
 * opens a panel; the flag is removed from the address once handled.
 */
export function useQueryOpener(param: string, value: string, onOpen: () => void) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get(param) === value;
  const [handled, setHandled] = useState(false);
  if (requested !== handled) {
    setHandled(requested);
    if (requested) onOpen();
  }
  useEffect(() => {
    if (!requested) return;
    const rest = new URLSearchParams(searchParams);
    rest.delete(param);
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [requested, searchParams, pathname, router, param]);
}

/** Signs out everywhere, saving open documents first; a failed save asks before discarding. */
export function useLogout() {
  const router = useRouter();
  const saveDocumentsBeforeExit = useSaveDocumentsBeforeExit();
  const [pending, setPending] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState('');

  async function logout(discard = false) {
    if (pending) return;
    setPending(true);
    setError('');
    if (!discard && !await saveDocumentsBeforeExit()) { setPending(false); setConfirmDiscard(true); return; }
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('logout');
      window.dispatchEvent(new Event('lume:session-ended'));
      router.replace('/sign-in');
      router.refresh();
    } catch {
      setError('Não foi possível sair. Tente novamente.');
      setPending(false);
    }
  }

  return { logout, pending, error, confirmDiscard, setConfirmDiscard };
}
