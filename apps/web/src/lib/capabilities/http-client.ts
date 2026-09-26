import type { CapabilityName } from './contracts';
import { googleOperationPath, googleOperations, type GoogleCapabilityName, type GoogleOperation } from '@/lib/google/routes';

type Route = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: (input: Record<string, unknown>) => string;
  body?: (input: Record<string, unknown>) => unknown;
};

const id = (value: unknown) => encodeURIComponent(String(value ?? ''));

/**
 * One route per capability. Nothing is synthesised on the client: a download link that the server
 * never confirmed is a result the agent cannot distinguish from a real one, for a document that
 * may not exist or may not belong to this office.
 */
const googleRoutes = Object.fromEntries<Route>(Object.entries(googleOperations).map(([operation, name]) =>
  [name, { method: 'POST', path: () => googleOperationPath(operation as GoogleOperation), body: (i: Record<string, unknown>) => i } satisfies Route])) as Record<GoogleCapabilityName, Route>;

const routes: Record<CapabilityName, Route> = {
  ...googleRoutes,
  k5_research_web_search: { method: 'POST', path: () => '/api/research/web-searches', body: i => i },
  k5_research_list_web_searches: { method: 'GET', path: () => '/api/research/web-searches' },
  k5_research_get_web_search: { method: 'GET', path: i => `/api/research/web-searches/${id(i.searchId)}` },
  k5_research_search_corpus: { method: 'POST', path: () => '/api/research/corpus', body: i => i },
  k5_research_score_jurisprudence: { method: 'POST', path: () => '/api/research/jurisprudence-score', body: i => i },
  k5_research_get_judgment: { method: 'GET', path: i => `/api/research/judgments/${id(i.judgmentId)}` },
  k5_research_list_history: { method: 'GET', path: () => '/api/research/searches' },
  k5_research_get_search: { method: 'GET', path: i => `/api/research/searches/${id(i.searchId)}` },
  k5_research_start_search: { method: 'POST', path: () => '/api/research/searches', body: i => i },
  k5_research_request_page: { method: 'POST', path: i => `/api/research/searches/${id(i.searchId)}/pages`, body: i => i },
  k5_research_request_material: { method: 'POST', path: () => '/api/research/materials', body: i => i },
  k5_research_cancel_downloads: { method: 'POST', path: i => `/api/research/searches/${id(i.searchId)}/downloads`, body: i => i },
  k5_research_get_profile: { method: 'GET', path: i => `/api/research/cases/${id(i.caseId)}/profile` },
  k5_research_save_profile: { method: 'PUT', path: i => `/api/research/cases/${id(i.caseId)}/profile`, body: i => i },
  k5_research_assess_material: { method: 'POST', path: i => `/api/research/cases/${id(i.caseId)}/assessments`, body: i => i },
  k5_research_get_assessment: { method: 'GET', path: i => `/api/research/assessments/${id(i.assessmentId)}` },
  k5_research_list_references: { method: 'GET', path: i => `/api/research/cases/${id(i.caseId)}/references` },
  k5_research_add_reference: { method: 'POST', path: i => `/api/research/cases/${id(i.caseId)}/references`, body: i => i },
  k5_research_update_reference: { method: 'PATCH', path: i => `/api/research/references/${id(i.referenceId)}`, body: i => i },
  k5_research_remove_reference: { method: 'DELETE', path: i => `/api/research/references/${id(i.referenceId)}`, body: i => i },
  k5_agenda_interpret: { method: 'POST', path: () => '/api/agenda/proposals/interpret', body: i => i },
  k5_agenda_get_proposal: { method: 'POST', path: () => '/api/agenda/proposals/get', body: i => i },
  k5_agenda_list_proposals: { method: 'POST', path: () => '/api/agenda/proposals/list', body: i => i },
  k5_agenda_apply_proposal: { method: 'POST', path: () => '/api/agenda/proposals/apply', body: i => i },
  k5_artifacts_get_verification: { method: 'GET', path: i => `/api/artifacts/${id(i.artifactId)}/verification` },
  k5_artifacts_verify: { method: 'POST', path: i => `/api/artifacts/${id(i.artifactId)}/verification`, body: i => i },
  k5_crm_list_clients: { method: 'POST', path: () => '/api/agenda/clients/list', body: i => i },
  k5_crm_get_client: { method: 'POST', path: () => '/api/agenda/clients/get', body: i => i },
  k5_crm_create_client: { method: 'POST', path: () => '/api/agenda/clients/create', body: i => i },
  k5_crm_update_client: { method: 'POST', path: () => '/api/agenda/clients/update', body: i => i },
  k5_agenda_list_members: { method: 'POST', path: () => '/api/agenda/members/list', body: i => i },
  k5_agenda_list_activities: { method: 'POST', path: () => '/api/agenda/activities/list', body: i => i },
  k5_agenda_get_activity: { method: 'POST', path: () => '/api/agenda/activities/get', body: i => i },
  k5_agenda_create_activity: { method: 'POST', path: () => '/api/agenda/activities/create', body: i => i },
  k5_agenda_update_activity: { method: 'POST', path: () => '/api/agenda/activities/update', body: i => i },
  k5_vault_list_cases: { method: 'GET', path: () => '/api/vault/cases' },
  k5_vault_create_case: { method: 'POST', path: () => '/api/vault/cases', body: (i) => i },
  k5_vault_update_case: { method: 'PATCH', path: (i) => `/api/vault/cases/${id(i.caseId)}`, body: (i) => i },
  k5_vault_delete_case: { method: 'DELETE', path: (i) => `/api/vault/cases/${id(i.caseId)}`, body: (i) => i },
  k5_vault_list_folders: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams({ caseId: String(i.caseId ?? '') });
      if (i.parentId) params.set('parentId', String(i.parentId));
      return `/api/vault/folders?${params}`;
    },
  },
  k5_vault_create_folder: { method: 'POST', path: () => '/api/vault/folders', body: (i) => i },
  k5_vault_plan_annexes: { method: 'POST', path: i => `/api/vault/cases/${id(i.caseId)}/annexes`, body: i => i },
  k5_vault_generate_annexes: { method: 'POST', path: i => `/api/vault/cases/${id(i.caseId)}/annexes/files`, body: i => i },
  k5_vault_delete_folder: { method: 'DELETE', path: (i) => `/api/vault/folders/${id(i.folderId)}`, body: (i) => i },
  k5_vault_list_documents: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.scope) params.set('scope', String(i.scope));
      if (i.caseId) params.set('caseId', String(i.caseId));
      if (i.folderId !== undefined) params.set('folderId', i.folderId === null ? 'root' : String(i.folderId));
      if (i.limit) params.set('limit', String(i.limit));
      const query = params.toString();
      return query ? `/api/vault/documents?${query}` : '/api/vault/documents';
    },
  },
  k5_vault_get_document: { method: 'GET', path: (i) => `/api/vault/documents/${id(i.documentId)}` },
  k5_vault_update_document: { method: 'PATCH', path: (i) => `/api/vault/documents/${id(i.documentId)}`, body: (i) => i },
  k5_vault_delete_document: { method: 'DELETE', path: (i) => `/api/vault/documents/${id(i.documentId)}`, body: (i) => i },
  k5_vault_add_document_version: { method: 'POST', path: (i) => `/api/vault/documents/${id(i.documentId)}/versions`, body: (i) => i },
  k5_vault_download_document: { method: 'GET', path: (i) => `/api/vault/documents/${id(i.documentId)}/link` },
  k5_vault_retry_ingestion: { method: 'POST', path: (i) => `/api/vault/documents/${id(i.documentId)}/retry`, body: (i) => i },
  k5_vault_ingest_upload: { method: 'POST', path: () => '/api/vault/documents/ingest', body: (i) => i },
  k5_knowledge_search: { method: 'POST', path: () => '/api/knowledge/search', body: (i) => i },
  k5_knowledge_get_source: { method: 'POST', path: () => '/api/knowledge/source', body: (i) => i },
  k5_knowledge_get_index_status: { method: 'GET', path: (i) => `/api/knowledge/status?documentId=${id(i.documentId)}` },
  k5_knowledge_reindex: { method: 'POST', path: () => '/api/knowledge/reindex', body: (i) => i },
  k5_runs_list: { method: 'GET', path: () => '/api/runs' },
  k5_runs_get: { method: 'GET', path: (i) => `/api/runs/${id(i.runId)}` },
  k5_runs_cancel: { method: 'PATCH', path: (i) => `/api/runs/${id(i.runId)}`, body: (i) => ({ ...i, action: 'cancel' }) },
  k5_runs_retry: { method: 'PATCH', path: (i) => `/api/runs/${id(i.runId)}`, body: (i) => ({ ...i, action: 'retry' }) },
  k5_documents_start_chronology: { method: 'POST', path: () => '/api/runs', body: (i) => ({ kind: 'chronology', ...i }) },
  k5_documents_start_draft: { method: 'POST', path: () => '/api/runs', body: (i) => ({ kind: 'draft', ...i }) },
  k5_citations_list_candidates: {
    method: 'GET',
    path: (i) => {
      const ids = Array.isArray(i.documentIds) ? (i.documentIds as unknown[]) : [];
      const params = new URLSearchParams();
      for (const value of ids) params.append('documentId', String(value));
      if (i.caseId) params.set('caseId', String(i.caseId));
      const referenceIds = Array.isArray(i.researchReferenceIds) ? (i.researchReferenceIds as unknown[]) : [];
      for (const value of referenceIds) params.append('researchReferenceId', String(value));
      return `/api/citations?${params.toString()}`;
    },
  },
  k5_artifacts_create: { method: 'POST', path: () => '/api/artifacts', body: (i) => i },
  k5_artifacts_edit: { method: 'POST', path: (i) => `/api/artifacts/${id(i.artifactId)}/edits`, body: (i) => i },
  k5_artifacts_list: { method: 'GET', path: i => i.limit ? `/api/artifacts?limit=${id(i.limit)}` : '/api/artifacts' },
  k5_artifacts_get: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}` },
  k5_artifacts_update: { method: 'PUT', path: (i) => `/api/artifacts/${id(i.artifactId)}`, body: (i) => i },
  k5_artifacts_list_versions: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}/versions` },
  k5_artifacts_restore_version: { method: 'POST', path: (i) => `/api/artifacts/${id(i.artifactId)}/restore`, body: (i) => i },
  k5_artifacts_export_docx: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}/link` },
  k5_conversations_list: { method: 'GET', path: i => i.limit ? `/api/conversations?limit=${id(i.limit)}` : '/api/conversations' },
  k5_conversations_get: { method: 'GET', path: (i) => `/api/conversations/${id(i.conversationId)}` },
  k5_conversations_create: { method: 'POST', path: () => '/api/conversations', body: (i) => i },
  k5_conversations_delete: { method: 'DELETE', path: (i) => `/api/conversations/${id(i.conversationId)}` },
  k5_memory_get: { method: 'GET', path: () => '/api/agent/memory' },
  k5_memory_clear: { method: 'DELETE', path: () => '/api/agent/memory' },
  k5_context_set_sources: { method: 'POST', path: () => '/api/knowledge/scope', body: (i) => i },
  k5_judicial_list_sources: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.purpose) params.set('purpose', String(i.purpose));
      if (i.enabledOnly) params.set('enabledOnly', 'true');
      const query = params.toString();
      return query ? `/api/judicial/sources?${query}` : '/api/judicial/sources';
    },
  },
  k5_judicial_list_links: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.caseId) params.set('caseId', String(i.caseId));
      if (i.activeOnly !== undefined) params.set('activeOnly', String(i.activeOnly));
      if (i.limit) params.set('limit', String(i.limit));
      if (i.cursor) params.set('cursor', String(i.cursor));
      const query = params.toString();
      return query ? `/api/judicial/links?${query}` : '/api/judicial/links';
    },
  },
  k5_judicial_link_case: { method: 'POST', path: () => '/api/judicial/links', body: (i) => i },
  // Unpublished to both adapters, but the map is exhaustive by design: a capability that later
  // becomes publishable must not reach this table without a route already written for it.
  k5_judicial_confirm_link: { method: 'PATCH', path: (i) => `/api/judicial/links/${id(i.linkId)}`, body: (i) => i },
  k5_judicial_unlink_case: { method: 'DELETE', path: (i) => `/api/judicial/links/${id(i.linkId)}`, body: (i) => i },
  k5_judicial_list_publications: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.caseId) params.set('caseId', String(i.caseId));
      if (i.linkId) params.set('linkId', String(i.linkId));
      if (i.installationId) params.set('installationId', String(i.installationId));
      if (i.limit) params.set('limit', String(i.limit));
      const query = params.toString();
      return query ? `/api/judicial/publications?${query}` : '/api/judicial/publications';
    },
  },
  k5_judicial_get_publication: { method: 'GET', path: (i) => `/api/judicial/publications/${id(i.publicationId)}` },
  k5_judicial_request_refresh: { method: 'POST', path: (i) => `/api/judicial/links/${id(i.linkId)}/refresh`, body: (i) => i },
  k5_judicial_get_job: { method: 'GET', path: (i) => `/api/judicial/jobs/${id(i.jobId)}` },
  k5_judicial_list_jobs: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.caseId) params.set('caseId', String(i.caseId));
      if (i.linkId) params.set('linkId', String(i.linkId));
      if (i.installationId) params.set('installationId', String(i.installationId));
      if (i.status) params.set('status', String(i.status));
      if (i.limit) params.set('limit', String(i.limit));
      const query = params.toString();
      return query ? `/api/judicial/jobs?${query}` : '/api/judicial/jobs';
    },
  },
  k5_judicial_list_alerts: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
      if (i.caseId) params.set('caseId', String(i.caseId));
      if (i.installationId) params.set('installationId', String(i.installationId));
      if (i.unreadOnly) params.set('unreadOnly', 'true');
      if (i.limit) params.set('limit', String(i.limit));
      const query = params.toString();
      return query ? `/api/judicial/alerts?${query}` : '/api/judicial/alerts';
    },
  },
  k5_judicial_mark_alert_read: { method: 'PATCH', path: (i) => `/api/judicial/alerts/${id(i.alertId)}`, body: (i) => i },
  k5_ui_open_resource: { method: 'POST', path: () => '/api/ui/open', body: (i) => i },
  k5_session_end_global: { method: 'POST', path: () => '/api/session/global-logout' },
};

export type WebMCPResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; error: string };

export async function requestCapability(
  name: CapabilityName,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  surface?: 'webmcp',
): Promise<WebMCPResult> {
  const route = routes[name];

  try {
    const response = await fetch(route.path(input), {
      method: route.method,
      headers: { ...(route.body ? { 'Content-Type': 'application/json' } : {}), ...(surface ? { 'x-k5-surface': surface } : {}) },
      body: route.body ? JSON.stringify(route.body(input)) : undefined,
      signal,
    });

    const payload = response.status === 204 ? null : await response.json().catch(() => null);

    // A 403 body is not a result. Returning it as one is how an agent concludes that a refused
    // operation succeeded.
    if (!response.ok) {
      const body = payload as { error?: string; code?: string } | null;
      if (response.status === 401) return { ok: false, code: 'UNAUTHENTICATED', error: 'Sua sessão expirou. Entre novamente no Lume para continuar.' };
      return { ok: false, code: body?.code ?? String(response.status), error: body?.error ?? 'Não foi possível concluir a operação.' };
    }
    return { ok: true, data: payload };
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'CANCELLED', error: 'Operação cancelada.' };
    void error;
    return { ok: false, code: 'NETWORK', error: 'Não foi possível falar com o Lume.' };
  }
}
