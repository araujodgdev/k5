'use client';

import { TrademarkWorkspace } from './trademark-workspace';
import { JurisprudenceWorkspace } from './jurisprudence-workspace';

export type ResearchMode = 'trademarks' | 'jurisprudence';

/** A new or reopened search of Pesquisa, in the module's tab. */
export function ResearchModule({ mode, searchId }: { mode: ResearchMode; searchId: string | null }) {
  return <>
    {mode === 'trademarks' ? <TrademarkWorkspace key={searchId ?? 'new'} initialSearchId={searchId} />
      : <JurisprudenceWorkspace key={searchId ?? 'new'} initialSearchId={searchId} />}
  </>;
}
