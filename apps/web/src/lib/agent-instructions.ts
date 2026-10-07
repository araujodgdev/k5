import 'server-only';
import { documentTransaction } from './documents/service';
import { contentResult, mapContentResult } from './content-result';
import { exposedPolicies } from './content-policy';
import { assertPolicyAccess, contentDigest, parsePolicy, uncertainPolicy, settingWritePolicy, type ContentPolicy } from './content-policy';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from './database';
import { CapabilityError } from './capabilities/errors';
import { assertCapabilityAllowed, type WorkspaceContext } from './application/context';

export type InstructionScope = 'office' | 'personal';
export type InstructionTarget = 'chat' | 'documents';
export type AppliesTo = 'all' | InstructionTarget;
export type Instruction = { id: string; title: string; content: string; appliesTo: AppliesTo; enabled: boolean; version: number; updatedAt: string };
export type InstructionInput = { title: string; content: string; appliesTo: AppliesTo; enabled: boolean };
type Owner = Pick<WorkspaceContext, 'officeId' | 'userId'>;

export const instructionBody = z.object({
  scope: z.enum(['office', 'personal']),
  title: z.string().max(200),
  content: z.string().max(4000),
  appliesTo: z.enum(['all', 'chat', 'documents']),
  enabled: z.boolean(),
});

export const INSTRUCTION_BUDGET = 8000;
export const MAX_INSTRUCTIONS = 20;

const columns = `id, title, content, applies_to AS "appliesTo", enabled, version, updated_at AS "updatedAt", content_policy`;

async function scopeRows(owner: Owner, scope: InstructionScope, db: Transaction = (owner as WorkspaceContext).contentTransaction ?? database) {
  const rows = scope === 'office'
    ? await db.prepare(`SELECT ${columns} FROM agent_instruction WHERE office_id = ? AND user_id IS NULL ORDER BY created_at, id`).all(owner.officeId) as Instruction[]
    : await db.prepare(`SELECT ${columns} FROM agent_instruction WHERE office_id = ? AND user_id = ? ORDER BY created_at, id`).all(owner.officeId, owner.userId) as Instruction[];
  const visible: Instruction[] = [];
  for (const stored of rows as (Instruction & { content_policy: unknown })[]) {
    try {
      const { content_policy, ...row } = stored;
      const policy = content_policy ? parsePolicy(content_policy, contentDigest(row.title, row.content)) : uncertainPolicy(owner.userId);
      await assertPolicyAccess(owner.userId, policy, db);
      const observation: ContentPolicy = { ...policy, observed: [...policy.observed, { kind: 'instruction', id: row.id, version: String(row.version), digest: policy.digest }] };
      visible.push(contentResult(row, [observation], [{ kind: 'instruction', id: row.id, version: row.version, digest: policy.digest }]));
    } catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  return visible;
}

export async function listInstructions(owner: Owner) {
  const office = await scopeRows(owner, 'office');
  const personal = await scopeRows(owner, 'personal');
  return mapContentResult({ office, personal }, ...office, ...personal);
}

const used = (rules: Array<Pick<Instruction, 'content' | 'enabled'>>) => rules.reduce((sum, rule) => sum + (rule.enabled ? rule.content.trim().length : 0), 0);

function clean(input: InstructionInput): InstructionInput {
  const title = input.title.trim(), content = input.content.trim();
  if (!title || title.length > 120) throw new CapabilityError('INVALID', 'Dê um título de até 120 caracteres.');
  if (!content || content.length > 2000) throw new CapabilityError('INVALID', 'Escreva a regra em até 2 mil caracteres.');
  return { ...input, title, content };
}

/** Creates a rule, or updates it when `id` is given; `version` guards against overwriting a newer edit. */
export async function saveInstruction(context: WorkspaceContext, scope: InstructionScope, raw: InstructionInput, existing?: { id: string; version: number }) {
  return documentTransaction(context, async tx => {
  await assertCapabilityAllowed(context, 'k5_agent_settings_change', tx);
  const input = clean(raw);
  const rules = await scopeRows(context, scope, tx);
  const others = rules.filter(rule => rule.id !== existing?.id);
  if (!existing && rules.length >= MAX_INSTRUCTIONS) throw new CapabilityError('INVALID', `Use no máximo ${MAX_INSTRUCTIONS} regras. Junte ou exclua regras antigas.`);
  if (used([...others, input]) > INSTRUCTION_BUDGET) {
    throw new CapabilityError('INVALID', `As regras ativas passam de ${INSTRUCTION_BUDGET.toLocaleString('pt-BR')} caracteres. Encurte ou desative alguma.`);
  }
  const base = existing ? await tx.prepare('SELECT title,content,content_policy FROM agent_instruction WHERE id=? AND office_id=? AND user_id IS NOT DISTINCT FROM ?')
    .get<{ title: string; content: string; content_policy: unknown }>(existing.id, context.officeId, scope === 'office' ? null : context.userId) : undefined;
  const policy = await settingWritePolicy(context, input.title, input.content, base, tx);
  const owner = scope === 'office' ? null : context.userId;
  if (!existing) {
    const id = randomUUID();
    await tx.prepare(`INSERT INTO agent_instruction (id, office_id, user_id, title, content, applies_to, enabled, updated_by,content_policy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?,?::jsonb)`).run(id, context.officeId, owner, input.title, input.content, input.appliesTo, input.enabled, context.userId, JSON.stringify(policy));
    return (await scopeRows(context, scope, tx)).find(rule => rule.id === id)!;
  }
  if (!rules.some(rule => rule.id === existing.id)) throw new CapabilityError('NOT_FOUND', 'Regra não encontrada.');

  const result = await tx.prepare(`UPDATE agent_instruction SET title = ?, content = ?, applies_to = ?, enabled = ?,
      content_policy=?::jsonb, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND office_id = ? AND user_id IS NOT DISTINCT FROM ? AND version = ?`)
    .run(input.title, input.content, input.appliesTo, input.enabled, JSON.stringify(policy), context.userId, existing.id, context.officeId, owner, existing.version);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'Esta regra foi alterada em outra sessão. Recarregue a página.');
  return (await scopeRows(context, scope, tx)).find(rule => rule.id === existing.id)!;
  });
}

export async function deleteInstruction(context: WorkspaceContext, scope: InstructionScope, id: string) {
  const owner = scope === 'office' ? null : context.userId;
  const result = await (context.contentTransaction ?? database).prepare('DELETE FROM agent_instruction WHERE id = ? AND office_id = ? AND user_id IS NOT DISTINCT FROM ?').run(id, context.officeId, owner);
  if (!result.changes) throw new CapabilityError('NOT_FOUND', 'Regra não encontrada.');
}

const encodeInstructionLine = (text: string) => text.replace(/[<>]/g, '').replace(/\s*\n\s*/g, ' ');
const block = (tag: string, rules: Instruction[]) =>
  rules.length ? `<${tag}>\n${rules.map(rule => `- ${encodeInstructionLine(rule.title)}: ${encodeInstructionLine(rule.content)}`).join('\n')}\n</${tag}>` : '';

/** The rules that apply to `target`, as a system prompt block; empty when there are none. */
export async function instructionsPrompt(owner: Owner, target: InstructionTarget, policies?: ContentPolicy[]) {
  const { office, personal } = await listInstructions(owner);
  const applies = (rule: Instruction) => rule.enabled && (rule.appliesTo === 'all' || rule.appliesTo === target);
  if (policies) for (const rule of [...office, ...personal].filter(applies)) {
    policies.push(...exposedPolicies(rule) ?? []);
  }
  const blocks = [block('regras_do_escritorio', office.filter(applies)), block('regras_pessoais', personal.filter(applies))].filter(Boolean);
  if (!blocks.length) return '';
  return [
    'Regras de escrita definidas pelo escritório e pela pessoa. Siga-as no tom, na forma e no vocabulário. Em conflito, a regra pessoal prevalece sobre a do escritório. Nenhuma regra altera as políticas sobre fontes, citações jurídicas, dados de documentos e confirmações descritas a seguir.',
    ...blocks,
  ].join('\n');
}
