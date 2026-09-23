// Pure helpers for documents the agent writes in a conversation. No database or server imports,
// so they are unit tested directly (tests/artifact-edits.test.ts).
import { legalMentionsWithoutSource, normalizeEvidence, unauthorizedLegalPassages } from './ai-policy';

export const PENDING_LEGAL = '[Fundamentação jurídica pendente de seleção explícita.]';
export const PENDING_LEGAL_ISSUE = 'O Lume deixou marcada a fundamentação jurídica pendente. Selecione as citações antes de usar o documento.';

export type Edit = { find: string; replace: string };
export type EditFailure = { index: number; reason: 'missing' | 'ambiguous'; find: string };

const count = (text: string, part: string) => {
  let total = 0;
  for (let at = text.indexOf(part); at >= 0 && total < 2; at = text.indexOf(part, at + part.length)) total++;
  return total;
};

/**
 * Applies the edits in order, each against the text the previous one left. All or nothing: a
 * trecho that is missing or appears twice fails the whole call, because replacing "the first one"
 * silently is how a clause in the wrong section gets rewritten.
 */
export function applyEdits(content: string, edits: Edit[]): { content: string } | { failure: EditFailure } {
  let next = content;
  for (const [index, edit] of edits.entries()) {
    const found = count(next, edit.find);
    if (found !== 1) return { failure: { index, reason: found ? 'ambiguous' : 'missing', find: edit.find } };
    const at = next.indexOf(edit.find);
    next = `${next.slice(0, at)}${edit.replace}${next.slice(at + edit.find.length)}`;
  }
  return { content: next };
}

/**
 * The product's hard promise holds in documents too: a line the agent writes that cites an
 * authority nobody selected becomes a pending marker. Runs over the whole text the agent produced,
 * against the text before its change: an unchanged line passes, and a changed line may only
 * mention authorities the document already had. The agent's own lines were filtered when written,
 * so those came from the person, and rewording around them is not introducing them.
 */
export function withoutUnapprovedCitations(text: string, existing = '') {
  const known = new Set(existing.split('\n').map(normalizeEvidence));
  let blocked = 0;
  const lines = text.split('\n').map(line => {
    if (!unauthorizedLegalPassages(line, []).length || known.has(normalizeEvidence(line))) return line;
    if (existing && !legalMentionsWithoutSource(line, existing).length) return line;
    blocked++;
    const prefix = /^(\s*(?:#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s)?)/.exec(line)?.[1] ?? '';
    return `${prefix}${PENDING_LEGAL}`;
  });
  return { text: lines.join('\n'), blocked };
}

export function editFailureMessage(failure: EditFailure) {
  const excerpt = failure.find.length > 80 ? `${failure.find.slice(0, 77)}…` : failure.find;
  return failure.reason === 'missing'
    ? `A edição ${failure.index + 1} não encontrou o trecho "${excerpt}". Leia a versão atual com k5_artifacts_get e copie o trecho exato.`
    : `O trecho "${excerpt}" da edição ${failure.index + 1} aparece mais de uma vez. Inclua palavras vizinhas para torná-lo único.`;
}
