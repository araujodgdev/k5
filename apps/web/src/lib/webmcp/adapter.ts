import { z } from 'zod';
import type { OfficeRole } from '@/lib/offices';
import { capabilities, publishedCapabilitiesForRole, type CapabilityName } from '@/lib/capabilities/contracts';
import type { WebMCPContext, WebMCPToolDefinition, WebMCPToolRegistration } from './types';

export function isWebMCPSupported(): boolean {
  return getModelContext() !== null;
}

/**
 * The imperative surface is `document.modelContext`. `navigator.modelContext` appears in early
 * examples and is not what the current runtime exposes, so it is not probed here.
 */
export function getModelContext(): WebMCPContext | null {
  if (typeof document === 'undefined') return null;
  const context = document.modelContext;
  return context && typeof context.registerTool === 'function' ? context : null;
}

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
const routes: Record<CapabilityName, Route> = {
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
      return `/api/citations?${params.toString()}`;
    },
  },
  k5_artifacts_get: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}` },
  k5_artifacts_update: { method: 'PUT', path: (i) => `/api/artifacts/${id(i.artifactId)}`, body: (i) => i },
  k5_artifacts_list_versions: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}/versions` },
  k5_artifacts_restore_version: { method: 'POST', path: (i) => `/api/artifacts/${id(i.artifactId)}/restore`, body: (i) => i },
  k5_artifacts_export_docx: { method: 'GET', path: (i) => `/api/artifacts/${id(i.artifactId)}/link` },
  k5_conversations_list: { method: 'GET', path: () => '/api/conversations' },
  k5_conversations_get: { method: 'GET', path: (i) => `/api/conversations/${id(i.conversationId)}` },
  k5_conversations_create: { method: 'POST', path: () => '/api/conversations', body: (i) => i },
  k5_conversations_delete: { method: 'DELETE', path: (i) => `/api/conversations/${id(i.conversationId)}` },
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
      if (i.limit) params.set('limit', String(i.limit));
      const query = params.toString();
      return query ? `/api/judicial/publications?${query}` : '/api/judicial/publications';
    },
  },
  k5_judicial_get_publication: { method: 'GET', path: (i) => `/api/judicial/publications/${id(i.publicationId)}` },
  k5_judicial_request_refresh: { method: 'POST', path: (i) => `/api/judicial/links/${id(i.linkId)}/refresh`, body: (i) => i },
  k5_judicial_get_job: { method: 'GET', path: (i) => `/api/judicial/jobs/${id(i.jobId)}` },
  k5_judicial_list_alerts: {
    method: 'GET',
    path: (i) => {
      const params = new URLSearchParams();
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

export async function executeViaHttp(
  name: CapabilityName,
  rawInput: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WebMCPResult> {
  const capability = capabilities[name];

  // Validate against the same contract the server enforces, so a schema mistake is a clear
  // message here instead of an opaque 400 the agent has to guess at.
  const parsed = capability.input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID', error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'entrada'}: ${issue.message}`).join('; ') };
  }
  const input = parsed.data as Record<string, unknown>;
  const route = routes[name];

  try {
    const response = await fetch(route.path(input), {
      method: route.method,
      headers: route.body ? { 'Content-Type': 'application/json' } : undefined,
      body: route.body ? JSON.stringify(route.body(input)) : undefined,
      signal,
    });

    const payload = response.status === 204 ? null : await response.json().catch(() => null);

    // A 403 body is not a result. Returning it as one is how an agent concludes that a refused
    // operation succeeded.
    if (!response.ok) {
      const body = payload as { error?: string; code?: string } | null;
      if (response.status === 401) return { ok: false, code: 'UNAUTHENTICATED', error: 'Sua sessão expirou. Entre novamente no K5 para continuar.' };
      return { ok: false, code: body?.code ?? String(response.status), error: body?.error ?? 'Não foi possível concluir a operação.' };
    }
    return { ok: true, data: payload };
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: 'CANCELLED', error: 'Operação cancelada.' };
    void error;
    return { ok: false, code: 'NETWORK', error: 'Não foi possível falar com o K5.' };
  }
}

/**
 * Registers the authorized catalog and returns a cleanup that works even when it is called before
 * an async `registerTool` settles - React's double mount does exactly that, and a registration
 * that lands after unmount would otherwise leak a live tool into the next mount.
 */
export function registerWebMCPCapabilities(role: OfficeRole): () => void {
  const context = getModelContext();
  if (!context) return () => {};

  const lifetime = new AbortController();
  const registrations: WebMCPToolRegistration[] = [];
  let disposed = false;

  for (const name of publishedCapabilitiesForRole(role, 'webmcp')) {
    const capability = capabilities[name];
    const definition: WebMCPToolDefinition = {
      name,
      description: capability.description,
      inputSchema: z.toJSONSchema(capability.input, { io: 'input' }) as Record<string, unknown>,
      hints: {
        readOnlyHint: capability.effect === 'read',
        consequentialHint: capability.effect === 'write',
        // Vault text is someone else's document; it is data, never instructions for the agent.
        untrustedContentHint: capability.module === 'knowledge' || capability.module === 'citations',
      },
    };

    try {
      const registered = context.registerTool(
        definition,
        async (input, execution) => executeViaHttp(name, input ?? {}, execution?.signal),
        { signal: lifetime.signal },
      );

      if (registered && typeof (registered as Promise<WebMCPToolRegistration>).then === 'function') {
        void (registered as Promise<WebMCPToolRegistration>).then((registration) => {
          if (disposed) { try { registration.unregister(); } catch { /* already gone */ } return; }
          registrations.push(registration);
        }).catch(() => { /* registration refused by the browser */ });
      } else if (registered && typeof (registered as WebMCPToolRegistration).unregister === 'function') {
        registrations.push(registered as WebMCPToolRegistration);
      }
    } catch {
      // Browser refused this definition: the interface keeps working without it.
    }
  }

  return () => {
    disposed = true;
    lifetime.abort();
    for (const registration of registrations.splice(0)) {
      try { registration.unregister(); } catch { /* already gone */ }
    }
  };
}
