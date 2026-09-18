import type { OfficeRole } from '@/lib/offices';
import { capabilities, capabilitiesForRole, type CapabilityName } from '@/lib/capabilities/contracts';
import type { WebMCPContext, WebMCPToolDefinition, WebMCPToolRegistration } from './types';

export function isWebMCPSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (typeof document !== 'undefined' && document.modelContext) ||
    (window as unknown as { modelContext?: unknown }).modelContext ||
    (typeof navigator !== 'undefined' && (navigator as unknown as { modelContext?: unknown }).modelContext)
  );
}

export function getModelContext(): WebMCPContext | null {
  if (typeof window === 'undefined') return null;
  if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
  if ((window as unknown as { modelContext?: WebMCPContext }).modelContext) return (window as unknown as { modelContext: WebMCPContext }).modelContext;
  if (typeof navigator !== 'undefined' && (navigator as unknown as { modelContext?: WebMCPContext }).modelContext) {
    return (navigator as unknown as { modelContext: WebMCPContext }).modelContext;
  }
  return null;
}

export async function executeViaHttp(
  name: CapabilityName,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  switch (name) {
    case 'k5_vault_list_cases': {
      const res = await fetch('/api/vault/cases', { signal });
      return await res.json();
    }
    case 'k5_vault_create_case': {
      const res = await fetch('/api/vault/cases', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_update_case': {
      const res = await fetch(`/api/vault/cases/${encodeURIComponent(String(input.caseId))}`, { method: 'PATCH', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_delete_case': {
      const res = await fetch(`/api/vault/cases/${encodeURIComponent(String(input.caseId))}`, { method: 'DELETE', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_list_documents': {
      const params = new URLSearchParams();
      if (input.scope) params.set('scope', String(input.scope));
      if (input.caseId) params.set('caseId', String(input.caseId));
      const res = await fetch(`/api/vault/documents?${params.toString()}`, { signal });
      return await res.json();
    }
    case 'k5_vault_get_document': {
      const res = await fetch(`/api/vault/documents/${encodeURIComponent(String(input.documentId))}`, { signal });
      return await res.json();
    }
    case 'k5_vault_update_document': {
      const res = await fetch(`/api/vault/documents/${encodeURIComponent(String(input.documentId))}`, { method: 'PATCH', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_delete_document': {
      const res = await fetch(`/api/vault/documents/${encodeURIComponent(String(input.documentId))}`, { method: 'DELETE', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_add_document_version': {
      const res = await fetch(`/api/vault/documents/${encodeURIComponent(String(input.documentId))}/versions`, { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_vault_download_document': {
      return {
        downloadUrl: `/api/vault/documents/${encodeURIComponent(String(input.documentId))}/download`,
        name: 'documento',
        mimeType: 'application/octet-stream',
      };
    }
    case 'k5_vault_retry_ingestion': {
      const res = await fetch(`/api/vault/documents/${encodeURIComponent(String(input.documentId))}/retry`, { method: 'POST', headers, signal });
      return await res.json();
    }
    case 'k5_vault_ingest_upload': {
      const res = await fetch('/api/vault/documents/ingest', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_knowledge_search': {
      const res = await fetch('/api/knowledge/search', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_knowledge_get_source': {
      const res = await fetch('/api/knowledge/source', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_knowledge_get_index_status': {
      const res = await fetch(`/api/knowledge/status?documentId=${encodeURIComponent(String(input.documentId))}`, { signal });
      return await res.json();
    }
    case 'k5_knowledge_reindex': {
      const res = await fetch('/api/knowledge/reindex', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_runs_list': {
      const res = await fetch('/api/runs', { signal });
      return await res.json();
    }
    case 'k5_runs_get': {
      const res = await fetch(`/api/runs/${encodeURIComponent(String(input.runId))}`, { signal });
      return await res.json();
    }
    case 'k5_runs_cancel': {
      const res = await fetch(`/api/runs/${encodeURIComponent(String(input.runId))}`, { method: 'PATCH', headers, body: JSON.stringify({ action: 'cancel' }), signal });
      return await res.json();
    }
    case 'k5_runs_retry': {
      const res = await fetch(`/api/runs/${encodeURIComponent(String(input.runId))}`, { method: 'PATCH', headers, body: JSON.stringify({ action: 'retry' }), signal });
      return await res.json();
    }
    case 'k5_documents_start_chronology': {
      const res = await fetch('/api/runs', { method: 'POST', headers, body: JSON.stringify({ kind: 'chronology', ...input }), signal });
      return await res.json();
    }
    case 'k5_documents_start_draft': {
      const res = await fetch('/api/runs', { method: 'POST', headers, body: JSON.stringify({ kind: 'draft', ...input }), signal });
      return await res.json();
    }
    case 'k5_artifacts_get': {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(String(input.artifactId))}`, { signal });
      return await res.json();
    }
    case 'k5_artifacts_update': {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(String(input.artifactId))}`, { method: 'PUT', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_artifacts_list_versions': {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(String(input.artifactId))}/versions`, { signal });
      return await res.json();
    }
    case 'k5_artifacts_restore_version': {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(String(input.artifactId))}/restore`, { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_artifacts_export_docx': {
      return {
        downloadUrl: `/api/artifacts/${encodeURIComponent(String(input.artifactId))}/export`,
        fileName: 'minuta.docx',
      };
    }
    case 'k5_conversations_list': {
      const res = await fetch('/api/conversations', { signal });
      return await res.json();
    }
    case 'k5_conversations_get': {
      const res = await fetch(`/api/conversations/${encodeURIComponent(String(input.conversationId))}`, { signal });
      return await res.json();
    }
    case 'k5_conversations_create': {
      const res = await fetch('/api/conversations', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_conversations_delete': {
      const res = await fetch(`/api/conversations/${encodeURIComponent(String(input.conversationId))}`, { method: 'DELETE', signal });
      return { success: res.ok };
    }
    case 'k5_citations_list_candidates': {
      const docs = Array.isArray(input.documentIds) ? input.documentIds : [];
      const firstId = docs[0];
      const res = await fetch(`/api/citations?documentId=${encodeURIComponent(String(firstId))}`, { signal });
      return await res.json();
    }
    case 'k5_context_set_sources': {
      const res = await fetch('/api/knowledge/scope', { method: 'POST', headers, body: JSON.stringify(input), signal });
      return await res.json();
    }
    case 'k5_session_end_global': {
      const res = await fetch('/api/session/global-logout', { method: 'POST', headers, signal });
      return await res.json();
    }
    case 'k5_ui_open_resource': {
      const type = input.resourceType;
      const id = input.resourceId;
      let path = '/app';
      if (type === 'vault') path = '/app/vault';
      else if (type === 'case') path = id ? `/app/vault?caseId=${encodeURIComponent(String(id))}` : '/app/vault';
      else if (type === 'document') path = id ? `/app/vault?documentId=${encodeURIComponent(String(id))}` : '/app/vault';
      else if (type === 'run' || type === 'artifact') path = id ? `/app/documents?runId=${encodeURIComponent(String(id))}` : '/app/documents';
      return { path };
    }
    default:
      throw new Error(`Operação ${name} não suportada via adaptador HTTP do navegador.`);
  }
}

export function registerWebMCPCapabilities(role: OfficeRole): () => void {
  const context = getModelContext();
  if (!context) return () => {};

  const registrations: WebMCPToolRegistration[] = [];
  const allowedNames = capabilitiesForRole(role);

  for (const name of allowedNames) {
    const capability = capabilities[name];
    const def: WebMCPToolDefinition = {
      name,
      description: capability.description,
      hints: {
        readOnlyHint: capability.effect === 'read',
        consequentialHint: capability.effect === 'write',
      },
    };

    try {
      const registration = context.registerTool(def, async (input, execContext) => {
        return await executeViaHttp(name, input, execContext?.signal);
      });

      if (registration && typeof (registration as Promise<WebMCPToolRegistration>).then === 'function') {
        (registration as Promise<WebMCPToolRegistration>).then((reg) => registrations.push(reg));
      } else if (registration && typeof (registration as WebMCPToolRegistration).unregister === 'function') {
        registrations.push(registration as WebMCPToolRegistration);
      }
    } catch {
      // Browser modelContext error or invalid registration: ignore gracefully
    }
  }

  return () => {
    for (const reg of registrations) {
      try {
        reg.unregister();
      } catch {
        // Safe unregister
      }
    }
  };
}
