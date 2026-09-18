import 'server-only';
import { selectedSources } from '@/lib/ai-sources';
import { citationCandidates } from '@/lib/ai-policy';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

export function listCandidates(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_citations_list_candidates'>
): CapabilityOutput<'k5_citations_list_candidates'> {
  const sources = selectedSources(context.officeId, input.documentIds);
  const candidates = citationCandidates(sources);
  return {
    candidates: candidates.map(c => ({
      id: c.id,
      documentId: c.documentId,
      sourceLabel: c.sourceLabel,
      text: c.text,
    })),
  };
}
