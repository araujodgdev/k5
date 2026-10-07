'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { requestCapability } from '@/lib/capabilities/http-client';
import { adminNavigation, appNavigation, navIsBeta, officeSections, profileNavigation } from '@/lib/navigation';
import { placeOf, type PlaceIcon } from './places';

export type ModuleFlags = { whatsappEnabled: boolean; adsEnabled: boolean };
export type ShellEntry = { href: string; label: string; icon: PlaceIcon; beta: boolean };

const entry = (href: string, beta = false): ShellEntry => {
  const place = placeOf(href);
  return { href, label: place.title, icon: place.icon, beta };
};

/** Escritório opens straight on its three main views, as the prototype lists Agenda, Tarefas and Clientes. */
const ESCRITORIO_VIEWS = officeSections.slice(0, 3);

/**
 * The office's modules in the order of the navigation definitions. The Lume itself is the panel, so it
 * is not a canvas module.
 */
export function moduleEntries({ whatsappEnabled, adsEnabled }: ModuleFlags): ShellEntry[] {
  return appNavigation
    .filter((item) => item.slug !== 'agents' && (item.slug !== 'whatsapp' || whatsappEnabled) && (item.slug !== 'ads' || adsEnabled))
    .flatMap((item) => item.slug === 'agenda'
      ? ESCRITORIO_VIEWS.map((view) => entry(`/app/agenda?view=${view.slug}`))
      : [entry(`/app/${item.slug}`, navIsBeta(item))]);
}

export const profileEntry = entry(profileNavigation.href);
export const adminEntry = entry(adminNavigation.href);

export type CaseSummary = { id: string; name: string };
export type CasesState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; cases: CaseSummary[] };

/** The office's cases, newest first, loaded when a menu that lists them opens. */
export function useOfficeCases(active: boolean): CasesState {
  const [state, setState] = useState<CasesState>({ status: 'idle' });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState((current) => current.status === 'ready' ? current : { status: 'loading' });
      void requestCapability('k5_vault_list_cases', {}).then((response) => {
        if (cancelled) return;
        if (!response.ok) { setState((current) => current.status === 'ready' ? current : { status: 'error' }); return; }
        const { cases } = response.data as { cases: CaseSummary[] };
        setState({ status: 'ready', cases: cases.map(({ id, name }) => ({ id, name })) });
      });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active]);
  return state;
}

/** A plain click opens the place in the canvas; a modified click keeps the browser's own behavior. */
export function opensInCanvas(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export const caseHref = (id: string) => `/app/vault/cases/${encodeURIComponent(id)}`;
