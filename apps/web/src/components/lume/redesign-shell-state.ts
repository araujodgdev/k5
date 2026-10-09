'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDocumentDrafts } from '@/components/document/document-drafts-provider';
import { useLumeState, useLumeWorkspace } from './workspace-context';
import { resourceKey, type CanvasResource } from '@/lib/lume-workspace';
import type { CanvasSubject, LumeActivity, Shell } from '@/components/shell/shell-context';
import type { LauncherAccess } from '@/components/shell/launcher';
import { EXTRA_TAB, followModules, initialFollow, moduleOf, modulePlaces, moduleTabs, type ModuleTab } from '@/components/shell/module-tabs';
import { HOME_HREF, placeOf } from '@/components/shell/places';

/** A module's tab as drawn: where it leads now, and what it shows there. */
export type StripTab = ModuleTab & { href: string; place: string; closable: boolean; mark: 'working' | 'attention' | null };
export type ShellState = { shell: Shell; tabs: readonly StripTab[]; active: string; go(tab: StripTab): void; close(tab: StripTab): void };

export function resourceSubject(resource: CanvasResource | null): CanvasSubject {
  if (!resource || resource.kind === 'module' && resource.slug === 'command-center') return { kind: 'office' };
  if (resource.kind === 'case') return { kind: 'case', caseId: resource.caseId, title: resource.title };
  if (resource.kind === 'document') return { kind: 'document', documentId: resource.document.id, title: resource.title };
  if (resource.kind === 'file' && resource.caseId) return { kind: 'case', caseId: resource.caseId, title: resource.title };
  return { kind: 'module', slug: resource.kind === 'module' ? resource.slug : 'vault', title: resource.title };
}

const subscribeMobile = (listener: () => void) => {
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
export function useRedesignShellState(access: LauncherAccess): ShellState {
  const { saveOpen, drafts } = useDocumentDrafts();
  const { controller, navigate, openResource } = useLumeWorkspace();
  const state = useLumeState();
  const isMobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const [activity, setActivity] = useState<LumeActivity>({ state: 'idle' });
  const [follow, setFollow] = useState(initialFollow);
  const followed = useRef(initialFollow);
  // Each module keeps its few latest places mounted. Closing older ones also drops their canvases.
  useLayoutEffect(() => {
    const { follow: next, stale } = followModules(followed.current, state.tabs, state.resource);
    followed.current = next;
    setFollow(next);
    for (const resource of stale) controller.dispatch({ type: 'close', key: resourceKey(resource) });
  }, [controller, state.tabs, state.resource]);
  const active = moduleOf(state.href);
  // Closing the extra tab returns to the module the person came from.
  const lastModule = useRef('inicio');
  useLayoutEffect(() => { if (active !== EXTRA_TAB) lastModule.current = active; }, [active]);

  const tabs = useMemo<StripTab[]>(() => {
    const places = modulePlaces(follow);
    const placed = (id: string) => {
      const key = places[id];
      return state.tabs.find(resource => resourceKey(resource) === key) ?? (state.resource && resourceKey(state.resource) === key ? state.resource : null);
    };
    // A module's tab shows the live mark while the Lume works on a place it holds, or in the conversation's case.
    const touched = activity.state === 'idle' ? null : state.tabs.find(resource => resourceKey(resource) === activity.place);
    const markOf = (id: string) => activity.state !== 'idle' && (touched && moduleOf(touched.href) === id || activity.caseId && id === 'vault') ? activity.state : null;
    const modules = moduleTabs(access).map(tab => {
      const resource = placed(tab.id);
      return { ...tab, href: resource?.href ?? tab.root, place: resource?.title ?? tab.title, closable: false, mark: markOf(tab.id) };
    });
    const extra = placed(EXTRA_TAB) ?? (active === EXTRA_TAB ? state.resource : null);
    if (!extra) return modules;
    const place = placeOf(extra.href);
    return [...modules, { id: EXTRA_TAB, root: extra.href, href: extra.href, title: extra.title, place: extra.title, icon: place.icon, beta: false, closable: true, mark: markOf(EXTRA_TAB) }];
  }, [access, active, activity, follow, state.resource, state.tabs]);

  const setPanel = useCallback<Shell['setPanel']>(next => {
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    controller.dispatch({ type: 'mode', mode: mobile ? 'floating' : next === 'open' ? 'floating' : 'collapsed' });
    controller.dispatch({ type: 'mobile', mobile: next === 'open' ? 'chat' : 'canvas' });
    requestAnimationFrame(() => {
      const target = next === 'open' ? document.querySelector<HTMLElement>('#lume-panel textarea') ?? document.getElementById('lume-panel') : document.getElementById('main-content');
      target?.focus();
    });
  }, [controller]);
  const open = useCallback<Shell['open']>((href, _title, by = 'person') => {
    if (by === 'person' && !controller.getSnapshot().tabs.some(tab => tab.href === href)) { void navigate(href); return; }
    void openResource(href);
  }, [controller, navigate, openResource]);
  // A tab leads to the place it holds. Once there, it leads back to its module's start: from a case to Casos.
  const go = useCallback((tab: StripTab) => {
    const here = controller.getSnapshot().href;
    void navigate(tab.id !== EXTRA_TAB && here === tab.href && here !== tab.root ? tab.root : tab.href);
  }, [controller, navigate]);
  // Closing the extra tab closes every place it holds, not only the one it shows.
  const close = useCallback((tab: StripTab) => {
    if (tab.id !== EXTRA_TAB) return;
    const back = tabs.find(item => item.id === lastModule.current)?.href ?? HOME_HREF;
    const finish = async () => {
      if (!await saveOpen() || drafts.hasUnsaved()) return;
      if (moduleOf(controller.getSnapshot().href) === EXTRA_TAB && !await navigate(back)) return;
      for (const resource of controller.getSnapshot().tabs) if (moduleOf(resource.href) === EXTRA_TAB) controller.dispatch({ type: 'close', key: resourceKey(resource) });
    };
    void finish();
  }, [controller, navigate, saveOpen, drafts, tabs]);
  const describe = useCallback<Shell['describe']>((href, title, subject) => {
    const resource = state.resource;
    if (!resource || resource.kind !== 'module' || subject.kind !== 'module' || subject.slug !== resource.slug
      || controller.getSnapshot().resource !== resource
      || new URL(resource.href, 'https://lume.invalid').pathname !== new URL(href, 'https://lume.invalid').pathname) return;
    const label = title.trim().slice(0, 200);
    if (label && label !== resource.title) controller.dispatch({ type: 'authorized', resource: { ...resource, title: label } });
  }, [controller, state.resource]);
  const subject = useMemo(() => resourceSubject(state.resource), [state.resource]);
  const shell = useMemo<Shell>(() => ({
    subject, places: tabs.map(tab => ({ href: tab.href, title: tab.place })),
    open, describe, panel: state.mode === 'collapsed' || state.mobile === 'canvas' && isMobile ? 'collapsed' : 'open',
    setPanel, activity, setActivity,
  }), [subject, tabs, open, describe, state.mode, state.mobile, isMobile, setPanel, activity]);
  return { shell, tabs, active, go, close };
}
