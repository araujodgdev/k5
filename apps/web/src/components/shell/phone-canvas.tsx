'use client';

import { ArrowLeft, ArrowUp, Bell, Bug, Download, LayoutGrid, LogOut, Moon, Search, Sun } from 'lucide-react';
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LiveLumeMark } from '@/components/live-lume-mark';
import { InstallHelp, useInstallApp } from '@/components/pwa-provider';
import { useThemeToggle } from '@/components/theme-provider';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { focusFirstPlace, LauncherList, type LauncherAccess } from './launcher';
import { useShell, type CanvasSubject } from './shell-context';

const phoneButton = 'relative grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

/** The phone header's way back, as text beside an arrow. */
export const phoneBack = 'flex h-11 items-center gap-1.5 rounded-md px-2.5 text-[14.5px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring';

const PHONE_ACTIONS = 'canvas-phone-actions';
const PHONE_BACK = 'canvas-phone-back';
const noSubscription = () => () => {};

function PhoneSlot({ id, children }: { id: string; children: ReactNode }) {
  const target = useSyncExternalStore(noSubscription, () => document.getElementById(id), () => null);
  return target ? createPortal(children, target) : null;
}

/**
 * A view's own actions for the phone header (the case's Compartilhar, for one), drawn beside the
 * shell's search and menu instead of in a second row. Renders nothing outside the canvas shell.
 */
export function CanvasPhoneActions({ children }: { children: ReactNode }) {
  return <PhoneSlot id={PHONE_ACTIONS}>{children}</PhoneSlot>;
}

/** A view's own way back on the phone header, in place of Voltar ao Lume: a case's page goes back to the case. */
export function CanvasPhoneBack({ children }: { children: ReactNode }) {
  return <PhoneSlot id={PHONE_BACK}><span data-phone-back className="contents">{children}</span></PhoneSlot>;
}

const markState = { idle: 'idle', working: 'working', attention: 'attention' } as const;

function pillLabel(subject: CanvasSubject) {
  if (subject.kind === 'case') return 'Pedir ao Lume sobre este caso';
  if (subject.kind === 'document') return 'Pedir ao Lume sobre esta página';
  return 'Pedir ao Lume';
}

export type PhoneMenuProps = {
  access: LauncherAccess;
  unread: number;
  pending: boolean;
  onSearch(): void;
  onNotifications(opener: HTMLElement): void;
  onFeedback(opener: HTMLElement): void;
  onLogout(): void;
};

/** The phone canvas's header (Celular.dc.html, `v.canvas`): back to the Lume, search and the menu. */
export function PhoneBar({ access, unread, pending, onSearch, onNotifications, onFeedback, onLogout }: PhoneMenuProps) {
  const shell = useShell();
  const theme = useThemeToggle();
  const { installed, install } = useInstallApp();
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const moreLabel = unread > 0 ? `Mais opções, ${unread} ${unread === 1 ? 'notificação não lida' : 'notificações não lidas'}` : 'Mais opções';
  // Panels opened from the menu return focus to the menu's button once the menu is gone.
  function fromMenu(action: (opener: HTMLElement) => void) { setMenu(false); if (more.current) action(more.current); }

  return (
    <>
      <div className="group/bar flex h-[calc(56px+env(safe-area-inset-top))] flex-none items-center gap-1 border-b border-border px-1.5 pt-[env(safe-area-inset-top)] md:hidden">
        <div id={PHONE_BACK} className="contents" />
        <button type="button" onClick={() => shell?.setPanel('open')} aria-label="Voltar ao Lume" className={cn(phoneBack, 'group-has-[[data-phone-back]]/bar:hidden')}>
          <ArrowLeft className="size-[18px]" aria-hidden="true" />Lume
        </button>
        <span className="flex-1" />
        <div id={PHONE_ACTIONS} className="contents" />
        <button type="button" aria-label="Buscar" onClick={onSearch} className={phoneButton}><Search className="size-[18px]" aria-hidden="true" /></button>
        <span data-tutorial="trigger" className="flex">
          <button ref={more} type="button" aria-label={moreLabel} aria-haspopup="dialog" aria-expanded={menu} data-tutorial="navigation" onClick={() => setMenu(true)} className={phoneButton}>
            <LayoutGrid className="size-[18px]" aria-hidden="true" />
            {unread > 0 && <span aria-hidden="true" className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-brand" />}
          </button>
        </span>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-1 overflow-y-auto p-1.5" onOpenAutoFocus={focusFirstPlace} onCloseAutoFocus={(event) => { event.preventDefault(); if (more.current?.isConnected) more.current.focus(); }}>
          <SheetTitle className="sr-only">Mais opções</SheetTitle>
          <LauncherList access={access} active={menu} onDone={() => setMenu(false)} />
          <span aria-hidden="true" className="mx-1 my-1 h-px bg-border" />
          <div className="flex items-center gap-1 px-1 pb-[env(safe-area-inset-bottom)]">
            <button type="button" onClick={() => { setMenu(false); void onLogout(); }} disabled={pending} title="Encerrar sessão em todos os dispositivos"
              className="flex min-h-11 flex-1 items-center gap-2.5 rounded-md px-2.5 text-[14.5px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              <LogOut className="size-[18px]" aria-hidden="true" />{pending ? 'Saindo…' : 'Sair'}
            </button>
            <button type="button" aria-label="Notificações" onClick={() => fromMenu(onNotifications)} className={phoneButton}>
              <Bell className="size-[18px]" aria-hidden="true" />
              {unread > 0 && <span aria-hidden="true" className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-brand" />}
            </button>
            <button type="button" aria-label="Enviar feedback" onClick={() => fromMenu(onFeedback)} className={phoneButton}><Bug className="size-[18px]" aria-hidden="true" /></button>
            {!installed && <button type="button" aria-label="Instalar Lume" onClick={() => { void install().then(setHelp); }} className={phoneButton}><Download className="size-[18px]" aria-hidden="true" /></button>}
            <button type="button" aria-label={theme.label} disabled={!theme.mounted} onClick={theme.toggle} className={phoneButton}>
              {theme.dark ? <Sun className="size-[18px]" aria-hidden="true" /> : <Moon className="size-[18px]" aria-hidden="true" />}
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <InstallHelp open={help} onOpenChange={setHelp} onCloseFocus={() => more.current?.focus()} />
    </>
  );
}

/** The floating pill over the phone canvas that brings the Lume back, about what is open. */
export function PhonePill() {
  const shell = useShell();
  if (!shell) return null;
  return (
    <button type="button" onClick={() => shell.setPanel('open')}
      className="lume-phone-pill absolute inset-x-4 bottom-[calc(18px+env(safe-area-inset-bottom))] z-[4] flex h-[52px] items-center gap-2.5 rounded-full border border-border-strong bg-card px-4 text-left text-[15px] text-muted-foreground shadow-[var(--shadow-float)] outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
      <LiveLumeMark state={markState[shell.activity.state]} className="size-[26px] shrink-0 text-foreground" />
      <span className="min-w-0 flex-1 truncate">{pillLabel(shell.subject)}</span>
      <ArrowUp className="size-[18px] shrink-0" aria-hidden="true" />
    </button>
  );
}
