'use client';

import { Bug, CircleUser, Download, LogOut } from 'lucide-react';
import { useRef, useState } from 'react';
import { Avatar } from '@/components/profile/avatar';
import { InstallHelp, useInstallApp } from '@/components/pwa-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { profileNavigation } from '@/lib/navigation';
import { useShell } from './shell-context';
import { AccentChoice } from './office-appearance';

export type Person = { name: string; avatarUrl: string | null };

/** The avatar at the end of the strip: the person's page, feedback, installing the app and leaving. */
export function AccountMenu({ person, officeName, pending, onFeedback, onLogout }: {
  person: Person; officeName: string; pending: boolean; onFeedback(opener: HTMLElement): void; onLogout(): void;
}) {
  const shell = useShell();
  const { installed, install } = useInstallApp();
  const [help, setHelp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button ref={trigger} type="button" aria-label={`Conta de ${person.name}`}
            className="ml-1 grid size-7 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <Avatar name={person.name} src={person.avatarUrl} className="size-7 text-[11px] font-semibold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={10} className="w-64">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <Avatar name={person.name} src={person.avatarUrl} className="size-8 text-[11px] font-semibold" />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium">{person.name}</p>
              <p className="truncate text-xs text-muted-foreground">{officeName}</p>
            </div>
          </div>
          <span aria-hidden="true" className="mx-1 my-1 block h-px bg-border" />
          <AccentChoice menu />
          <DropdownMenuItem onSelect={() => shell?.open(profileNavigation.href, profileNavigation.label)}><CircleUser aria-hidden="true" />{profileNavigation.label}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onFeedback(trigger.current!)}><Bug aria-hidden="true" />Enviar feedback</DropdownMenuItem>
          {!installed && <DropdownMenuItem onSelect={() => { void install().then(setHelp); }}><Download aria-hidden="true" />Instalar o Lume</DropdownMenuItem>}
          <span aria-hidden="true" className="mx-1 my-1 block h-px bg-border" />
          <DropdownMenuItem disabled={pending} title="Encerrar sessão em todos os dispositivos" onSelect={onLogout}><LogOut aria-hidden="true" />{pending ? 'Saindo…' : 'Sair'}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InstallHelp open={help} onOpenChange={setHelp} onCloseFocus={() => trigger.current?.focus()} />
    </>
  );
}
