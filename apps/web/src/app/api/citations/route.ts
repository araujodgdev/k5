import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** Accepts repeated documentId params: the whole authorized selection, not just the first one. */
export async function GET(request: Request) {
  const params = searchParamsInput(request, ['documentId']);
  const raw = params.documentId;
  const documentIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return handleCapability(request, 'k5_citations_list_candidates', { documentIds });
}
