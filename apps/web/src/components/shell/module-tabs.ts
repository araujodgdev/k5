import { PLACES_PER_MODULE, resourceKey, type CanvasResource } from '@/lib/lume-workspace';
import { appNavigation, navIsBeta } from '@/lib/navigation';
import type { LauncherAccess } from './launcher';
import { HOME_HREF, placeOf, type PlaceIcon } from './places';

/**
 * The strip holds one tab per module. Everything a module opens (a case, a document, a view of
 * Escritório) shows inside that module's tab, which remembers the last place it showed.
 * Places outside the modules (Perfil, Plano, Tutorial, Administração…) share one extra tab at the end.
 */
export type ModuleTab = { id: string; root: string; title: string; icon: PlaceIcon; beta: boolean };

/** The id of the extra tab for places that belong to no module. */
export const EXTRA_TAB = 'extra';

const titles: Partial<Record<string, string>> = { 'command-center': 'Início', vault: 'Casos', calc: 'Cálculos' };

/** The Lume is the panel; Integrações and Plano are the office's settings and open in the extra tab. */
const outside = new Set(['agents', 'integrations', 'billing']);

export function moduleTabs({ whatsappEnabled, adsEnabled }: LauncherAccess): ModuleTab[] {
  return appNavigation
    .filter((item) => !outside.has(item.slug) && (item.slug !== 'whatsapp' || whatsappEnabled) && (item.slug !== 'ads' || adsEnabled))
    .map((item) => {
      const root = item.slug === 'command-center' ? HOME_HREF : `/app/${item.slug}`;
      return { id: moduleOf(root), root, title: titles[item.slug] ?? item.label, icon: placeOf(root).icon, beta: navIsBeta(item) };
    });
}

/**
 * Each module's places by resource key, most recent first: the first is what its tab shows. `seen`
 * holds the hrefs of the last pass, and `current` the place on screen.
 */
export type ModuleFollow = { recent: Readonly<Record<string, readonly string[]>>; seen: ReadonlyMap<string, string>; current: string | null };

export const initialFollow: ModuleFollow = { recent: {}, seen: new Map(), current: null };

/** The resource key each module tab shows. */
export function modulePlaces(follow: ModuleFollow): Record<string, string> {
  return Object.fromEntries(Object.entries(follow.recent).flatMap(([id, keys]) => keys.length ? [[id, keys[0]]] : []));
}

/**
 * Orders each module's places. A resource that newly opens, or moves to another address, comes first
 * in its module, and so does the one the person moves to. Beyond `PLACES_PER_MODULE`, the oldest
 * places are returned as `stale` to be closed; the one on screen waits until the person leaves it.
 */
export function followModules(previous: ModuleFollow, tabs: readonly CanvasResource[], current: CanvasResource | null) {
  const recent: Record<string, string[]> = Object.fromEntries(Object.entries(previous.recent).map(([id, keys]) => [id, [...keys]]));
  const bring = (id: string, key: string) => { recent[id] = [key, ...(recent[id] ?? []).filter((item) => item !== key)]; };
  const seen = new Map<string, string>();
  for (const tab of tabs) {
    const key = resourceKey(tab);
    seen.set(key, tab.href);
    if (previous.seen.get(key) !== tab.href) bring(moduleOf(tab.href), key);
  }
  const currentKey = current ? resourceKey(current) : null;
  if (current && currentKey !== previous.current) bring(moduleOf(current.href), currentKey!);
  for (const id of Object.keys(recent)) recent[id] = recent[id].filter((key) => seen.has(key) || key === currentKey);
  const stale = tabs.filter((tab) => {
    const key = resourceKey(tab);
    return key !== currentKey && (recent[moduleOf(tab.href)] ?? []).indexOf(key) >= PLACES_PER_MODULE;
  });
  for (const id of Object.keys(recent)) recent[id] = recent[id].filter((key, index) => index < PLACES_PER_MODULE || key === currentKey);
  return { follow: { recent, seen, current: currentKey } satisfies ModuleFollow, stale };
}

/** The module tab a route shows in. Cases, Cofre files and documents belong to Casos. */
export function moduleOf(href: string): string {
  const url = new URL(href, 'http://lume.invalid');
  const section = url.pathname.split('/')[2] ?? '';
  if (!section || section === 'command-center') return 'inicio';
  if (section === 'documents') return 'vault';
  return appNavigation.some((item) => item.slug === section && !outside.has(item.slug)) ? section : EXTRA_TAB;
}
