import { captureOperationalError } from '@/lib/observability/report';
import 'server-only';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { searchWebJurisprudence } from '@/lib/research/web-jurisprudence';
import { ResearchError } from '@/lib/research/contracts';
import {
  cancelResearchDownloads, getResearchJudgment, getResearchWebSearch, listResearchWebSearches, runResearchWebSearch, getResearchSearch, listResearchHistory,
  requestResearchMaterial, requestResearchPage, searchResearchCorpus, startResearchSearch,
} from './research-service';
import {
  getResearchCaseProfile, saveResearchCaseProfile, assessResearchCaseMaterial, getResearchCaseAssessment,
  listResearchCaseReferences, addResearchCaseReference, updateResearchCaseReference, removeResearchCaseReference,
} from './research-case-service';

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ResearchError) {
      if (error.code === 'unsupported') captureOperationalError(error,'research.unavailable');
      const codes = {
        forbidden: 'FORBIDDEN', not_found: 'NOT_FOUND', invalid_input: 'INVALID',
        source_disabled: 'NOT_READY', budget_exceeded: 'RATE_LIMITED', unsupported: 'NOT_READY',
      } as const;
      throw new CapabilityError(codes[error.code], error.message);
    }
    throw error;
  }
}

// Context is derived from the authenticated request and membership is revalidated by runCapability.
export const searchCorpus = (context: WorkspaceContext, input: CapabilityInput<'k5_research_search_corpus'>) =>
  operation(() => searchResearchCorpus(context, input));
export const getJudgment = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_judgment'>) =>
  operation(async () => {
    const judgment = await getResearchJudgment(context, input.judgmentId);
    return { judgment: { ...judgment, materials: judgment.materials.map(material => ({ ...material,
      version: material.version ? { ...material.version, originalAvailable: !!material.version.storageKey } : null,
    })) } };
  });
export const webSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_web_search'>) =>
  operation(async () => ({ search: await runResearchWebSearch(context, { query: input.query, mode: input.mode ?? 'auto' }) }));
export const listWebSearches = (context: WorkspaceContext) =>
  operation(async () => ({ searches: await listResearchWebSearches(context) }));
export const getWebSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_web_search'>) =>
  operation(async () => ({ search: await getResearchWebSearch(context, input.searchId) }));
export const listHistory = (context: WorkspaceContext) =>
  operation(async () => ({ searches: await listResearchHistory(context) }));
export const getSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_search'>) =>
  operation(async () => ({ search: await getResearchSearch(context, input.searchId) }));
export const startSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_start_search'>) =>
  operation(async () => ({ search: await startResearchSearch(context, input) }));
export const requestPage = (context: WorkspaceContext, input: CapabilityInput<'k5_research_request_page'>) =>
  operation(async () => ({ page: await requestResearchPage(context, input.searchId, input.cursor) }));
export const requestMaterial = (context: WorkspaceContext, input: CapabilityInput<'k5_research_request_material'>) =>
  operation(() => requestResearchMaterial(context, input));
export const cancelDownloads = (context: WorkspaceContext, input: CapabilityInput<'k5_research_cancel_downloads'>) =>
  operation(() => cancelResearchDownloads(context, input.searchId));
export const getProfile = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_profile'>) =>
  operation(async () => ({ profile: await getResearchCaseProfile(context, input.caseId) }));
export const saveProfile = (context: WorkspaceContext, input: CapabilityInput<'k5_research_save_profile'>) =>
  operation(async () => ({ profile: await saveResearchCaseProfile(context, input) }));
export const assessMaterial = (context: WorkspaceContext, input: CapabilityInput<'k5_research_assess_material'>) =>
  operation(async () => ({ assessment: await assessResearchCaseMaterial(context, input) }));
export const getAssessment = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_assessment'>) =>
  operation(async () => ({ assessment: await getResearchCaseAssessment(context, input.assessmentId) }));
export const listReferences = (context: WorkspaceContext, input: CapabilityInput<'k5_research_list_references'>) =>
  operation(async () => ({ references: await listResearchCaseReferences(context, input.caseId) }));
export const addReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_add_reference'>) =>
  operation(async () => ({ reference: await addResearchCaseReference(context, input) }));
export const updateReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_update_reference'>) =>
  operation(async () => ({ reference: await updateResearchCaseReference(context, input) }));
export const removeReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_remove_reference'>) =>
  operation(async () => { await removeResearchCaseReference(context, input.referenceId, input.expectedVersion); return { success: true }; });

export async function webJurisprudence(context: WorkspaceContext, input: CapabilityInput<'k5_research_web_jurisprudence'>) {
  return searchWebJurisprudence({ officeId: context.officeId, userId: context.userId, signal: context.signal }, input);
}
