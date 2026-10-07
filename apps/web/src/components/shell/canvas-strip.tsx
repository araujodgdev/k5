'use client';

import { Bell, Moon, Search, Sun, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { LiveLumeMark } from '@/components/live-lume-mark';
import { useThemeToggle } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { tabOf, titleOf, type CanvasTab } from './canvas-tabs';
import { Launcher, type LauncherAccess } from './launcher';
import { opensInCanvas } from './modules';
import { placeOf } from './places';
import { useShell, type LumeActivity } from './shell-context';

/** The strip's 32px icon buttons: quiet until hovered. */
export const stripButton = 'relative grid size-8 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A tab shows the Lume's mark while the Lume works on what it holds: the case of the conversation, or
 * the place it touched last. A case also keeps the mark while the Lume waits on the person there.
 */
function markFor(tab: CanvasTab, activity: LumeActivity) {
  if (activity.state === 'idle') return null;
  const id = tabOf(tab);
  return id === activity.place || (activity.caseId && id.startsWith(`case:${activity.caseId}:`)) ? activity.state : null;
}

function Tab({ tab, active, activity, onGo, onClose }: { tab: CanvasTab; active: boolean; activity: LumeActivity; onGo(tab: CanvasTab): void; onClose(tab: CanvasTab): void }) {
  const id = tabOf(tab);
  const title = titleOf(tab);
  const Icon = placeOf(tab.href).icon;
  const mark = markFor(tab, activity);
  const home = id === 'inicio';
  return (
    // The other tabs give up width first, down to a few letters of their title; the open one keeps a readable title.
    <div className={cn('flex h-8 items-center rounded-md transition-colors',
      home ? 'max-w-[110px] flex-none' : active ? 'max-w-[230px] min-w-[7.5rem] shrink-0' : 'max-w-[230px] min-w-[5.5rem] shrink',
      active ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-accent')}>
      <a href={tab.href} aria-current={active ? 'page' : undefined} title={title}
        onClick={(event) => { if (!opensInCanvas(event)) return; event.preventDefault(); onGo(tab); }}
        className={cn('flex h-8 min-w-0 items-center gap-[7px] rounded-md pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', home ? 'pr-2.5' : 'pr-1')}>
        {mark ? <LiveLumeMark state={mark} className="size-3.5 shrink-0" />
          : <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="truncate text-[13px] font-medium">{title}</span>
      </a>
      {!home && (
        <button type="button" aria-label={`Fechar aba ${title}`} onClick={() => onClose(tab)}
          className="mr-1 grid size-[22px] shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export type StripProps = {
  access: LauncherAccess;
  tabs: readonly CanvasTab[];
  active: string;
  unread: number;
  onGo(tab: CanvasTab): void;
  onClose(tab: CanvasTab): void;
  onSearch(): void;
  onNotifications(opener: HTMLElement): void;
  account: React.ReactNode;
};

/** The canvas's top strip (Main.dc.html, around line 222): launcher, open tabs, search, bell, theme and account. */
export function CanvasStrip({ access, tabs, active, unread, onGo, onClose, onSearch, onNotifications, account }: StripProps) {
  const shell = useShell();
  const theme = useThemeToggle();
  const activity = shell?.activity ?? { state: 'idle' };
  const bellLabel = unread > 0 ? `Notificações, ${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : 'Notificações';
  const [home, ...others] = tabs;
  const scroller = useRef<HTMLDivElement>(null);
  // Restored tabs arrive after the open one, so it is brought back into view whenever the tabs change.
  useEffect(() => { scroller.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tabs, active]);
  const tabFor = (tab: CanvasTab) => <Tab key={tabOf(tab)} tab={tab} active={tabOf(tab) === active} activity={activity} onGo={onGo} onClose={onClose} />;
  return (
    <div className="lume-toolbar relative z-[3] hidden h-[52px] flex-none items-center gap-1 border-b border-border pr-3 pl-3 md:flex">
      <Launcher access={access} />
      <span aria-hidden="true" className="mx-1.5 h-[18px] w-px flex-none bg-border-strong" />
      <nav aria-label="Abas do canvas" className="flex min-w-0 items-center gap-0.5">
        {home && tabFor(home)}
        {/* Início stays put; the other tabs scroll when they outgrow the strip. */}
        <div ref={scroller} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {others.map(tabFor)}
        </div>
      </nav>
      <span className="min-w-2 flex-1" />
      <button type="button" onClick={onSearch} aria-keyshortcuts="Control+K"
        className="flex h-8 flex-none items-center gap-2 rounded-md border border-border pr-1.5 pl-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Search className="size-3.5" aria-hidden="true" />Buscar
        <kbd className="rounded-[4px] bg-muted px-[5px] py-px font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <button type="button" aria-label={bellLabel} title={bellLabel} onClick={(event) => onNotifications(event.currentTarget)} className={stripButton}>
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && <span aria-hidden="true" className="absolute top-[7px] right-2 size-1.5 rounded-full bg-brand" />}
      </button>
      <button type="button" aria-label={theme.label} title={theme.label} disabled={!theme.mounted} onClick={theme.toggle} className={stripButton}>
        {theme.dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
      </button>
      {account}
    </div>
  );
}
