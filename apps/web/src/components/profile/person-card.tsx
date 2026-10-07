'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { ProfileCard } from '@/lib/profile-contract';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';

const cards = new Map<string, Promise<ProfileCard | null>>();

/** One request per address and page; a failed lookup is forgotten so the next hover tries again. */
export function lookupProfile(email: string): Promise<ProfileCard | null> {
  const key = email.trim().toLowerCase();
  let pending = cards.get(key);
  if (!pending) {
    pending = fetch(`/api/profile/lookup?email=${encodeURIComponent(key)}`, { cache: 'no-store' }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível carregar o perfil.');
      return body.profile as ProfileCard | null;
    });
    pending.catch(() => cards.delete(key));
    cards.set(key, pending);
  }
  return pending;
}

const since = (value: string) => new Date(value).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' });

/** The summary another person sees: photo, name, practice, OAB and city, a few lines about them. */
export function ProfileSummary({ profile }: { profile: ProfileCard }) {
  const details = [profile.oab && `OAB ${profile.oab}`, profile.location].filter(Boolean).join(' · ');
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Avatar name={profile.name} src={profile.avatarUrl} className="size-12 text-sm" />
        <div className="min-w-0">
          <p className="truncate font-medium">{profile.name}</p>
          {profile.headline && <p className="truncate text-[13px] text-muted-foreground">{profile.headline}</p>}
        </div>
      </div>
      {details && <p className="text-[13px] text-muted-foreground">{details}</p>}
      {profile.bio && <p className="line-clamp-3 text-[13px] whitespace-pre-line">{profile.bio}</p>}
      <p className="text-xs text-muted-foreground">No Lume desde {since(profile.memberSince)}</p>
    </div>
  );
}

type State = { status: 'loading' } | { status: 'ready'; profile: ProfileCard | null } | { status: 'error'; message: string };

function CardBody({ email }: { email: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    lookupProfile(email).then(profile => { if (active) setState({ status: 'ready', profile }); })
      .catch(error => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar o perfil.' }); });
    return () => { active = false; };
  }, [email]);
  if (state.status === 'loading') return <p role="status" className="text-[13px] text-subtle-foreground">Carregando perfil…</p>;
  if (state.status === 'error') return <p role="alert" className="text-[13px] text-destructive">{state.message}</p>;
  if (!state.profile) return <p className="text-[13px] text-muted-foreground">Este e-mail ainda não tem conta no Lume.</p>;
  return <ProfileSummary profile={state.profile} />;
}

/**
 * An e-mail that shows the person's profile card on hover or focus. A tap opens it too, since
 * touch screens have no hover. The card is only fetched when it opens.
 */
export function PersonHoverCard({ email, children, className }: { email: string; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={`Ver perfil de ${email}`}
          className={cn('max-w-full cursor-default text-left break-all underline decoration-transparent underline-offset-4 transition-colors duration-200 ease-(--ease) hover:decoration-current focus-visible:decoration-current focus-visible:outline-none', className)}>
          {children ?? email}
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        {open && <CardBody email={email} />}
      </HoverCardContent>
    </HoverCard>
  );
}
