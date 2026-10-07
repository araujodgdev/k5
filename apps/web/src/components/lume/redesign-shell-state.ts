'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useLumeState, useLumeWorkspace } from './workspace-context';
import { resourceKey, type CanvasResource } from '@/lib/lume-workspace';
import type { CanvasSubject, LumeActivity, Shell } from '@/components/shell/shell-context';
import type { CanvasTab } from '@/components/shell/canvas-tabs';
export type ShellState = { shell: Shell; tabs: readonly CanvasTab[]; active: string; go(tab: CanvasTab): void; close(tab: CanvasTab): void };

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
export function useRedesignShellState(): ShellState {
  const { controller, navigate, openResource } = useLumeWorkspace();
  const state = useLumeState();
  const isMobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const [activity, setActivity] = useState<LumeActivity>({ state: 'idle' });
  const tabs = useMemo<CanvasTab[]>(() => {
    const home = state.tabs.find(resource => resource.href === '/app/command-center');
    const ordered = home ? [home, ...state.tabs.filter(resource => resource !== home)] : [{ kind: 'module' as const, slug: 'command-center' as const, href: '/app/command-center', title: 'Início' }, ...state.tabs];
    return ordered.map(resource => ({ href: resource.href, key: resource.href === '/app/command-center' ? 'inicio' : resourceKey(resource), described: { pathname: new URL(resource.href, 'https://lume.invalid').pathname, title: resource.title, subject: resourceSubject(resource) } }));
  }, [state.tabs]);
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
  const go = useCallback((tab: CanvasTab) => { void openResource(tab.href); }, [openResource]);
  const close = useCallback((tab: CanvasTab) => {
    const resource = controller.getSnapshot().tabs.find(item => item.href === tab.href);
    if (!resource || resource.href === '/app/command-center') return;
    const finish = async () => {
      const current = controller.getSnapshot();
      if (current.href === resource.href) {
        const index = current.tabs.indexOf(resource);
        const next = current.tabs[index + 1] ?? current.tabs[index - 1];
        if (!await navigate(next?.href ?? '/app/command-center')) return;
      }
      controller.dispatch({ type: 'close', key: resourceKey(resource) });
    };
    void finish();
  }, [controller, navigate]);
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
    subject, places: tabs.map(tab => ({ href: tab.href, title: tab.described!.title })),
    open, describe, panel: state.mode === 'collapsed' || state.mobile === 'canvas' && isMobile ? 'collapsed' : 'open',
    setPanel, activity, setActivity,
  }), [subject, tabs, open, describe, state.mode, state.mobile, isMobile, setPanel, activity]);
  return { shell, tabs, active: state.href === '/app/command-center' ? 'inicio' : state.resource ? resourceKey(state.resource) : state.href, go, close };
}
