import 'server-only';
import { database } from './database';
import { objectStorage, StorageError } from './storage';
import { readMemory } from './agent-memory';

/**
 * The office's own data as a ZIP the person can keep: one JSON Lines file per kind of record and
 * the current original of every document in the Cofre. Columns are listed one by one, so tokens,
 * hashes, leases and other internals never leave, and a new column is not exported by accident.
 * Shared cases owned by another office are that office's data and stay out, and so does what a
 * participant keeps private in this office's cases: `visible` is the app's own visibility rule, bound
 * to the person exporting, so the ZIP holds exactly what they see in the Cofre.
 */
type Export = { file: string; table: string; columns: string[]; where?: string; visible?: string; byId?: boolean };

const EXPORTS: Export[] = [
  { file: 'clientes', table: 'crm_client', columns: ['id', 'name', 'email', 'phone', 'notes', 'stage', 'created_at', 'updated_at'] },
  { file: 'clientes-casos', table: 'crm_client_case', columns: ['client_id', 'case_id'], byId: false },
  { file: 'casos', table: 'vault_case', columns: ['id', 'name', 'description', 'client_name', 'client_document', 'client_email', 'client_phone', 'client_notes', 'created_at', 'updated_at'], where: 'deleted_at IS NULL' },
  { file: 'pastas', table: 'vault_folder', columns: ['id', 'case_id', 'parent_id', 'name', 'created_at', 'updated_at'], where: 'deleted_at IS NULL', visible: 'vault_folder_visible(id, ?)' },
  { file: 'documentos', table: 'vault_document', columns: ['id', 'case_id', 'folder_id', 'scope', 'original_name', 'mime_type', 'byte_size', 'status', 'created_at', 'updated_at'], where: 'deleted_at IS NULL', visible: 'lume_vault_visible(id, ?)' },
  { file: 'documentos-versoes', table: 'vault_document_version', columns: ['id', 'document_id', 'version', 'original_name', 'mime_type', 'byte_size', 'is_active', 'created_at'], visible: 'lume_vault_visible(document_id, ?, version)' },
  { file: 'agenda', table: 'agenda_activity', where: "visibility='personal'", columns: ['id', 'kind', 'title', 'notes', 'status', 'due_on', 'starts_at', 'ends_at', 'client_id', 'case_id', 'created_at', 'updated_at'] },
  { file: 'honorarios', table: 'honorario_agreement', columns: ['id', 'client_id', 'case_id', 'title', 'notes', 'pricing', 'created_at', 'cancelled_at', 'cancel_reason'] },
  { file: 'calculos', table: 'legal_calculation', columns: ['id', 'title', 'kind', 'version', 'total_cents', 'updated_at'] },
  { file: 'calculos-versoes', table: 'legal_calculation_version', columns: ['calculation_id', 'version', 'title', 'client_id', 'case_id', 'notes', 'input', 'result', 'created_at'], byId: false },
  { file: 'propostas-honorarios', table: 'fee_quote', columns: ['id', 'title', 'client_id', 'case_id', 'version', 'pricing', 'created_at', 'updated_at'] },
  { file: 'propostas-honorarios-versoes', table: 'fee_quote_version', columns: ['quote_id', 'version', 'snapshot', 'created_at'], byId: false },
  { file: 'propostas-honorarios-parcelas', table: 'fee_quote_billing', columns: ['quote_id', 'component', 'agreement_id', 'amount_cents', 'evidence'], byId: false },
  { file: 'honorarios-parcelas', table: 'honorario_installment', columns: ['id', 'agreement_id', 'number', 'due_on', 'amount_cents'] },
  { file: 'honorarios-recebimentos', table: 'honorario_receipt', columns: ['id', 'installment_id', 'amount_cents', 'received_on', 'method', 'notes', 'created_at'] },
  { file: 'honorarios-estornos', table: 'honorario_receipt_reversal', columns: ['receipt_id', 'reason', 'created_at'], byId: false },
  { file: 'honorarios-cobrancas-asaas', table: 'asaas_payment', columns: ['id', 'installment_id', 'environment', 'state', 'provider_payment_id', 'provider_status', 'amount_cents', 'due_on', 'invoice_url', 'created_at', 'updated_at'] },
  { file: 'conversas-lume', table: 'ai_conversation', columns: ['id', 'title', 'messages', 'created_at', 'updated_at'] },
  { file: 'documentos-lume', table: 'ai_artifact', columns: ['id', 'title', 'content', 'status', 'version', 'created_at', 'updated_at'] },
  { file: 'instrucoes-lume', table: 'agent_instruction', columns: ['id', 'title', 'content', 'applies_to', 'enabled', 'created_at', 'updated_at'] },
  { file: 'pesquisas', table: 'research_search', columns: ['id', 'theme', 'filters_json', 'created_at'] },
  { file: 'pesquisas-web', table: 'research_web_search', columns: ['id', 'query', 'mode', 'results_json', 'created_at'] },
  { file: 'pesquisa-perfis-de-caso', table: 'research_case_profile', columns: ['case_id', 'version', 'legal_question', 'objective', 'thesis', 'documented_facts_json', 'alleged_facts_json', 'gaps_json', 'updated_at'], byId: false },
  { file: 'pesquisa-referencias', table: 'research_case_reference', columns: ['id', 'case_id', 'material_version_id', 'purpose', 'notes', 'created_at', 'updated_at'], where: 'deleted_at IS NULL' },
  { file: 'pesquisa-avaliacoes', table: 'research_case_assessment', columns: ['id', 'case_id', 'material_version_id', 'status', 'result_json', 'reason', 'created_at'] },
  { file: 'processos', table: 'judicial_case_link', columns: ['id', 'case_id', 'cnj_number', 'native_number', 'degree', 'confirmation', 'status', 'created_at'] },
  { file: 'publicacoes', table: 'judicial_publication', columns: ['id', 'link_id', 'cnj_number', 'edition', 'page', 'body', 'made_available_on', 'published_on', 'created_at'] },
  { file: 'whatsapp-conversas', table: 'whatsapp_thread', columns: ['id', 'participant_name', 'last_message_at'] },
  { file: 'whatsapp-mensagens', table: 'whatsapp_message', columns: ['id', 'thread_id', 'direction', 'text', 'status', 'created_at'] },
  { file: 'portal-cliente-acessos', table: 'client_portal_access', columns: ['id', 'client_id', 'email', 'accepted_at', 'revoked_at', 'created_at'] },
  { file: 'portal-cliente-arquivos', table: 'client_portal_file', columns: ['id', 'client_id', 'kind', 'name', 'mime_type', 'byte_size', 'created_at', 'revoked_at'] },
  { file: 'creditos', table: 'credit_entry', columns: ['id', 'kind', 'amount', 'balance_after', 'description', 'created_at'] },
  { file: 'pagamentos', table: 'billing_checkout', columns: ['id', 'amount', 'status', 'receipt_url', 'created_at', 'paid_at', 'period_start', 'period_end'] },
];

const PAGE = 200;
const UNPAGED_LIMIT = 50_000;
const encoder = new TextEncoder();

/** One record per line, read a page at a time so a large history never sits whole in memory. */
function jsonLines(owner: { officeId: string; userId: string }, spec: Export): ReadableStream<Uint8Array> {
  const columns = spec.columns.map(column => `"${column}"`).join(',');
  const where = ['office_id = ?', spec.where, spec.visible].filter(Boolean).join(' AND ');
  const scope = spec.visible ? [owner.officeId, owner.userId] : [owner.officeId];
  let after: string | null = null;
  let done = false;
  return new ReadableStream({
    async pull(controller) {
      if (done) { controller.close(); return; }
      const rows = spec.byId === false
        ? await database.prepare(`SELECT ${columns} FROM ${spec.table} WHERE ${where} LIMIT ${UNPAGED_LIMIT}`).all<Record<string, unknown>>(...scope)
        : await database.prepare(`SELECT ${columns} FROM ${spec.table} WHERE ${where}${after === null ? '' : ' AND id > ?'} ORDER BY id LIMIT ${PAGE}`)
          .all<Record<string, unknown>>(...(after === null ? scope : [...scope, after]));
      if (rows.length) controller.enqueue(encoder.encode(rows.map(row => JSON.stringify(row)).join('\n') + '\n'));
      if (spec.byId === false || rows.length < PAGE) done = true;
      else after = String(rows.at(-1)!.id);
      if (done) controller.close();
    },
  });
}

/** A path segment that every unzip tool accepts, in the person's own words where possible. */
export function safeSegment(name: string, fallback: string) {
  const clean = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || fallback;
}

const README = (officeName: string, exportedAt: string) => `Exportação do Lume — ${officeName}
Gerada em ${exportedAt}.

dados/   Um arquivo JSON Lines por tipo de registro (um registro por linha), com os
         identificadores que ligam clientes, casos, pastas, documentos e honorários.
cofre/   O arquivo original atual de cada documento do Cofre, por caso. A Biblioteca
         fica em cofre/Biblioteca. Versões anteriores estão listadas em
         dados/documentos-versoes.jsonl.
memoria-lume.md   A memória de trabalho do Lume sobre você, quando existir.

Não fazem parte da exportação: senhas, tokens e credenciais de integrações, índices de
busca e textos extraídos (podem ser gerados de novo a partir dos originais), registros
técnicos e dados de casos de outros escritórios em que você participa.
`;

export type ExportEntry = { name: string; input: string | ReadableStream<Uint8Array>; lastModified?: Date };

export async function* officeExportEntries(owner: { officeId: string; userId: string }): AsyncGenerator<ExportEntry> {
  const office = await database.prepare('SELECT name FROM office WHERE id=?').get<{ name: string }>(owner.officeId);
  yield { name: 'LEIA-ME.txt', input: README(office?.name ?? 'Escritório', new Date().toISOString()) };
  for (const spec of EXPORTS) yield { name: `dados/${spec.file}.jsonl`, input: jsonLines(owner, spec) };
  const memory = await readMemory(owner).catch(() => ({ memory: '' }));
  if (memory.memory.trim()) yield { name: 'memoria-lume.md', input: memory.memory };

  const cases = new Map((await database.prepare('SELECT id, name FROM vault_case WHERE office_id=? AND deleted_at IS NULL')
    .all<{ id: string; name: string }>(owner.officeId)).map(row => [row.id, safeSegment(row.name, row.id)]));
  const storage = await objectStorage();
  const used = new Set<string>();
  let after = '';
  while (true) {
    const documents = await database.prepare(`SELECT id, case_id AS "caseId", original_name AS name, stored_name AS "storedName", updated_at AS "updatedAt"
      FROM vault_document WHERE office_id=? AND deleted_at IS NULL AND lume_vault_visible(id, ?) AND id > ? ORDER BY id LIMIT ?`)
      .all<{ id: string; caseId: string | null; name: string; storedName: string; updatedAt: string | Date }>(owner.officeId, owner.userId, after, PAGE);
    for (const document of documents) {
      const folder = document.caseId ? cases.get(document.caseId) ?? document.caseId : 'Biblioteca';
      let path = `cofre/${folder}/${safeSegment(document.name, document.id)}`;
      // Two documents may share a name; the second keeps both by naming itself after its id.
      if (used.has(path.toLowerCase())) path = `cofre/${folder}/${document.id.slice(0, 8)}-${safeSegment(document.name, document.id)}`;
      used.add(path.toLowerCase());
      try {
        const input = storage.getStream ? await storage.getStream(document.storedName) : new Blob([new Uint8Array(await storage.get(document.storedName))]).stream();
        yield { name: path, input, lastModified: new Date(document.updatedAt) };
      } catch (error) {
        // One unreadable original must not cost the person the rest of the export; it says which.
        if (!(error instanceof StorageError)) throw error;
        yield { name: `${path}.indisponivel.txt`, input: `O original de "${document.name}" (${document.id}) não pôde ser lido nesta exportação. Tente exportar de novo ou baixe o documento pelo Cofre.\n` };
      }
    }
    if (documents.length < PAGE) break;
    after = documents.at(-1)!.id;
  }
}
