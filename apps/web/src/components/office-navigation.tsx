'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { officeSections } from '@/lib/navigation';

export function OfficeNavigation({ view, onChange }: { view: string; onChange?: (view: 'tasks' | 'calendar' | 'clients') => void }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [view]);
  const style = (slug: string) => `flex min-h-12 shrink-0 items-center border-b-2 px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === slug ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`;
  return <nav ref={nav} aria-label="Visões do escritório" className="flex gap-5 overflow-x-auto border-b">
    {officeSections.map(({ slug, label }) => onChange && (slug === 'tasks' || slug === 'calendar' || slug === 'clients')
      ? <button key={slug} type="button" aria-current={view === slug ? 'page' : undefined} onClick={() => onChange(slug)} className={style(slug)}>{label}</button>
      : <Link key={slug} href={`/app/agenda?view=${slug}`} aria-current={view === slug ? 'page' : undefined} className={style(slug)}>{label}</Link>)}
  </nav>;
}
