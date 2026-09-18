import { z } from 'zod';
import type { OfficeRole } from '@/lib/offices';

/**
 * Serializable contract of every operation the product exposes to an agent.
 * No server import belongs here: the browser adapter will read the same file.
 * The output schema is the DTO fence — Zod strips whatever it does not declare,
 * so an internal field added to a row never reaches the model by accident.
 */
export type CapabilitySurface = 'agent' | 'webmcp';

export type Capability = {
  module: 'vault' | 'knowledge' | 'runs' | 'artifacts' | 'conversations' | 'citations' | 'ui' | 'session' | 'platform';
  description: string;
  effect: 'read' | 'write';
  roles: readonly OfficeRole[];
  input: z.ZodType;
  output: z.ZodType;
  /** Where this capability may be published. Absent means both adapters; [] means neither. */
  publish?: readonly CapabilitySurface[];
};

const readers: readonly OfficeRole[] = ['administrator', 'lawyer', 'reviewer'];
const writers: readonly OfficeRole[] = ['administrator', 'lawyer'];

const identifier = z.string().min(1).max(64);
const uuid = z.string().uuid();
/**
 * Supplied by the caller so a retried tool call, a regenerated turn or a reconnect resolves to the
 * same write. It is part of the contract precisely so the schema does not strip it before the
 * executor can see it.
 */
const idempotencyKey = z.string().min(8).max(128).optional();
const documentIds = z.array(identifier).min(1).max(100);

export const caseDto = z.object({ id: z.string(), name: z.string(), createdAt: z.string() });
export const documentDto = z.object({
  id: z.string(), name: z.string(), caseId: z.string().nullable(), caseName: z.string().nullable(),
  scope: z.enum(['library', 'case']), status: z.enum(['queued', 'processing', 'ready', 'failed']),
  progress: z.number(), errorMessage: z.string().nullable(), sourceCount: z.number(), createdAt: z.string(),
  version: z.number().optional(),
});
export const runDto = z.object({
  id: z.string(), kind: z.enum(['chronology', 'draft']), status: z.string(), progress: z.number(),
  error: z.string().nullable(), artifactId: z.string().nullable(), createdAt: z.string(),
});
export const sourceDto = z.object({
  sourceId: z.string(), documentId: z.string(), documentName: z.string(), sourceLabel: z.string(), text: z.string(),
  adjacentContext: z.string().optional(),
});
export const artifactDto = z.object({
  id: z.string(), title: z.string(), content: z.string(), version: z.number(), status: z.string(),
  validationIssues: z.array(z.string()),
});
export const conversationDto = z.object({ id: z.string(), title: z.string(), updatedAt: z.string() });
export const citationCandidateDto = z.object({ id: z.string(), documentId: z.string(), sourceLabel: z.string(), text: z.string() });
export const artifactVersionDto = z.object({ version: z.number(), title: z.string(), createdAt: z.string() });

export const capabilities = {
  k5_vault_list_cases: {
    module: 'vault', effect: 'read', roles: readers,
    description: 'Lista os casos do Cofre do escritório, do mais recente ao mais antigo.',
    input: z.object({}), output: z.object({ cases: z.array(caseDto) }),
  },
  k5_vault_create_case: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Cria um caso no Cofre. Se já existir um caso com o mesmo nome, devolve o existente em vez de duplicar.',
    input: z.object({ name: z.string().trim().min(2).max(180).describe('Nome do caso, por exemplo "Silva vs. Construtora Horizonte".'), idempotencyKey }),
    output: z.object({ case: caseDto, created: z.boolean() }),
  },
  k5_vault_update_case: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Atualiza o nome de um caso existente no Cofre.',
    input: z.object({ caseId: identifier, name: z.string().trim().min(2).max(180), idempotencyKey }),
    output: z.object({ case: caseDto }),
  },
  k5_vault_delete_case: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Remove um caso do Cofre. Requer confirmação/aprovação explícita e reatribuição dos documentos vinculados.',
    input: z.object({ caseId: identifier, targetCaseId: identifier.optional(), approvalId: z.string().optional(), idempotencyKey }),
    output: z.object({ success: z.boolean() }),
  },
  k5_vault_list_documents: {
    module: 'vault', effect: 'read', roles: readers,
    description: 'Lista documentos do Cofre com metadados e estado de processamento. Não devolve o conteúdo; para conteúdo use k5_knowledge_search.',
    input: z.object({
      scope: z.enum(['library', 'case']).optional().describe('Filtra por biblioteca ou por casos.'),
      caseId: identifier.optional().describe('Identificador de um caso listado por k5_vault_list_cases.'),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    output: z.object({ documents: z.array(documentDto), total: z.number() }),
  },
  k5_vault_get_document: {
    module: 'vault', effect: 'read', roles: readers,
    description: 'Consulta um documento do Cofre e o estado do processamento.',
    input: z.object({ documentId: identifier }), output: z.object({ document: documentDto }),
  },
  k5_vault_update_document: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Atualiza o nome ou move o documento entre caso e biblioteca.',
    input: z.object({
      documentId: identifier,
      name: z.string().trim().min(1).max(255).optional(),
      caseId: identifier.nullable().optional(),
      idempotencyKey,
    }),
    output: z.object({ document: documentDto }),
  },
  k5_vault_delete_document: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Remove um documento do Cofre com tombstone imediato nos índices e consultas. Requer aprovação explícita.',
    input: z.object({ documentId: identifier, approvalId: z.string().optional(), idempotencyKey }),
    output: z.object({ success: z.boolean() }),
  },
  k5_vault_add_document_version: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Adiciona uma nova versão imutável a um documento existente via referência de upload.',
    input: z.object({ documentId: identifier, uploadRef: uuid.describe('Referência devolvida pelo envio de arquivo.'), idempotencyKey }),
    output: z.object({ document: documentDto, version: z.number() }),
  },
  k5_vault_download_document: {
    module: 'vault', effect: 'read', roles: readers,
    description: 'Obtém a rota autenticada e metadados para download do documento original.',
    input: z.object({ documentId: identifier }),
    output: z.object({ downloadUrl: z.string(), name: z.string(), mimeType: z.string() }),
  },
  k5_vault_retry_ingestion: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Reenvia para processamento um documento cuja extração falhou.',
    input: z.object({ documentId: identifier, idempotencyKey }), output: z.object({ document: documentDto }),
  },
  k5_vault_ingest_upload: {
    module: 'vault', effect: 'write', roles: writers,
    description: 'Confirma um upload prévio e enfileira a ingestão no Cofre.',
    input: z.object({
      uploadRef: uuid.describe('Referência devolvida pelo envio de arquivo; o agente nunca informa um caminho.'),
      scope: z.enum(['library', 'case']),
      caseId: identifier.optional(),
      idempotencyKey,
    }),
    output: z.object({ document: documentDto }),
  },
  k5_knowledge_search: {
    module: 'knowledge', effect: 'read', roles: readers,
    description: 'Busca trechos nos documentos autorizados e devolve as fontes com a localização de origem. Informe os documentos do escopo da conversa.',
    input: z.object({
      query: z.string().trim().min(2).max(500).describe('Pergunta ou termos a buscar, em português.'),
      documentIds: documentIds.describe('Documentos autorizados para esta busca.'),
      limit: z.number().int().min(1).max(12).default(8),
    }),
    output: z.object({
      sources: z.array(sourceDto),
      degraded: z.boolean().describe('Verdadeiro quando a busca foi apenas lexical.'),
      degradedReason: z.string().optional().describe('Por que a busca semântica não foi usada.'),
    }),
  },
  k5_knowledge_get_source: {
    module: 'knowledge', effect: 'read', roles: readers,
    description: 'Consulta um trecho específico de evidência com contexto adjacente limitado e localização precisa.',
    input: z.object({ documentId: identifier, stableReference: z.string().min(1).max(120) }),
    output: z.object({ source: sourceDto }),
  },
  k5_knowledge_get_index_status: {
    module: 'knowledge', effect: 'read', roles: readers,
    description: 'Consulta o estado de indexação lexical e semântica de um documento.',
    input: z.object({ documentId: identifier }),
    output: z.object({
      documentId: z.string(), status: z.string(), extractionStatus: z.string(),
      indexingStatus: z.string().describe('Estado da indexação semântica, separado da extração.'),
      indexedChunks: z.number(), totalChunks: z.number(),
      vectorIndexed: z.boolean(), generationId: z.string().nullable(),
    }),
  },
  k5_knowledge_reindex: {
    module: 'knowledge', effect: 'write', roles: writers,
    description: 'Enfileira reindexação semântica e lexical de um documento sem refazer OCR existente.',
    input: z.object({ documentId: identifier, idempotencyKey }),
    output: z.object({ enqueued: z.boolean(), message: z.string(), generationId: z.string().nullable() }),
  },
  k5_runs_list: {
    module: 'runs', effect: 'read', roles: readers,
    description: 'Lista as tarefas de cronologia e minuta do usuário, com estado e progresso.',
    input: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
    output: z.object({ runs: z.array(runDto) }),
  },
  k5_runs_get: {
    module: 'runs', effect: 'read', roles: readers,
    description: 'Consulta o estado de uma tarefa. Use uma vez por pergunta; a tarefa continua em segundo plano.',
    input: z.object({ runId: identifier }), output: z.object({ run: runDto }),
  },
  k5_runs_cancel: {
    module: 'runs', effect: 'write', roles: writers,
    description: 'Cancela uma tarefa na fila ou em execução.',
    input: z.object({ runId: identifier, idempotencyKey }), output: z.object({ run: runDto }),
  },
  k5_runs_retry: {
    module: 'runs', effect: 'write', roles: writers,
    description: 'Recoloca na fila uma tarefa que falhou.',
    input: z.object({ runId: identifier, idempotencyKey }), output: z.object({ run: runDto }),
  },
  k5_documents_start_chronology: {
    module: 'runs', effect: 'write', roles: writers,
    description: 'Inicia a revisão exaustiva dos documentos escolhidos e monta uma cronologia dos fatos. Devolve a tarefa; o resultado fica pronto em segundo plano.',
    input: z.object({
      documentIds, instructions: z.string().trim().min(1).max(12000).describe('O que a cronologia deve priorizar.'), idempotencyKey,
    }),
    output: z.object({ run: runDto }),
  },
  k5_documents_start_draft: {
    module: 'runs', effect: 'write', roles: writers,
    description: 'Inicia a redação de uma minuta a partir dos documentos escolhidos. Sem citações jurídicas: autoridades exigem seleção humana na tela.',
    input: z.object({
      documentIds, instructions: z.string().trim().min(1).max(12000).describe('O pedido da minuta.'),
      templateId: identifier.optional().describe('Documento do Cofre usado apenas como modelo de estilo.'), idempotencyKey,
    }),
    output: z.object({ run: runDto }),
  },
  k5_citations_list_candidates: {
    module: 'citations', effect: 'read', roles: readers,
    description: 'Lista passagens candidatas a citação jurídica nos documentos autorizados para avaliação humana.',
    input: z.object({ documentIds }),
    output: z.object({ candidates: z.array(citationCandidateDto) }),
  },
  k5_artifacts_get: {
    module: 'artifacts', effect: 'read', roles: readers,
    description: 'Lê um documento gerado por uma tarefa, com versão e pendências de revisão.',
    input: z.object({ artifactId: identifier }), output: z.object({ artifact: artifactDto }),
  },
  k5_artifacts_update: {
    module: 'artifacts', effect: 'write', roles: writers,
    description: 'Salva uma nova versão de um documento gerado. Exige a versão atual; se o documento tiver mudado, a gravação é recusada.',
    input: z.object({
      artifactId: identifier, title: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(400_000), version: z.number().int().positive().describe('Versão lida em k5_artifacts_get.'), idempotencyKey,
    }),
    output: z.object({ artifact: artifactDto }),
  },
  k5_artifacts_list_versions: {
    module: 'artifacts', effect: 'read', roles: readers,
    description: 'Lista o histórico de versões salvas de um documento gerado.',
    input: z.object({ artifactId: identifier }),
    output: z.object({ versions: z.array(artifactVersionDto) }),
  },
  k5_artifacts_restore_version: {
    module: 'artifacts', effect: 'write', roles: writers,
    description: 'Restaura uma versão anterior de um documento gerado, gerando uma nova versão correspondente.',
    input: z.object({ artifactId: identifier, version: z.number().int().positive(), idempotencyKey }),
    output: z.object({ artifact: artifactDto }),
  },
  k5_artifacts_export_docx: {
    module: 'artifacts', effect: 'read', roles: readers,
    description: 'Obtém link autenticado de exportação DOCX para um documento gerado.',
    input: z.object({ artifactId: identifier }),
    output: z.object({ downloadUrl: z.string(), fileName: z.string() }),
  },
  k5_conversations_list: {
    module: 'conversations', effect: 'read', roles: readers,
    description: 'Lista as conversas do usuário autenticado no escritório atual.',
    input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    output: z.object({ conversations: z.array(conversationDto) }),
  },
  k5_conversations_get: {
    module: 'conversations', effect: 'read', roles: readers,
    description: 'Consulta uma conversa específica e seu histórico.',
    input: z.object({ conversationId: identifier }),
    output: z.object({ conversation: conversationDto, messageCount: z.number() }),
  },
  k5_conversations_create: {
    module: 'conversations', effect: 'write', roles: writers,
    description: 'Cria uma nova conversa no escritório atual.',
    input: z.object({ title: z.string().trim().min(1).max(120).optional(), idempotencyKey }),
    output: z.object({ conversation: conversationDto }),
  },
  k5_conversations_delete: {
    module: 'conversations', effect: 'write', roles: writers,
    description: 'Exclui uma conversa existente se não estiver ocupada.',
    input: z.object({ conversationId: identifier, idempotencyKey }),
    output: z.object({ success: z.boolean() }),
  },
  k5_context_set_sources: {
    module: 'knowledge', effect: 'read', roles: readers,
    description: 'Define ou atualiza o escopo de documentos vinculados à conversa atual.',
    input: z.object({ conversationId: identifier.optional(), documentIds }),
    output: z.object({ success: z.boolean(), documentIds: z.array(z.string()) }),
  },
  k5_ui_open_resource: {
    module: 'ui', effect: 'read', roles: readers,
    description: 'Resolve a URL segura da interface K5 para abrir um recurso no navegador.',
    input: z.object({
      resourceType: z.enum(['case', 'document', 'run', 'artifact', 'vault']),
      resourceId: identifier.optional(),
    }),
    output: z.object({ path: z.string() }),
  },
  k5_session_end_global: {
    module: 'session', effect: 'write', roles: readers,
    description: 'Encerra imediatamente todas as sessões ativas da conta em todos os dispositivos.',
    input: z.object({}),
    output: z.object({ success: z.boolean(), message: z.string() }),
    // Terminal and irreversible, and a document the agent is reading is untrusted input. The
    // interface keeps the button; neither adapter gets a tool that can log the person out.
    publish: [],
  },
} as const satisfies Record<string, Capability>;

export type CapabilityName = keyof typeof capabilities;
export type CapabilityInput<N extends CapabilityName> = z.input<typeof capabilities[N]['input']>;
export type CapabilityOutput<N extends CapabilityName> = z.output<typeof capabilities[N]['output']>;

export const capabilityNames = Object.keys(capabilities) as CapabilityName[];

export function capabilitiesForRole(role: OfficeRole): CapabilityName[] {
  return capabilityNames.filter((name) => (capabilities[name].roles as readonly OfficeRole[]).includes(role));
}

/**
 * Role decides what a person may do; `publish` decides which adapter may offer it. A capability
 * can be legitimate for this role and still have no business being a tool an agent can call.
 */
export function publishedCapabilitiesForRole(role: OfficeRole, surface: CapabilitySurface): CapabilityName[] {
  return capabilitiesForRole(role).filter((name) => {
    const published = (capabilities[name] as Capability).publish;
    return published === undefined || published.includes(surface);
  });
}

// Separate catalog for platform administrator operations (Section 5.3)
export const platformCapabilities = {
  k5_platform_list_offices: {
    module: 'platform', effect: 'read',
    description: 'Lista os escritórios cadastrados na plataforma com métricas básicas.',
    input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    output: z.object({ offices: z.array(z.object({ id: z.string(), name: z.string(), memberCount: z.number(), createdAt: z.string() })) }),
  },
  k5_platform_list_connections: {
    module: 'platform', effect: 'read',
    description: 'Lista as conexões de provedores de IA de um escritório específico.',
    input: z.object({ officeId: identifier }),
    output: z.object({ connections: z.array(z.object({ id: z.string(), name: z.string(), provider: z.string(), enabled: z.boolean(), apiKeyHint: z.string() })) }),
  },
  k5_platform_test_connection: {
    module: 'platform', effect: 'read',
    description: 'Testa a conectividade de um provedor de IA cadastrado.',
    input: z.object({ officeId: identifier, connectionId: identifier, task: z.enum(['chat', 'extraction', 'drafting']).optional() }),
    output: z.object({ ok: z.boolean(), message: z.string(), modelId: z.string().optional() }),
  },
  k5_platform_create_connection: {
    module: 'platform', effect: 'write',
    description: 'Cadastra uma nova conexão de IA para um escritório com credenciais cifradas.',
    input: z.object({
      officeId: identifier,
      name: z.string().trim().min(2).max(80),
      provider: z.enum(['openai', 'anthropic', 'google', 'deepseek', 'inception', 'openrouter', 'vercel']),
      // Opaque reference to a key a human already submitted through the platform form.
      secretRef: z.string().uuid().describe('Referência de segredo emitida pelo formulário da plataforma.'),
      enabled: z.boolean().optional(),
      models: z.object({
        chat: z.string().max(160).nullable().optional(),
        extraction: z.string().max(160).nullable().optional(),
        drafting: z.string().max(160).nullable().optional(),
        embedding: z.string().max(160).nullable().optional(),
      }).optional(),
    }),
    output: z.object({
      connection: z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        enabled: z.boolean(),
        apiKeyHint: z.string(),
      }),
    }),
  },
  k5_platform_update_connection: {
    module: 'platform', effect: 'write',
    description: 'Atualiza configurações, modelos ou rotação de chave de uma conexão de IA existente.',
    input: z.object({
      officeId: identifier,
      connectionId: identifier,
      name: z.string().trim().min(2).max(80).optional(),
      provider: z.enum(['openai', 'anthropic', 'google', 'deepseek', 'inception', 'openrouter', 'vercel']).optional(),
      secretRef: z.string().uuid().optional().describe('Referência de segredo emitida pelo formulário da plataforma; obrigatória apenas ao rotacionar a chave.'),
      enabled: z.boolean().optional(),
      models: z.object({
        chat: z.string().max(160).nullable().optional(),
        extraction: z.string().max(160).nullable().optional(),
        drafting: z.string().max(160).nullable().optional(),
        embedding: z.string().max(160).nullable().optional(),
      }).optional(),
    }),
    output: z.object({
      connection: z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        enabled: z.boolean(),
        apiKeyHint: z.string(),
      }),
    }),
  },
  k5_platform_delete_connection: {
    module: 'platform', effect: 'write',
    description: 'Exclui uma conexão de IA cadastrada no escritório.',
    input: z.object({ officeId: identifier, connectionId: identifier }),
    output: z.object({ success: z.boolean() }),
  },
} as const;

export type PlatformCapabilityName = keyof typeof platformCapabilities;
