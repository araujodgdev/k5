import { z } from 'zod';
import { canvasSubjectSchema } from '@/lib/canvas-protocol';
import { HOME_HREF, isPanelRoute, pathnameOf, placeOf } from './places';
import type { CanvasSubject } from './shell-context';

/** What a view said about itself, valid while its tab still shows the same page. */
type Description = { pathname: string; title: string; subject: CanvasSubject };

/** A canvas tab is a place (see placeOf) and the address it last showed. */
export type CanvasTab = { href: string; described?: Description };

export type TabsState = {
  /** Início first; it is never closed. */
  tabs: readonly CanvasTab[];
  /** The tab a navigation is heading to, shown as active until its route arrives. */
  pending: string | null;
  /** The address the canvas showed last; null before the first route arrives. */
  arrived: string | null;
  /** The saved tabs were read; until then nothing is written over them. */
  restored: boolean;
};

export type TabsAction =
  | { type: 'restore'; tabs: readonly CanvasTab[] }
  | { type: 'arrive'; href: string }
  | { type: 'go'; href: string; title?: string }
  | { type: 'close'; tab: string }
  | { type: 'describe'; href: string; title: string; subject: CanvasSubject };

/** Beyond this many, opening a tab drops the oldest one that is not Início. */
export const MAX_TABS = 8;

const home: CanvasTab = { href: HOME_HREF };

export const initialTabs: TabsState = { tabs: [home], pending: null, arrived: null, restored: false };

export const tabOf = (tab: CanvasTab) => placeOf(tab.href).tab;

export function titleOf(tab: CanvasTab) {
  const described = tab.described?.pathname === pathnameOf(tab.href) ? tab.described : undefined;
  return described?.title ?? placeOf(tab.href).title;
}

export function subjectOf(tab: CanvasTab): CanvasSubject {
  const described = tab.described?.pathname === pathnameOf(tab.href) ? tab.described : undefined;
  return described?.subject ?? placeOf(tab.href).subject;
}

/** Points the tab for `href` at it, adding the tab when the place is new. */
function visit(tabs: readonly CanvasTab[], href: string): readonly CanvasTab[] {
  if (isPanelRoute(href)) return tabs;
  const tab = placeOf(href).tab;
  const index = tabs.findIndex((item) => tabOf(item) === tab);
  if (index >= 0) return tabs[index].href === href ? tabs : tabs.with(index, { ...tabs[index], href });
  return append(tabs, { href });
}

/** Adds a tab at the end, dropping the oldest one that is not Início beyond the limit. */
function append(tabs: readonly CanvasTab[], tab: CanvasTab): readonly CanvasTab[] {
  const added = [...tabs, tab];
  return added.length > MAX_TABS ? [added[0], ...added.slice(2)] : added;
}

/**
 * A view may describe itself before its route arrives (its effect runs before the shell's on a direct
 * load), so a description for a place with no tab yet opens that tab with it.
 */
function describe(tabs: readonly CanvasTab[], href: string, title: string, subject: CanvasSubject) {
  if (isPanelRoute(href)) return tabs;
  const described = { pathname: pathnameOf(href), title, subject };
  const index = tabs.findIndex((item) => tabOf(item) === placeOf(href).tab);
  if (index < 0) return append(tabs, { href, described });
  return tabs.with(index, { ...tabs[index], described });
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'restore': {
      // Saved tabs come first, in their order, behind Início; the tab the person landed on keeps its place at the end.
      const saved = action.tabs.filter((tab) => tabOf(tab) !== 'inicio' && !isPanelRoute(tab.href));
      const merged = [home, ...saved.map((tab) => state.tabs.find((item) => tabOf(item) === tabOf(tab)) ?? tab)];
      const current = state.tabs.filter((tab) => !merged.some((item) => tabOf(item) === tabOf(tab)));
      return { ...state, tabs: [...merged, ...current].slice(-MAX_TABS).with(0, merged[0]), restored: true };
    }
    case 'arrive':
      return { ...state, tabs: visit(state.tabs, action.href), pending: null, arrived: action.href };
    case 'go': {
      const tabs = visit(state.tabs, action.href);
      const described = action.title ? describe(tabs, action.href, action.title, { ...placeOf(action.href).subject, title: action.title } as CanvasSubject) : tabs;
      return { ...state, tabs: described, pending: action.href === state.arrived ? null : placeOf(action.href).tab };
    }
    case 'close':
      return action.tab === 'inicio' ? state : { ...state, tabs: state.tabs.filter((tab) => tabOf(tab) !== action.tab) };
    case 'describe':
      return { ...state, tabs: describe(state.tabs, action.href, action.title, action.subject) };
  }
}

/** The tabs as drawn: while no navigation is pending, the route on screen always has its tab. */
export function visibleTabs(state: TabsState, href: string) {
  return state.pending ? state.tabs : visit(state.tabs, href);
}

/** The tab to show after closing `tab`: the one before it. */
export function neighbourOf(tabs: readonly CanvasTab[], tab: string): CanvasTab {
  const index = tabs.findIndex((item) => tabOf(item) === tab);
  return tabs[Math.max(0, index - 1)] ?? home;
}

const storedTabs = z.array(z.object({
  href: z.string().max(2048).refine((href) => /^\/app(\/|$)/.test(href) && !href.startsWith('//')),
  described: z.object({ pathname: z.string().max(2048), title: z.string().max(300), subject: canvasSubjectSchema }).optional(),
})).max(MAX_TABS * 2);

/** Saved tabs from another visit; anything malformed is dropped rather than trusted. */
export function parseStoredTabs(value: string | null): CanvasTab[] {
  if (!value) return [];
  try {
    const parsed = storedTabs.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data.filter((tab) => !isPanelRoute(tab.href)) : [];
  } catch { return []; }
}

export const tabsStorageKey = (userId: string, officeId: string) => `lume:canvas-tabs:v1:${userId}:${officeId}`;
