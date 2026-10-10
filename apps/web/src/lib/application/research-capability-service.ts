import { contentResult, mapContentResult } from '@/lib/content-result';
import { captureOperationalError } from '@/lib/observability/report';
import 'server-only';
import { personPolicy } from '@/lib/content-policy';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { CapabilityInput } from '@/lib/capabilities/contracts';
import type { WorkspaceContext } from './context';
import { scoreJurisprudence } from '@/lib/research/jurisprudence-score';
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

export const searchCorpus = (context: WorkspaceContext, input: CapabilityInput<'k5_research_search_corpus'>) =>
  operation(() => searchResearchCorpus(context, input));
export const getJudgment = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_judgment'>) =>
  operation(async () => {
    const judgment = await getResearchJudgment(context, input.judgmentId);
    return mapContentResult({ judgment: { ...judgment, materials: judgment.materials.map(material => ({ ...material,
      version: material.version ? { ...material.version, originalAvailable: !!material.version.storageKey } : null,
    })) } }, judgment);
  });
export const webSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_web_search'>) =>
  operation(async () => {const search=await runResearchWebSearch(context, { query: input.query, mode: input.mode ?? 'auto' });return mapContentResult({search},search);});
export const listWebSearches = (context: WorkspaceContext) =>
  operation(async () => {const searches=await listResearchWebSearches(context);return mapContentResult({searches},searches);});
export const getWebSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_web_search'>) =>
  operation(async () => {const search=await getResearchWebSearch(context,input.searchId);return mapContentResult({search},search);});
export const listHistory = (context: WorkspaceContext) =>
  operation(async () => {const searches=await listResearchHistory(context);return mapContentResult({searches},searches);});
export const getSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_search'>) =>
  operation(async () => { const search = await getResearchSearch(context, input.searchId); return mapContentResult({ search }, search); });
export const startSearch = (context: WorkspaceContext, input: CapabilityInput<'k5_research_start_search'>) =>
  operation(async () => { const search = await startResearchSearch(context, input); return mapContentResult({ search }, search); });
export const requestPage = (context: WorkspaceContext, input: CapabilityInput<'k5_research_request_page'>) =>
  operation(async () => { const page = await requestResearchPage(context, input.searchId, input.cursor, { approvalId: input.approvalId }); return mapContentResult({ page }, page); });
export const requestMaterial = (context: WorkspaceContext, input: CapabilityInput<'k5_research_request_material'>) =>
  operation(async () => contentResult(await requestResearchMaterial(context, input), []));
export const cancelDownloads = (context: WorkspaceContext, input: CapabilityInput<'k5_research_cancel_downloads'>) =>
  operation(async () => contentResult(await cancelResearchDownloads(context, input.searchId), []));
export const getProfile = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_profile'>) =>
  operation(async () => { const profile = await getResearchCaseProfile(context, input.caseId); return profile ? mapContentResult({ profile }, profile) : contentResult({ profile: null },[{ ...personPolicy('',''),guards:[{kind:'case',id:input.caseId}]}]); });
export const saveProfile = (context: WorkspaceContext, input: CapabilityInput<'k5_research_save_profile'>) =>
  operation(async () => { const profile = await saveResearchCaseProfile(context, input as Parameters<typeof saveResearchCaseProfile>[1]); return mapContentResult({ profile }, profile); });
export const assessMaterial = (context: WorkspaceContext, input: CapabilityInput<'k5_research_assess_material'>) =>
  operation(async () => { const assessment = await assessResearchCaseMaterial(context, input); return mapContentResult({ assessment }, assessment); });
export const getAssessment = (context: WorkspaceContext, input: CapabilityInput<'k5_research_get_assessment'>) =>
  operation(async () => { const assessment = await getResearchCaseAssessment(context, input.assessmentId); return mapContentResult({ assessment }, assessment); });
export const listReferences = (context: WorkspaceContext, input: CapabilityInput<'k5_research_list_references'>) =>
  operation(async () => { const references = await listResearchCaseReferences(context, input.caseId); return mapContentResult({ references }, references); });
export const addReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_add_reference'>) =>
  operation(async () => { const reference = await addResearchCaseReference(context, input); return mapContentResult({ reference }, reference); });
export const updateReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_update_reference'>) =>
  operation(async () => { const reference = await updateResearchCaseReference(context, input); return mapContentResult({ reference }, reference); });
export const removeReference = (context: WorkspaceContext, input: CapabilityInput<'k5_research_remove_reference'>) =>
  operation(async () => { await removeResearchCaseReference(context, input.referenceId, input.expectedVersion); return contentResult({ success: true },[]); });

export async function scoreFoundJurisprudence(context: WorkspaceContext, input: CapabilityInput<'k5_research_score_jurisprudence'>) {
  return scoreJurisprudence(context, input);
}
