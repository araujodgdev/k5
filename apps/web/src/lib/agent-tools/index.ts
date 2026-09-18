import 'server-only';
import { createTool } from '@mastra/core/tools';
import {
  capabilities,
  capabilitiesForRole,
  platformCapabilities,
  type Capability,
  type CapabilityName,
} from '@/lib/capabilities/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import * as vault from '@/lib/application/vault-service';
import * as runs from '@/lib/application/runs-service';
import * as artifacts from '@/lib/application/artifacts-service';
import * as conversations from '@/lib/application/conversations-service';
import * as citations from '@/lib/application/citations-service';
import * as knowledge from '@/lib/application/knowledge-service';
import * as ui from '@/lib/application/ui-service';
import * as platform from '@/lib/application/platform-service';

type Executor = (context: WorkspaceContext, input: never) => unknown;

/** One executor per contract; the compiler fails if a capability is published without one. */
const executors: { [N in CapabilityName]: Executor } = {
  k5_vault_list_cases: vault.listCases,
  k5_vault_create_case: vault.createCase,
  k5_vault_update_case: vault.updateCase,
  k5_vault_delete_case: vault.deleteCase,
  k5_vault_list_documents: vault.listDocuments,
  k5_vault_get_document: vault.getDocument,
  k5_vault_update_document: vault.updateDocument,
  k5_vault_delete_document: vault.deleteDocument,
  k5_vault_add_document_version: vault.addDocumentVersion,
  k5_vault_download_document: vault.downloadDocument,
  k5_vault_retry_ingestion: vault.retryIngestion,
  k5_vault_ingest_upload: vault.ingestUpload,
  k5_knowledge_search: knowledge.searchKnowledge,
  k5_knowledge_get_source: knowledge.getKnowledgeSource,
  k5_knowledge_get_index_status: knowledge.getKnowledgeIndexStatus,
  k5_knowledge_reindex: knowledge.reindexKnowledge,
  k5_runs_list: runs.listRuns,
  k5_runs_get: runs.getRun,
  k5_runs_cancel: runs.cancelRun,
  k5_runs_retry: runs.retryRun,
  k5_documents_start_chronology: runs.startChronology,
  k5_documents_start_draft: runs.startDraft,
  k5_citations_list_candidates: citations.listCandidates,
  k5_artifacts_get: artifacts.getArtifact,
  k5_artifacts_update: artifacts.saveArtifact,
  k5_artifacts_list_versions: artifacts.listArtifactVersions,
  k5_artifacts_restore_version: artifacts.restoreArtifactVersion,
  k5_artifacts_export_docx: artifacts.exportArtifactDocx,
  k5_conversations_list: conversations.listConversations,
  k5_conversations_get: conversations.getConversation,
  k5_conversations_create: conversations.createNewConversation,
  k5_conversations_delete: conversations.deleteConversation,
  k5_context_set_sources: knowledge.setScopeSources,
  k5_ui_open_resource: ui.openResource,
  k5_session_end_global: ui.endGlobalSession,
};

export type ToolEvent = { name: CapabilityName; state: 'completed' | 'failed'; summary: string };

/**
 * Builds the tools for one authenticated request. The office, the user and the role come from the
 * session and are re-checked inside every call, so a revoked membership stops the next step.
 */
export function agentTools(context: WorkspaceContext) {
  return Object.fromEntries(capabilitiesForRole(context.role).map((name) => [name, toolFor(name, context)]));
}

import { withIdempotency } from '@/lib/application/idempotency-service';

function toolFor(name: CapabilityName, context: WorkspaceContext) {
  const capability: Capability = capabilities[name];
  return createTool({
    id: name,
    description: capability.description,
    inputSchema: capability.input,
    outputSchema: capability.output,
    execute: async (input: unknown) => {
      const authorized = assertCapabilityAllowed(context, name);
      const idempotencyKey = (input && typeof input === 'object' && 'idempotencyKey' in input && typeof (input as { idempotencyKey?: unknown }).idempotencyKey === 'string')
        ? (input as { idempotencyKey: string }).idempotencyKey
        : undefined;
      if (capability.effect === 'write' && idempotencyKey) {
        return await withIdempotency(authorized, name, idempotencyKey, input, async () => {
          return await (executors[name] as (context: WorkspaceContext, input: unknown) => unknown)(authorized, input);
        });
      }
      return await (executors[name] as (context: WorkspaceContext, input: unknown) => unknown)(authorized, input);
    },
  });
}

/** Platform tools catalog, separated from office agent tools (Section 5.3) */
export function platformAgentTools(context: WorkspaceContext) {
  return {
    k5_platform_list_offices: createTool({
      id: 'k5_platform_list_offices',
      description: platformCapabilities.k5_platform_list_offices.description,
      inputSchema: platformCapabilities.k5_platform_list_offices.input,
      outputSchema: platformCapabilities.k5_platform_list_offices.output,
      execute: async (input: { limit?: number }) => platform.platformListOffices(context, input),
    }),
    k5_platform_list_connections: createTool({
      id: 'k5_platform_list_connections',
      description: platformCapabilities.k5_platform_list_connections.description,
      inputSchema: platformCapabilities.k5_platform_list_connections.input,
      outputSchema: platformCapabilities.k5_platform_list_connections.output,
      execute: async (input: { officeId: string }) => platform.platformListConnections(context, input),
    }),
    k5_platform_test_connection: createTool({
      id: 'k5_platform_test_connection',
      description: platformCapabilities.k5_platform_test_connection.description,
      inputSchema: platformCapabilities.k5_platform_test_connection.input,
      outputSchema: platformCapabilities.k5_platform_test_connection.output,
      execute: async (input: { officeId: string; connectionId: string; task?: 'chat' | 'extraction' | 'drafting' }) => platform.platformTestConnection(context, input),
    }),
    k5_platform_create_connection: createTool({
      id: 'k5_platform_create_connection',
      description: platformCapabilities.k5_platform_create_connection.description,
      inputSchema: platformCapabilities.k5_platform_create_connection.input,
      outputSchema: platformCapabilities.k5_platform_create_connection.output,
      execute: async (input: Parameters<typeof platform.platformCreateConnection>[1]) => platform.platformCreateConnection(context, input),
    }),
    k5_platform_update_connection: createTool({
      id: 'k5_platform_update_connection',
      description: platformCapabilities.k5_platform_update_connection.description,
      inputSchema: platformCapabilities.k5_platform_update_connection.input,
      outputSchema: platformCapabilities.k5_platform_update_connection.output,
      execute: async (input: Parameters<typeof platform.platformUpdateConnection>[1]) => platform.platformUpdateConnection(context, input),
    }),
    k5_platform_delete_connection: createTool({
      id: 'k5_platform_delete_connection',
      description: platformCapabilities.k5_platform_delete_connection.description,
      inputSchema: platformCapabilities.k5_platform_delete_connection.input,
      outputSchema: platformCapabilities.k5_platform_delete_connection.output,
      execute: async (input: { officeId: string; connectionId: string }) => platform.platformDeleteConnection(context, input),
    }),
  };
}

/** Short pt-BR line describing what a finished tool call did, stored with the conversation. */
export function toolSummary(name: string, result: unknown, failed: boolean): string {
  const labels: Record<string, string> = {
    k5_vault_list_cases: 'Consultou os casos do Cofre',
    k5_vault_create_case: 'Criou um caso no Cofre',
    k5_vault_update_case: 'Atualizou um caso no Cofre',
    k5_vault_delete_case: 'Removeu um caso do Cofre',
    k5_vault_list_documents: 'Consultou documentos do Cofre',
    k5_vault_get_document: 'Consultou um documento',
    k5_vault_update_document: 'Atualizou um documento',
    k5_vault_delete_document: 'Removeu um documento do Cofre',
    k5_vault_add_document_version: 'Adicionou versão a documento',
    k5_vault_download_document: 'Obteve download de documento',
    k5_vault_retry_ingestion: 'Reenviou documento para processamento',
    k5_vault_ingest_upload: 'Enviou upload para ingestão',
    k5_knowledge_search: 'Buscou trechos nos documentos',
    k5_knowledge_get_source: 'Consultou trecho de evidência',
    k5_knowledge_get_index_status: 'Consultou estado de indexação',
    k5_knowledge_reindex: 'Enfileirou reindexação',
    k5_runs_list: 'Consultou as tarefas',
    k5_runs_get: 'Consultou uma tarefa',
    k5_runs_cancel: 'Cancelou uma tarefa',
    k5_runs_retry: 'Reenviou uma tarefa',
    k5_documents_start_chronology: 'Iniciou uma cronologia',
    k5_documents_start_draft: 'Iniciou uma minuta',
    k5_citations_list_candidates: 'Consultou citações candidatas',
    k5_artifacts_get: 'Leu um documento gerado',
    k5_artifacts_update: 'Salvou uma nova versão do documento',
    k5_artifacts_list_versions: 'Consultou histórico de versões',
    k5_artifacts_restore_version: 'Restaurou versão de documento',
    k5_artifacts_export_docx: 'Exportou documento DOCX',
    k5_conversations_list: 'Consultou histórico de conversas',
    k5_conversations_get: 'Consultou uma conversa',
    k5_conversations_create: 'Criou uma nova conversa',
    k5_conversations_delete: 'Excluiu uma conversa',
    k5_context_set_sources: 'Definiu o escopo de documentos',
    k5_ui_open_resource: 'Abriu recurso na interface',
    k5_session_end_global: 'Encerrou todas as sessões',
    k5_platform_list_offices: 'Consultou escritórios na plataforma',
    k5_platform_list_connections: 'Consultou conexões de IA',
    k5_platform_test_connection: 'Testou conexão de IA',
    k5_platform_create_connection: 'Cadastrou conexão de IA',
    k5_platform_update_connection: 'Atualizou conexão de IA',
    k5_platform_delete_connection: 'Removeu conexão de IA',
  };
  const label = labels[name] ?? 'Executou uma operação';
  if (failed) return `${label}: não foi possível concluir`;
  const detail = describe(result);
  return detail ? `${label}: ${detail}` : label;
}

function describe(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as Record<string, unknown>;
  if (Array.isArray(value.sources)) return `${value.sources.length} trecho(s)`;
  if (Array.isArray(value.cases)) return `${value.cases.length} caso(s)`;
  if (Array.isArray(value.documents)) return `${value.documents.length} documento(s)`;
  if (Array.isArray(value.runs)) return `${value.runs.length} tarefa(s)`;
  if (Array.isArray(value.versions)) return `${value.versions.length} versão(ões)`;
  if (Array.isArray(value.conversations)) return `${value.conversations.length} conversa(s)`;
  if (Array.isArray(value.candidates)) return `${value.candidates.length} candidato(s)`;
  if (value.case && typeof value.case === 'object') return String((value.case as { name?: string }).name ?? '');
  if (value.run && typeof value.run === 'object') return String((value.run as { status?: string }).status ?? '');
  if (value.document && typeof value.document === 'object') return String((value.document as { name?: string }).name ?? '');
  if (value.artifact && typeof value.artifact === 'object') return String((value.artifact as { title?: string }).title ?? '');
  if (value.conversation && typeof value.conversation === 'object') return String((value.conversation as { title?: string }).title ?? '');
  return '';
}

/** Failures reach the model as a short, stable domain message; never a stack or a provider error. */
export function toolFailureMessage(error: unknown) {
  if (error instanceof CapabilityError) return `${error.code}: ${error.message}`;
  return 'INTERNAL: a operação não pôde ser concluída.';
}
