import { Activity, Calculator, Calendar, CircleHelp, CircleUser, CreditCard, File, FileText, Folder, House, Layers, Library, Mail, MailOpen, Megaphone, MessageCircle, MessageSquare, Plug, Scale, Shield, SquareCheck, UserPlus, Users, Wallet } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { adminNavigation, appNavigation, officeSections, profileNavigation, tutorialNavigation } from '@/lib/navigation';
import type { CanvasSubject } from './shell-context';

export type PlaceIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Where a route sits in the canvas: the tab it opens in, its default name and icon, and its subject. */
export type CanvasPlace = { tab: string; title: string; icon: PlaceIcon; subject: CanvasSubject };

export const HOME_HREF = '/app/command-center';

const label = (slug: string) => appNavigation.find((item) => item.slug === slug)?.label ?? 'Página';

const sections: Record<string, { title: string; icon: PlaceIcon }> = {
  vault: { title: 'Casos', icon: Layers },
  research: { title: label('research'), icon: Scale },
  honorarios: { title: label('honorarios'), icon: Wallet },
  calc: { title: 'Cálculos', icon: Calculator },
  email: { title: label('email'), icon: Mail },
  messages: { title: label('messages'), icon: MessageSquare },
  whatsapp: { title: label('whatsapp'), icon: MessageCircle },
  ads: { title: label('ads'), icon: Megaphone },
  integrations: { title: label('integrations'), icon: Plug },
  billing: { title: label('billing'), icon: CreditCard },
  profile: { title: profileNavigation.label, icon: CircleUser },
  tutorial: { title: tutorialNavigation.label, icon: CircleHelp },
  admin: { title: adminNavigation.label, icon: Shield },
};

const officeIcons: Record<(typeof officeSections)[number]['slug'], PlaceIcon> = {
  tasks: SquareCheck, calendar: Calendar, clients: Users, associates: UserPlus, invites: MailOpen, activity: Activity,
};

function officePlace(rest: string[], search: URLSearchParams): Omit<CanvasPlace, 'tab' | 'subject'> {
  if (rest[0] === 'clients' && rest[1]) return { title: 'Cliente', icon: Users };
  if (rest[0] === 'tasks' && rest[1]) return { title: 'Tarefa', icon: SquareCheck };
  const view = officeSections.find((section) => section.slug === search.get('view')) ?? officeSections[0];
  return { title: view.label, icon: officeIcons[view.slug] };
}

const modulePlace = (tab: string, title: string, icon: PlaceIcon): CanvasPlace => ({ tab, title, icon, subject: { kind: 'module', slug: tab, title } });

/**
 * The canvas opens one tab per case, document and module. Moving inside one of them (a view of
 * Escritório, a section of Administração) stays in its tab.
 */
export function placeOf(href: string): CanvasPlace {
  const url = new URL(href, 'http://lume.invalid');
  const [section = '', ...rest] = url.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean);
  if (!section || section === 'command-center') return { tab: 'inicio', title: 'Início', icon: House, subject: { kind: 'office' } };
  if (section === 'vault' && rest[0] === 'cases' && rest[1]) {
    return { tab: `case:${rest[1]}`, title: 'Caso', icon: Folder, subject: { kind: 'case', caseId: rest[1], title: 'Caso' } };
  }
  if (section === 'vault' && rest[0] === 'library') return modulePlace('vault:library', 'Biblioteca', Library);
  if (section === 'documents' && rest[0]) {
    return { tab: `document:${rest[0]}`, title: 'Documento', icon: FileText, subject: { kind: 'document', documentId: rest[0], title: 'Documento' } };
  }
  if (section === 'agenda') {
    const place = officePlace(rest, url.searchParams);
    return modulePlace('agenda', place.title, place.icon);
  }
  const known = sections[section];
  return known ? modulePlace(section, known.title, known.icon) : modulePlace(section, 'Página', File);
}

/** The Lume's own route belongs to the panel: with the canvas shell it never opens a canvas tab. */
export function isPanelRoute(href: string) {
  return /^\/app\/agents(\/|$)/.test(pathnameOf(href));
}

/** The route without its query, for comparing what a view described with where a tab is now. */
export function pathnameOf(href: string) {
  return new URL(href, 'http://lume.invalid').pathname;
}
