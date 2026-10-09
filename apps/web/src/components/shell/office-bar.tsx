'use client';

import { Bell, Moon, PanelLeftClose, Search, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { BetaLabel } from '@/components/ads/beta-label';
import { LiveLumeMark } from '@/components/live-lume-mark';
import { useThemeToggle } from '@/components/theme-provider';
import type { StripTab } from '@/components/lume/redesign-shell-state';
import { cn } from '@/lib/utils';
import { Launcher, type LauncherAccess } from './launcher';
import { opensInCanvas } from './modules';
import type { LumeActivity, PanelState } from './shell-context';

/** The bar's 32px icon buttons: quiet until hovered. */
export const stripButton = 'relative grid size-8 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

const markState = { idle: 'idle', working: 'working', attention: 'attention' } as const;

function Tab({ tab, active, onGo, onClose }: { tab: StripTab; active: boolean; onGo(tab: StripTab): void; onClose(tab: StripTab): void }) {
  const Icon = tab.icon;
  // The tab names its module; the place it holds (a case, a document) is in the tooltip.
  const title = tab.place !== tab.title ? `${tab.title}: ${tab.place}` : tab.title;
  return (
    <div data-tab={tab.id} className={cn('flex h-8 shrink-0 items-center rounded-md transition-colors',
      active ? 'bg-selected text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
      <a href={tab.href} aria-current={active ? 'page' : undefined} title={title}
        onClick={(event) => { if (!opensInCanvas(event)) return; event.preventDefault(); onGo(tab); }}
        className={cn('flex h-8 min-w-0 items-center gap-[7px] rounded-md pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', tab.closable ? 'pr-1' : 'pr-2.5')}>
        {tab.mark ? <LiveLumeMark state={tab.mark} className="size-3.5 shrink-0" />
          : <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="max-w-[180px] truncate text-[13px] font-medium">{tab.title}</span>
        {tab.beta && <BetaLabel />}
      </a>
      {tab.closable && (
        <button type="button" aria-label={`Fechar aba ${tab.title}`} onClick={() => onClose(tab)}
          className="mr-1 grid size-[22px] shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export type OfficeBarProps = {
  access: LauncherAccess;
  tabs: readonly StripTab[];
  active: string;
  unread: number;
  panel: PanelState;
  activity: LumeActivity;
  onPanel(next: PanelState): void;
  onGo(tab: StripTab): void;
  onClose(tab: StripTab): void;
  onSearch(): void;
  onNotifications(opener: HTMLElement): void;
  account: React.ReactNode;
  /** The Lume's side of the bar, as wide as the panel; the panel animation resizes it. */
  lumeRef: Ref<HTMLDivElement>;
  /** The button the panel folds into. */
  toggleRef: Ref<HTMLButtonElement>;
};

/**
 * The office bar runs across the top of the computer layout. Over the panel: the Lume's button, the
 * launcher, search, the bell, the theme and the account. Over the canvas: one tab per module.
 */
export function OfficeBar({ access, tabs, active, unread, panel, activity, onPanel, onGo, onClose, onSearch, onNotifications, account, lumeRef, toggleRef }: OfficeBarProps) {
  const theme = useThemeToggle();
  const bellLabel = unread > 0 ? `Notificações, ${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : 'Notificações';
  const open = panel === 'open';
  const toggleLabel = open ? 'Recolher o Lume' : 'Abrir o Lume';
  const scroller = useRef<HTMLElement>(null);
  // Tabs that outgrow the bar scroll; the open one is always brought into view.
  useEffect(() => { scroller.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tabs, active]);
  // While they overflow, the tabs fade out at the bar's end instead of being cut.
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [tabs]);
  return (
    <header aria-label="Barra do escritório" className="lume-toolbar relative z-[3] hidden h-[52px] flex-none items-center md:flex">
      <div ref={lumeRef} data-bar-lume className="lume-bar-lume flex h-full flex-none items-center gap-1 overflow-hidden pl-1.5 pr-1 ml-2.5">
        <button ref={toggleRef} type="button" aria-label={toggleLabel} aria-keyshortcuts="Control+J" title={`${toggleLabel} (Ctrl J)`} aria-expanded={open} aria-controls="lume-panel"
          onClick={() => onPanel(open ? 'collapsed' : 'open')}
          className={cn(stripButton, !open && 'text-foreground')}>
          {open ? <PanelLeftClose className="size-4" aria-hidden="true" /> : <LiveLumeMark state={markState[activity.state]} className="size-[22px]" />}
        </button>
        <span className="lume-bar-spacer min-w-1 flex-1" />
        <Launcher access={access} />
        <button type="button" aria-label="Buscar no escritório" title="Buscar (Ctrl K)" aria-keyshortcuts="Control+K" onClick={onSearch} className={stripButton}>
          <Search className="size-4" aria-hidden="true" />
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
      <nav ref={scroller} aria-label="Abas do canvas" data-overflow={overflow || undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2.5 [scrollbar-width:none] data-overflow:[mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => <Tab key={tab.id} tab={tab} active={tab.id === active} onGo={onGo} onClose={onClose} />)}
      </nav>
    </header>
  );
}
