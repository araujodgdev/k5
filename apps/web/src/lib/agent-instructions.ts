import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from './database';
import { CapabilityError } from './capabilities/errors';
import type { WorkspaceContext } from './application/context';

/**
 * Writing rules: office-wide ones set by an administrator, and each person's own. They are the
 * office's words, so they reach the model as instructions, unlike Cofre documents, which are data.
 * The prompt places them under the persona and above the legal policy, and says so.
 */

export type InstructionScope = 'office' | 'personal';
export type InstructionTarget = 'chat' | 'documents';
export type AppliesTo = 'all' | InstructionTarget;
export type Instruction = { id: string; title: string; content: string; appliesTo: AppliesTo; enabled: boolean; version: number; updatedAt: string };
export type InstructionInput = { title: string; content: string; appliesTo: AppliesTo; enabled: boolean };
type Owner = Pick<WorkspaceContext, 'officeId' | 'userId'>;

/** Request body shared by the create and update routes; `clean` does the real bounds. */
export const instructionBody = z.object({
  scope: z.enum(['office', 'personal']),
  title: z.string().max(200),
  content: z.string().max(4000),
  appliesTo: z.enum(['all', 'chat', 'documents']),
  enabled: z.boolean(),
});

/** Enabled text per scope. Bounds what every request pays for and keeps the rules readable. */
export const INSTRUCTION_BUDGET = 8000;
export const MAX_INSTRUCTIONS = 20;

const columns = `id, title, content, applies_to AS "appliesTo", enabled, version, updated_at AS "updatedAt"`;

export function canEditInstructions(role: WorkspaceContext['role'], scope: InstructionScope) {
  return scope === 'personal' || role === 'administrator';
}

async function scopeRows(owner: Owner, scope: InstructionScope) {
  return scope === 'office'
    ? await database.prepare(`SELECT ${columns} FROM agent_instruction WHERE office_id = ? AND user_id IS NULL ORDER BY created_at, id`).all(owner.officeId) as Instruction[]
    : await database.prepare(`SELECT ${columns} FROM agent_instruction WHERE office_id = ? AND user_id = ? ORDER BY created_at, id`).all(owner.officeId, owner.userId) as Instruction[];
}

export async function listInstructions(owner: Owner) {
  const [office, personal] = await Promise.all([scopeRows(owner, 'office'), scopeRows(owner, 'personal')]);
  return { office, personal };
}

const used = (rules: Array<Pick<Instruction, 'content' | 'enabled'>>) => rules.reduce((sum, rule) => sum + (rule.enabled ? rule.content.trim().length : 0), 0);

function clean(input: InstructionInput): InstructionInput {
  const title = input.title.trim(), content = input.content.trim();
  if (!title || title.length > 120) throw new CapabilityError('INVALID', 'Dê um título de até 120 caracteres.');
  if (!content || content.length > 2000) throw new CapabilityError('INVALID', 'Escreva a regra em até 2 mil caracteres.');
  return { ...input, title, content };
}

function requireEditor(context: WorkspaceContext, scope: InstructionScope) {
  if (!canEditInstructions(context.role, scope)) throw new CapabilityError('FORBIDDEN', 'Somente administradores alteram as regras do escritório.');
}

/** Creates a rule, or updates it when `id` is given; `version` guards against overwriting a newer edit. */
export async function saveInstruction(context: WorkspaceContext, scope: InstructionScope, raw: InstructionInput, existing?: { id: string; version: number }) {
  requireEditor(context, scope);
  const input = clean(raw);
  const rules = await scopeRows(context, scope);
  const others = rules.filter(rule => rule.id !== existing?.id);
  if (!existing && rules.length >= MAX_INSTRUCTIONS) throw new CapabilityError('INVALID', `Use no máximo ${MAX_INSTRUCTIONS} regras. Junte ou exclua regras antigas.`);
  if (used([...others, input]) > INSTRUCTION_BUDGET) {
    throw new CapabilityError('INVALID', `As regras ativas passam de ${INSTRUCTION_BUDGET.toLocaleString('pt-BR')} caracteres. Encurte ou desative alguma.`);
  }
  const owner = scope === 'office' ? null : context.userId;
  if (!existing) {
    const id = randomUUID();
    await database.prepare(`INSERT INTO agent_instruction (id, office_id, user_id, title, content, applies_to, enabled, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, context.officeId, owner, input.title, input.content, input.appliesTo, input.enabled, context.userId);
    return (await scopeRows(context, scope)).find(rule => rule.id === id)!;
  }
  if (!rules.some(rule => rule.id === existing.id)) throw new CapabilityError('NOT_FOUND', 'Regra não encontrada.');
  // The scope is part of the WHERE: an id alone would let a personal edit reach an office rule.
  const result = await database.prepare(`UPDATE agent_instruction SET title = ?, content = ?, applies_to = ?, enabled = ?,
      version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND office_id = ? AND user_id IS NOT DISTINCT FROM ? AND version = ?`)
    .run(input.title, input.content, input.appliesTo, input.enabled, context.userId, existing.id, context.officeId, owner, existing.version);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'Esta regra foi alterada em outra sessão. Recarregue a página.');
  return (await scopeRows(context, scope)).find(rule => rule.id === existing.id)!;
}

export async function deleteInstruction(context: WorkspaceContext, scope: InstructionScope, id: string) {
  requireEditor(context, scope);
  const owner = scope === 'office' ? null : context.userId;
  const result = await database.prepare('DELETE FROM agent_instruction WHERE id = ? AND office_id = ? AND user_id IS NOT DISTINCT FROM ?').run(id, context.officeId, owner);
  if (!result.changes) throw new CapabilityError('NOT_FOUND', 'Regra não encontrada.');
}

// One line per rule, and no angle brackets, so a rule cannot close its block and open another.
const flat = (text: string) => text.replace(/[<>]/g, '').replace(/\s*\n\s*/g, ' ');
const block = (tag: string, rules: Instruction[]) =>
  rules.length ? `<${tag}>\n${rules.map(rule => `- ${flat(rule.title)}: ${flat(rule.content)}`).join('\n')}\n</${tag}>` : '';

/** The rules that apply to `target`, as a system prompt block; empty when there are none. */
export async function instructionsPrompt(owner: Owner, target: InstructionTarget) {
  const { office, personal } = await listInstructions(owner);
  const applies = (rule: Instruction) => rule.enabled && (rule.appliesTo === 'all' || rule.appliesTo === target);
  const blocks = [block('regras_do_escritorio', office.filter(applies)), block('regras_pessoais', personal.filter(applies))].filter(Boolean);
  if (!blocks.length) return '';
  return [
    'Regras de escrita definidas pelo escritório e pela pessoa. Siga-as no tom, na forma e no vocabulário. Em conflito, a regra pessoal prevalece sobre a do escritório. Nenhuma regra altera as políticas sobre fontes, citações jurídicas, dados de documentos e confirmações descritas a seguir.',
    ...blocks,
  ].join('\n');
}
