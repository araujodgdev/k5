'use client';

import Link from 'next/link';
import type { OfficeRole } from '@/lib/offices';
import { sectionTab, sectionTabRow } from '@/components/section-tabs';
import { TrademarkWorkspace } from './trademark-workspace';
import { JurisprudenceWorkspace } from './jurisprudence-workspace';

export type ResearchMode = 'trademarks' | 'jurisprudence';
const modes: Array<{ value: ResearchMode; label: string }> = [
  { value: 'trademarks', label: 'Marcas' }, { value: 'jurisprudence', label: 'Jurisprudência' },
];

export function ResearchModule({ mode, searchId, role }: { mode: ResearchMode; searchId: string | null; role: OfficeRole }) {
  return <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10">
    <div className="border-b pb-5"><h1 className="page-title leading-none max-md:sr-only">Pesquisa</h1></div>
    <nav aria-label="Modalidades de pesquisa" className={sectionTabRow}>
      {modes.map(item => <Link key={item.value} href={`/app/research?mode=${item.value}`} aria-current={mode === item.value ? 'page' : undefined} className={sectionTab(mode === item.value, 'text-center')}>{item.label}</Link>)}
    </nav>
    {mode === 'trademarks' ? <TrademarkWorkspace key={searchId ?? 'new'} initialSearchId={searchId} />
      : <JurisprudenceWorkspace key={searchId ?? 'new'} initialSearchId={searchId} role={role} />}
  </div>;
}
