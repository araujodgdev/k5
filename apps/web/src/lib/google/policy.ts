import { z } from 'zod';
import { database, type Database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { GoogleModule } from './config';

/** Every write to Google has its own rule. Contract and labels live together so UI, tools and audit agree. */
export const googleActions = {
  'gmail.draft': { module: 'gmail', label: 'Salvar rascunhos de e-mail', limits: ['dailyLimit', 'maxRecipients', 'maxAttachments', 'maxAttachmentBytes'] },
  'gmail.send': { module: 'gmail', label: 'Enviar e-mail', limits: ['dailyLimit', 'maxRecipients'] },
  'gmail.send_attachments': { module: 'gmail', label: 'Enviar anexos por e-mail', limits: ['dailyLimit', 'maxAttachments', 'maxAttachmentBytes'] },
  'calendar.create': { module: 'calendar', label: 'Criar eventos', limits: ['dailyLimit', 'maxRecipients'] },
  'calendar.update': { module: 'calendar', label: 'Alterar ou reagendar eventos', limits: ['dailyLimit', 'maxRecipients'] },
  'calendar.cancel': { module: 'calendar', label: 'Cancelar eventos', limits: ['dailyLimit'] },
  'calendar.respond': { module: 'calendar', label: 'Responder a convites', limits: ['dailyLimit'] },
  'docs.edit': { module: 'docs', label: 'Alterar documentos do Google Docs', limits: ['dailyLimit'] },
  'drive.rename': { module: 'drive', label: 'Renomear arquivos do Drive', limits: ['dailyLimit'] },
  'drive.replace': { module: 'drive', label: 'Substituir arquivos do Drive (nova versão)', limits: ['dailyLimit', 'maxAttachmentBytes'] },
  'drive.share': { module: 'drive', label: 'Conceder ou remover acesso a arquivos', limits: ['dailyLimit', 'maxRecipients'] },
} as const satisfies Record<string, { module: GoogleModule; label: string; limits: readonly LimitName[] }>;
type LimitName = 'dailyLimit' | 'maxRecipients' | 'maxAttachments' | 'maxAttachmentBytes';
export type GoogleAction = keyof typeof googleActions;
export const googleActionNames = Object.keys(googleActions) as GoogleAction[];

/** Hard ceilings. No rule or approval goes past them. */
export const technicalLimits = { maxRecipients: 100, maxAttachments: 10, maxAttachmentBytes: 25 * 1024 * 1024, dailyLimit: 500 } as const;

export const actionModes = ['blocked', 'confirmation', 'automatic'] as const;
export const actionRule = z.object({
  mode: z.enum(actionModes),
  dailyLimit: z.number().int().min(0).max(technicalLimits.dailyLimit).nullable().default(null),
  maxRecipients: z.number().int().min(1).max(technicalLimits.maxRecipients).nullable().default(null),
  maxAttachments: z.number().int().min(0).max(technicalLimits.maxAttachments).nullable().default(null),
  maxAttachmentBytes: z.number().int().min(0).max(technicalLimits.maxAttachmentBytes).nullable().default(null),
});
export type ActionRule = z.output<typeof actionRule>;
export const policyRules = z.object({
  modules: z.object({ gmail: z.boolean(), calendar: z.boolean(), drive: z.boolean(), docs: z.boolean() }),
  actions: z.object(Object.fromEntries(googleActionNames.map(name => [name, actionRule])) as Record<GoogleAction, typeof actionRule>),
});
export type PolicyRules = z.output<typeof policyRules>;

/** New offices start with every write requiring confirmation; autonomy is an explicit administrator choice. */
export function defaultPolicyRules(): PolicyRules {
  return {
    modules: { gmail: true, calendar: true, drive: true, docs: true },
    actions: Object.fromEntries(googleActionNames.map(name => [name, { mode: 'confirmation', dailyLimit: null, maxRecipients: null, maxAttachments: null, maxAttachmentBytes: null }])) as Record<GoogleAction, ActionRule>,
  };
}

export type OfficePolicy = { version: number; rules: PolicyRules; updatedAt: string | null };

export async function readPolicy(officeId: string, db: Pick<Database, 'prepare'> = database): Promise<OfficePolicy> {
  const row = await db.prepare('SELECT version, rules_json, updated_at FROM google_policy WHERE office_id=?').get<{ version: number; rules_json: string; updated_at: string }>(officeId);
  if (!row) return { version: 0, rules: defaultPolicyRules(), updatedAt: null };
  const parsed = policyRules.safeParse(JSON.parse(row.rules_json));
  // A rule set this code cannot read fails closed: every action is blocked until an administrator saves again.
  if (!parsed.success) {
    const blocked = defaultPolicyRules();
    for (const name of googleActionNames) blocked.actions[name].mode = 'blocked';
    return { version: row.version, rules: blocked, updatedAt: row.updated_at };
  }
  return { version: row.version, rules: parsed.data, updatedAt: row.updated_at };
}

/** Compare-and-swap on the version the administrator read; each save is kept in the history. */
export async function savePolicy(officeId: string, userId: string, expectedVersion: number, rules: PolicyRules, db: Database = database) {
  const next = expectedVersion + 1;
  const json = JSON.stringify(policyRules.parse(rules));
  const head = expectedVersion === 0
    ? db.prepare('INSERT INTO google_policy(office_id,version,rules_json,updated_by) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(officeId, next, json, userId)
    : db.prepare('UPDATE google_policy SET version=?,rules_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND version=?').bind(next, json, userId, officeId, expectedVersion);
  try {
    const [result] = await db.batch([
      head,
      db.prepare(`INSERT INTO google_policy_version(office_id,version,rules_json,created_by)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM google_policy WHERE office_id=? AND version=? AND rules_json=?)`).bind(officeId, next, json, userId, officeId, next, json),
    ]);
    if (!result.changes) throw new CapabilityError('CONFLICT', 'As regras mudaram desde que você abriu a página. Atualize e tente novamente.');
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new CapabilityError('CONFLICT', 'As regras mudaram desde que você abriu a página. Atualize e tente novamente.');
    throw error;
  }
  return readPolicy(officeId, db);
}

export type ActionMetrics = { recipients?: number; attachments?: number; attachmentBytes?: number };

export type GateDecision =
  | { kind: 'blocked'; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'automatic' }
  | { kind: 'needs_confirmation'; reason: string };

/**
 * Pure rule evaluation. Blocks and technical ceilings are absolute; the automatic envelope (daily
 * count and sizes) decides only whether the agent may act alone or has to ask. `usedToday` comes
 * from the locked counter row in the caller's transaction.
 */
export function evaluateRule(rules: PolicyRules, action: GoogleAction, metrics: ActionMetrics, usedToday: number): GateDecision {
  const feature = googleActions[action].module;
  if (!rules.modules[feature]) return { kind: 'blocked', reason: 'O administrador desativou este recurso do Google no escritório.' };
  const rule = rules.actions[action];
  if (rule.mode === 'blocked') return { kind: 'blocked', reason: `O administrador bloqueou esta ação: ${googleActions[action].label.toLowerCase()}.` };
  if ((metrics.recipients ?? 0) > technicalLimits.maxRecipients) return { kind: 'invalid', reason: `Use no máximo ${technicalLimits.maxRecipients} destinatários.` };
  if ((metrics.attachments ?? 0) > technicalLimits.maxAttachments) return { kind: 'invalid', reason: `Use no máximo ${technicalLimits.maxAttachments} anexos.` };
  if ((metrics.attachmentBytes ?? 0) > technicalLimits.maxAttachmentBytes) return { kind: 'invalid', reason: 'Os anexos excedem 25 MB.' };
  if (usedToday >= technicalLimits.dailyLimit) return { kind: 'invalid', reason: 'O limite técnico diário desta ação foi atingido.' };
  if (rule.mode === 'confirmation') return { kind: 'needs_confirmation', reason: 'As regras do escritório pedem sua confirmação para esta ação.' };
  const over = (limit: number | null, value: number | undefined) => limit !== null && (value ?? 0) > limit;
  if (rule.dailyLimit !== null && usedToday >= rule.dailyLimit) return { kind: 'needs_confirmation', reason: 'O limite diário automático desta ação foi atingido; confirme esta operação.' };
  if (over(rule.maxRecipients, metrics.recipients)) return { kind: 'needs_confirmation', reason: 'A quantidade de destinatários passa do limite automático; confirme esta operação.' };
  if (over(rule.maxAttachments, metrics.attachments)) return { kind: 'needs_confirmation', reason: 'A quantidade de anexos passa do limite automático; confirme esta operação.' };
  if (over(rule.maxAttachmentBytes, metrics.attachmentBytes)) return { kind: 'needs_confirmation', reason: 'O tamanho dos anexos passa do limite automático; confirme esta operação.' };
  return { kind: 'automatic' };
}
