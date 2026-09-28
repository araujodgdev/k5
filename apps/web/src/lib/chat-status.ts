/**
 * What Tises is doing right now, in one short line under the answer. The chat turn sends it as a
 * transient part (never stored), so it works with any provider, whether or not it streams reasoning.
 */
export type ChatStatus = { label: string };

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

/** Where each group of tools works, named as the person knows it. */
const places: ReadonlyArray<readonly [prefix: string, place: string]> = [
  ['k5_vault_', 'o Cofre'], ['k5_knowledge_', 'os documentos do Cofre'], ['k5_context_', 'as fontes da conversa'],
  ['k5_agenda_', 'a Agenda'], ['k5_crm_', 'os clientes'], ['k5_artifacts_', 'os documentos'], ['k5_runs_', 'as tarefas de documentos'],
  ['k5_citations_', 'as citações'], ['k5_research_', 'a Pesquisa'], ['k5_judicial_', 'os processos'], ['k5_conversations_', 'as conversas'],
  ['k5_memory_', 'a memória'], ['k5_google_', 'a conexão Google'], ['k5_gmail_', 'os e-mails'], ['k5_calendar_', 'a agenda Google'],
  ['k5_drive_', 'o Google Drive'], ['k5_docs_', 'o Google Docs'], ['k5_whatsapp_', 'o WhatsApp'],
];

/** The line shown while a tool runs: "Consultando o Cofre…", "Atualizando a Agenda…". */
export function toolStatus(name: string, effect: 'read' | 'write' | undefined): string {
  if (actions[name]) return actions[name];
  const place = places.find(([prefix]) => name.startsWith(prefix))?.[1];
  if (!place) return 'Trabalhando…';
  return `${effect === 'write' ? 'Atualizando' : 'Consultando'} ${place}…`;
}
