import type { Capability } from '@/lib/capabilities/contracts';

/**
 * What Lume is doing right now, in one short line under the answer. The chat turn sends it as a
 * transient part (never stored), so it works with any provider, whether or not it streams reasoning.
 */
export type ChatStatus = { label: string };

/** The product area a tool works in: its capability's module, or the provider's own web search. */
export type ToolModule = Capability['module'] | 'web';

export const THINKING = 'Pensando…';
export const WRITING = 'Escrevendo…';
export const CHECKING_CITATIONS = 'Conferindo as citações…';

const actions: Record<string, string> = {
  web_search: 'Pesquisando na web…',
  updateWorkingMemory: 'Anotando na memória…',
  k5_research_score_jurisprudence: 'Avaliando a jurisprudência…',
  k5_artifacts_create: 'Redigindo o documento…',
  k5_artifacts_edit: 'Redigindo o documento…',
  k5_artifacts_update: 'Redigindo o documento…',
  k5_documents_start_chronology: 'Iniciando a cronologia…',
  k5_documents_start_draft: 'Iniciando a minuta…',
  k5_whatsapp_send: 'Preparando resposta no WhatsApp…',
  k5_ui_open_resource: 'Abrindo…',
};

/**
 * Where each group of tools works, named as the person knows it, and the capability module it
 * belongs to. The prefix stands in for the catalog so the browser never loads every tool's schema;
 * tests/chat-status.test.ts keeps it equal to `capabilities[name].module`.
 */
const places: ReadonlyArray<readonly [prefix: string, place: string, module: ToolModule]> = [
  ['k5_honorarios_', 'os honorários', 'honorarios'], ['k5_calc_', 'os cálculos', 'calc'],
  ['k5_messages_', 'as mensagens', 'messages'], ['k5_collaboration_', 'os associados e os convites', 'collaboration'],
  ['k5_notifications_', 'as notificações', 'notifications'], ['k5_agent_settings_', 'as preferências do Lume', 'agent_settings'],
  ['k5_help_', 'a documentação do Lume', 'help'],
  ['k5_vault_', 'o Cofre', 'vault'], ['k5_knowledge_', 'os documentos do Cofre', 'knowledge'], ['k5_context_', 'as fontes da conversa', 'knowledge'],
  ['k5_agenda_', 'a Agenda', 'agenda'], ['k5_crm_', 'os clientes', 'agenda'], ['k5_artifacts_', 'os documentos', 'artifacts'],
  ['k5_runs_', 'as tarefas de documentos', 'runs'], ['k5_documents_', 'as tarefas de documentos', 'runs'],
  ['k5_citations_', 'as citações', 'citations'], ['k5_research_', 'a Pesquisa', 'research'], ['k5_judicial_', 'os processos', 'judicial'],
  ['k5_conversations_', 'as conversas', 'conversations'], ['k5_memory_', 'a memória', 'memory'], ['k5_ui_', 'a interface', 'ui'],
  ['k5_google_', 'a conexão Google', 'google'], ['k5_gmail_', 'os e-mails', 'google'], ['k5_calendar_', 'a agenda Google', 'google'],
  ['k5_drive_', 'o Google Drive', 'google'], ['k5_docs_', 'o Google Docs', 'google'], ['k5_whatsapp_', 'o WhatsApp', 'whatsapp'],
  ['k5_platform_', 'a plataforma', 'platform'],
];

const placeOf = (name: string) => places.find(([prefix]) => name.startsWith(prefix));

/** The line shown while a tool runs: "Consultando o Cofre…", "Atualizando a Agenda…". */
export function toolStatus(name: string, effect: 'read' | 'write' | undefined): string {
  if (actions[name]) return actions[name];
  const place = placeOf(name)?.[1];
  if (!place) return 'Trabalhando…';
  return `${effect === 'write' ? 'Atualizando' : 'Consultando'} ${place}…`;
}

/** The module a tool works in; null for the Lume's own plumbing. */
export function toolModule(name: string): ToolModule | null {
  if (name === 'web_search') return 'web';
  if (name === 'updateWorkingMemory') return 'memory';
  return placeOf(name)?.[2] ?? null;
}

/**
 * The module behind a status line, so the running step of a plan shows where it works. The stream
 * sends only the label, never the tool's name, so this reads the label back.
 */
export function statusModule(label: string): ToolModule | null {
  const action = Object.entries(actions).find(([, text]) => text === label)?.[0];
  if (action) return toolModule(action);
  const place = /^(?:Consultando|Atualizando) (.+)…$/.exec(label)?.[1];
  return places.find(([, name]) => name === place)?.[2] ?? null;
}
