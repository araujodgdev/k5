import 'server-only';
import { selectedSources, selectedResearchSources } from '@/lib/ai-sources';
import { citationCandidates } from '@/lib/ai-policy';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';

export async function listCandidates(
  context: WorkspaceContext,
  input: CapabilityInput<'k5_citations_list_candidates'>
): Promise<CapabilityOutput<'k5_citations_list_candidates'>> {
  const sources = [
    ...await selectedSources(context.officeId, input.documentIds),
    ...(input.researchReferenceIds?.length ? await selectedResearchSources(context, input.caseId!, input.researchReferenceIds) : []),
  ];
  const candidates = citationCandidates(sources);
  return {
    candidates: candidates.map(c => ({
      id: c.id,
      documentId: c.documentId,
      sourceLabel: c.sourceLabel,
      text: c.text,
      sourceType: c.sourceType,
      researchReferenceId: c.researchReferenceId,
      materialVersionId: c.materialVersionId,
      judgmentId: c.judgmentId,
      researchChunkId: c.researchChunkId,
    })),
  };
}
