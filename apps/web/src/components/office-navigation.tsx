'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { officeSections } from '@/lib/navigation';
import { sectionTab, sectionTabGrid } from '@/components/section-tabs';

export function OfficeNavigation({ view, onChange }: { view: string; onChange?: (view: 'tasks' | 'calendar' | 'clients') => void }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [view]);
  const style = (slug: string) => sectionTab(view === slug);
  // On a phone every view shows in a 3-column grid instead of a strip that scrolls and cuts words.
  return <nav ref={nav} aria-label="Visões do escritório" className={sectionTabGrid}>
    {officeSections.map(({ slug, label }) => onChange && (slug === 'tasks' || slug === 'calendar' || slug === 'clients')
      ? <button key={slug} type="button" aria-current={view === slug ? 'page' : undefined} onClick={() => onChange(slug)} className={style(slug)}>{label}</button>
      : <Link key={slug} href={`/app/agenda?view=${slug}`} aria-current={view === slug ? 'page' : undefined} className={style(slug)}>{label}</Link>)}
  </nav>;
}
