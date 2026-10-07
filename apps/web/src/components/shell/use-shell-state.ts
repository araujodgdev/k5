'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useDocumentDrafts } from '@/components/document/document-drafts-provider';
import { readPanel, subscribePanel, writePanel } from '@/lib/canvas-shell/panel';
import { initialTabs, neighbourOf, parseStoredTabs, subjectOf, tabOf, tabsReducer, tabsStorageKey, titleOf, visibleTabs, type CanvasTab } from './canvas-tabs';
import { placeOf } from './places';
import type { CanvasSubject, LumeActivity, OpenedBy, PanelState, Shell } from './shell-context';

const DESKTOP = '(min-width: 768px)';
const isPhone = () => !window.matchMedia(DESKTOP).matches;

/** Focus follows the stage: the composer when the Lume opens, the mark or the canvas when it steps aside. */
function focusStage(state: PanelState) {
  requestAnimationFrame(() => {
    if (state === 'open') {
      const panel = document.getElementById('lume-panel');
      (panel?.querySelector<HTMLElement>('textarea') ?? panel)?.focus();
      return;
    }
    const mark = document.getElementById('lume-shell-mark');
    if (mark && mark.offsetParent) mark.focus();
    else document.getElementById('main-content')?.focus();
  });
}

export type ShellState = {
  shell: Shell;
  tabs: readonly CanvasTab[];
  active: string;
  /** Goes to a tab's address without adding anything. */
  go(tab: CanvasTab): void;
  close(tab: CanvasTab): void;
};

export function useShellState(userId: string, officeId: string): ShellState {
  const pathname = usePathname();
  const search = useSearchParams();
  const href = search.size ? `${pathname}?${search}` : pathname;
  const router = useRouter();
  const { hasOpenDraft, saveOpen } = useDocumentDrafts();
  const [state, dispatch] = useReducer(tabsReducer, initialTabs);
  const [activity, setActivity] = useState<LumeActivity>({ state: 'idle' });
  const panel = useSyncExternalStore(subscribePanel, readPanel, () => 'open' as const);
  const storageKey = tabsStorageKey(userId, officeId);
  const current = useRef(href);

  useEffect(() => {
    current.current = href;
    dispatch({ type: 'arrive', href });
  }, [href]);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* Tabs start fresh without storage. */ }
    dispatch({ type: 'restore', tabs: parseStoredTabs(saved) });
  }, [storageKey]);

  useEffect(() => {
    if (!state.restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state.tabs)); } catch { /* Works without persistence. */ }
  }, [state.tabs, state.restored, storageKey]);

  // An open document saves before the canvas leaves it; if it cannot, the canvas stays.
  const navigate = useCallback((target: string) => {
    if (!hasOpenDraft()) { router.push(target); return; }
    void saveOpen().then((saved) => {
      if (saved) router.push(target);
      else dispatch({ type: 'arrive', href: current.current });
    });
  }, [hasOpenDraft, saveOpen, router]);

  const setPanel = useCallback((next: PanelState) => {
    writePanel(next);
    focusStage(next);
  }, []);

  const open = useCallback((target: string, title?: string, by: OpenedBy = 'person') => {
    dispatch({ type: 'go', href: target, title });
    if (by === 'person' && isPhone()) writePanel('collapsed');
    navigate(target);
  }, [navigate]);

  const describe = useCallback((target: string, title: string, subject: CanvasSubject) => {
    dispatch({ type: 'describe', href: target, title, subject });
  }, []);

  const tabs = visibleTabs(state, href);
  const active = state.pending ?? placeOf(href).tab;
  const activeTab = tabs.find((tab) => tabOf(tab) === active) ?? tabs[0];
  const subject = subjectOf(activeTab);
  const subjectKey = JSON.stringify(subject);
  const placesKey = JSON.stringify(tabs.map((tab) => ({ href: tab.href, title: titleOf(tab) })));

  const shell = useMemo<Shell>(() => ({
    subject: JSON.parse(subjectKey) as CanvasSubject,
    places: JSON.parse(placesKey) as Shell['places'],
    open, describe, panel, setPanel, activity, setActivity,
  }), [subjectKey, placesKey, open, describe, panel, setPanel, activity]);

  const go = useCallback((tab: CanvasTab) => {
    dispatch({ type: 'go', href: tab.href });
    navigate(tab.href);
  }, [navigate]);

  const close = useCallback((tab: CanvasTab) => {
    const id = tabOf(tab);
    if (id === active) {
      const next = neighbourOf(tabs, id);
      dispatch({ type: 'go', href: next.href });
      navigate(next.href);
    }
    dispatch({ type: 'close', tab: id });
  }, [active, tabs, navigate]);

  return { shell, tabs, active, go, close };
}
