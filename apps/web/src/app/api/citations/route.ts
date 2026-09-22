import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** Accepts repeated documentId params: the whole authorized selection, not just the first one. */
export async function GET(request: Request) {
  const params = searchParamsInput(request, ['documentId', 'researchReferenceId', 'caseId']);
  const raw = params.documentId;
  const documentIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const refs = params.researchReferenceId;
  const researchReferenceIds = Array.isArray(refs) ? refs : refs ? [refs] : [];
  const caseId = Array.isArray(params.caseId) ? params.caseId[0] : params.caseId;
  return handleCapability(request, 'k5_citations_list_candidates', { documentIds, researchReferenceIds, caseId });
}
