// Plain-text statuses for the citation check, shared by the chat and the document's Revisão tab.
import type { CitationItem, CitationStatus } from './verdict';

export const citationStatusLabel: Record<CitationStatus, string> = {
  verified: 'Confere com a fonte consultada',
  weak: 'A fonte sustenta só em parte',
  contradicted: 'A fonte diz o contrário',
  no_source: 'Fonte correspondente não identificada',
  unchecked: 'Não verificada',
};
export const citationKindLabel = { statute: 'Norma', precedent: 'Precedente' } as const;
export const citationLabel = (item: CitationItem) => item.source?.hasContent === false ? 'Link disponível; conteúdo não conferido' : citationStatusLabel[item.status];
export const toReview = (items: CitationItem[]) => items.filter(item => item.status !== 'verified');
/** Only web links become anchors; anything else stays text. */
export const sourceHref = (url: string | null | undefined) => url && /^https?:\/\//i.test(url) ? url : null;
