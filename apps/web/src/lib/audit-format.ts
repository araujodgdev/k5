import type { GoogleAction } from './google/policy';

/*
 * How audit rows read on screen. Office rows are a sentence after the actor's name ("Ana enviou um
 * e-mail"); platform rows name the action on their own, because the actor sits on a line below.
 */

export type OfficeAuditSource = 'judicial' | 'collaboration' | 'google' | 'ads' | 'knowledge';
export type AuditOutcome = 'ok' | 'denied' | 'error' | 'pending' | 'unknown';
export type AuditActorKind = 'user' | 'agent' | 'worker';

export const officeAuditFilters = [
  { slug: '', label: 'Tudo' },
  { slug: 'judicial', label: 'Processos' },
  { slug: 'collaboration', label: 'Acessos' },
  { slug: 'google', label: 'Google' },
  { slug: 'ads', label: 'Anúncios' },
  { slug: 'knowledge', label: 'Buscas' },
] as const satisfies readonly { slug: OfficeAuditSource | ''; label: string }[];

export const officeAuditSourceLabels: Record<OfficeAuditSource, string> = {
  judicial: 'Processos', collaboration: 'Acessos', google: 'Google', ads: 'Anúncios', knowledge: 'Buscas',
};

export const auditOutcomeLabels: Record<AuditOutcome, string> = {
  ok: 'Concluído', denied: 'Negado', error: 'Falhou', pending: 'Em andamento', unknown: 'Sem confirmação',
};

// Shared with the case's own "Histórico de acessos", so both screens say the same thing.
export const collaborationActions: Record<string, (target: string | null) => string> = {
  'invitation.created': target => target ? `criou um convite para ${target}` : 'criou um convite',
  'invitation.accepted': () => 'aceitou o convite',
  'invitation.declined': () => 'recusou o convite',
  'invitation.revoked': target => target ? `cancelou o convite de ${target}` : 'cancelou um convite',
  'associate.removed': target => `removeu ${target ?? 'uma pessoa'} dos associados`,
  'participant.added': target => `incluiu ${target ?? 'uma pessoa'} no caso`,
  'participant.removed': target => `removeu ${target ?? 'uma pessoa'} do caso`,
};
export const collaborationLine = (action: string, target: string | null) => collaborationActions[action]?.(target) ?? `${action} ${target ?? ''}`.trim();

const judicialActions: Record<string, string> = {
  'judicial.link_case': 'pediu o acompanhamento de um processo no tribunal',
  'judicial.link_confirmed': 'confirmou o acompanhamento de um processo no tribunal',
  'judicial.link_rejected': 'rejeitou o acompanhamento de um processo no tribunal',
  'judicial.unlink_case': 'parou de acompanhar um processo no tribunal',
  'judicial.open_publication': 'abriu uma publicação',
  'judicial.request_refresh': 'pediu uma nova consulta ao tribunal',
  'judicial.collect': 'consultou o tribunal',
};

const googleLines: Record<GoogleAction, string> = {
  'gmail.draft': 'salvou um rascunho de e-mail',
  'gmail.send': 'enviou um e-mail',
  'gmail.send_attachments': 'enviou anexos por e-mail',
  'calendar.create': 'criou um evento na Agenda do Google',
  'calendar.update': 'alterou um evento na Agenda do Google',
  'calendar.cancel': 'cancelou um evento na Agenda do Google',
  'calendar.respond': 'respondeu a um convite da Agenda do Google',
  'docs.edit': 'alterou um documento do Google Docs',
  'drive.rename': 'renomeou um arquivo do Drive',
  'drive.replace': 'enviou uma nova versão de um arquivo do Drive',
  'drive.share': 'alterou o acesso a um arquivo do Drive',
};

const adsActions: Record<string, (account: string | null) => string> = {
  'ads.connected': account => account ? `conectou a conta de anúncios ${account}` : 'conectou uma conta de anúncios',
  'ads.verified': account => account ? `verificou a conta de anúncios ${account}` : 'verificou uma conta de anúncios',
  'ads.disconnected': account => account ? `desconectou a conta de anúncios ${account}` : 'desconectou uma conta de anúncios',
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What the actor did, as the rest of a sentence that starts with their name. */
export function officeAuditLine(entry: { source: OfficeAuditSource; action: string; subject: string | null; targetName: string | null }): string {
  switch (entry.source) {
    case 'judicial': return judicialActions[entry.action] ?? entry.action;
    case 'collaboration': {
      const line = collaborationLine(entry.action, entry.targetName);
      return entry.subject && entry.action.startsWith('participant.') ? `${line} ${entry.subject}` : line;
    }
    case 'google': {
      const action = entry.action.slice('google.'.length) as GoogleAction;
      return googleLines[action] ?? entry.action;
    }
    case 'ads': return adsActions[entry.action]?.(entry.subject) ?? entry.action;
    case 'knowledge': {
      const sources = Number(entry.subject ?? 0);
      return sources > 0 ? `buscou no Cofre e usou ${plural(sources, 'fonte', 'fontes')}` : 'buscou no Cofre e não encontrou fontes';
    }
  }
}

/** Who acted: the person, the person through the Lume, or the platform's own scheduled work. */
export function auditActor(kind: AuditActorKind, name: string | null): string {
  if (kind === 'worker') return 'Rotina automática';
  const person = name ?? 'Pessoa removida';
  return kind === 'agent' ? `${person}, pelo Lume,` : person;
}

export type PlatformAuditGroup = 'credits' | 'billing' | 'ai' | 'credentials' | 'whatsapp' | 'typesafe';

export const platformAuditFilters = [
  { slug: '', label: 'Tudo' },
  { slug: 'credits', label: 'Créditos' },
  { slug: 'billing', label: 'Pagamentos' },
  { slug: 'ai', label: 'IA' },
  { slug: 'typesafe', label: 'TypeSafe' },
  { slug: 'whatsapp', label: 'WhatsApp' },
  { slug: 'credentials', label: 'Credenciais' },
] as const satisfies readonly { slug: PlatformAuditGroup | ''; label: string }[];

/** The action prefixes each filter covers in `platform_audit_log`. */
export const platformAuditGroups: Record<PlatformAuditGroup, readonly string[]> = {
  credits: ['credits.'], billing: ['billing.'], ai: ['ai_connection.', 'ai_assignment.'],
  credentials: ['credentials.'], whatsapp: ['whatsapp.'], typesafe: ['typesafe.'],
};

const platformActions: Record<string, string> = {
  'credits.granted': 'Adicionou créditos',
  'billing.checkout_created': 'Abriu um pagamento',
  'billing.refund_requested': 'Pediu um reembolso',
  'billing.cancel_requested': 'Pediu o cancelamento de uma assinatura',
  'ai_connection.created': 'Criou uma conexão de IA',
  'ai_connection.updated': 'Alterou uma conexão de IA',
  'ai_connection.key_rotated': 'Trocou a chave de uma conexão de IA',
  'ai_connection.deleted': 'Excluiu uma conexão de IA',
  'ai_connection.tested': 'Testou uma conexão de IA',
  'ai_assignment.updated': 'Alterou o modelo de uma tarefa',
  'ai_assignment.tested': 'Testou o modelo de uma tarefa',
  'credentials.master_key_reencrypted': 'Cifrou de novo as credenciais com a chave mestra atual',
  'whatsapp.rollout.updated': 'Alterou a liberação do WhatsApp',
  'typesafe.configured': 'Configurou o TypeSafe',
  'typesafe.removed': 'Removeu a chave do TypeSafe',
};
export const platformAuditLabel = (action: string) => platformActions[action] ?? action;

/** The row's details as one plain line: "credits: 50 · requestId: …". Nested values stay JSON. */
export function auditDetails(json: string | null): string {
  if (!json) return '';
  let details: unknown;
  try { details = JSON.parse(json); } catch { return ''; }
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
  return Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
}

/** A page boundary: the last row's exact timestamp (microseconds, UTC) and id. */
const cursorPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([A-Za-z0-9-]{1,64})$/;
export function parseAuditCursor(value: string | undefined | null): { at: string; id: string } | null {
  const match = value ? cursorPattern.exec(value) : null;
  return match ? { at: match[1], id: match[2] } : null;
}
