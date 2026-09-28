// What a citation's answers mean for the person. Pure policy over Jev's judgments, kept apart so
// thresholds can change without re-asking anything, and tested without the service.
import type { z } from 'zod';
import type { decisionAnswer } from '@/lib/typesafe/contracts';
import type { CitationSource, CitationSpan } from './detect';

type Answer = z.infer<typeof decisionAnswer> | undefined;

export type CitationKind = 'statute' | 'precedent';
/**
 * verified: the source the Lume consulted is the one cited and backs the paragraph.
 * weak: it is the source, but backs the paragraph only partly, or Jev is unsure.
 * contradicted: the source says the opposite.
 * no_source: nothing the Lume consulted is this authority; it came from memory.
 * unchecked: sources may exist, but Jev did not judge them (disabled, shadow or unavailable).
 */
export type CitationStatus = 'verified' | 'weak' | 'contradicted' | 'no_source' | 'unchecked';
export type CitationItem = {
  id: string; text: string; paragraph: string; kind: CitationKind | null; status: CitationStatus; confidence: number | null;
  source: { title: string; url: string | null; kind: CitationSource['kind'] } | null;
};
export type CitationReview = { status: 'evaluated' | 'partial' | 'disabled' | 'unavailable'; items: CitationItem[]; mentions: number };

/** Below these, a person decides (docs.typesafe.ai citation check: 0.8 to accept automatically). */
export const ACCEPT_CONFIDENCE = 0.8;
export const MATCH_PROBABILITY = 0.5;
export const MENTION_CONFIDENCE = 0.6;

export const needsReview = (item: CitationItem) => item.status !== 'verified';

export function composeCitation(span: CitationSpan, candidates: CitationSource[], answers?: {
  kind: Answer; candidates: Array<{ match: Answer; support: Answer }>;
}): CitationItem | null {
  const kindAnswer = answers?.kind?.type === 'choice' ? answers.kind : undefined;
  // A confident "not a citation" drops the span; an unsure one stays, since missing a citation costs more.
  if (kindAnswer?.choice === 'mention' && kindAnswer.confidence >= MENTION_CONFIDENCE) return null;
  const kind = kindAnswer && kindAnswer.choice !== 'mention' ? kindAnswer.choice as CitationKind : null;
  const base = { id: span.id, text: span.text, paragraph: span.paragraph.slice(0, 300), kind };
  const describe = (source: CitationSource) => ({ title: source.title, url: source.url ?? null, kind: source.kind });

  if (!candidates.length) return { ...base, status: 'no_source', confidence: null, source: null };
  if (!answers) return { ...base, status: 'unchecked', confidence: null, source: describe(candidates[0]) };

  const best = answers.candidates
    .map((answer, index) => ({ index, match: answer.match?.type === 'noul' ? answer.match.noul : 0, support: answer.support }))
    .filter(item => item.match >= MATCH_PROBABILITY)
    .sort((a, b) => b.match - a.match)[0];
  if (!best) return { ...base, status: 'no_source', confidence: null, source: null };

  const support = best.support?.type === 'choice' ? best.support : undefined;
  const source = describe(candidates[best.index]);
  if (!support) return { ...base, status: 'unchecked', confidence: null, source };
  const status: CitationStatus = support.choice === 'supports' && support.confidence >= ACCEPT_CONFIDENCE ? 'verified'
    : support.choice === 'contradicts' && support.confidence >= MATCH_PROBABILITY ? 'contradicted'
    : 'weak';
  return { ...base, status, confidence: Math.round(support.confidence * 100) / 100, source };
}
