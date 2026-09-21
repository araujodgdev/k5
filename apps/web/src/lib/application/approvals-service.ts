import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from './context';

export type ApprovalRow = {
  id: string;
  office_id: string;
  user_id: string;
  capability_name: string;
  normalized_input: string;
  target_resource_id: string | null;
  target_version: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  expires_at: number;
  created_at: string;
  consumed_at: string | null;
};

/**
 * Stable JSON at every depth. The obvious `JSON.stringify(obj, Object.keys(obj).sort())` looks
 * like a sort but is a property *filter* that applies recursively, so nested fields vanish from
 * the canonical form and changing one would not invalidate the approval.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
}

function canonicalInput(input: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(input));
}

export async function createApprovalProposal(
  context: WorkspaceContext,
  capabilityName: string,
  input: Record<string, unknown>,
  targetResourceId?: string | null,
  targetVersion?: number | null,
  ttlMs = 600_000,
): Promise<ApprovalRow> {
  const id = randomUUID();
  const inferredResourceId = targetResourceId ?? (input.caseId as string | undefined) ?? (input.documentId as string | undefined) ?? (input.artifactId as string | undefined) ?? null;
  const inferredVersion = targetVersion ?? (typeof input.version === 'number' ? input.version : null);
  const normalizedInput = canonicalInput(input);
  const expiresAt = Date.now() + ttlMs;

  await database.prepare(`
    INSERT INTO capability_approval (id, office_id, user_id, capability_name, normalized_input, target_resource_id, target_version, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, context.officeId, context.userId, capabilityName, normalizedInput, inferredResourceId, inferredVersion, expiresAt);

  return await database.prepare('SELECT * FROM capability_approval WHERE id=?').get(id) as ApprovalRow;
}

export async function approveProposal(context: WorkspaceContext, approvalId: string): Promise<ApprovalRow> {
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  if (row.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'A solicitação de aprovação expirou.');
  if (row.status !== 'pending') throw new CapabilityError('CONFLICT', `A solicitação está ${row.status}.`);

  await database.prepare("UPDATE capability_approval SET status='approved' WHERE id=?").run(approvalId);
  return await database.prepare('SELECT * FROM capability_approval WHERE id=?').get(approvalId) as ApprovalRow;
}

export async function rejectProposal(context: WorkspaceContext, approvalId: string): Promise<ApprovalRow> {
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  await database.prepare("UPDATE capability_approval SET status='rejected' WHERE id=?").run(approvalId);
  return await database.prepare('SELECT * FROM capability_approval WHERE id=?').get(approvalId) as ApprovalRow;
}

export async function getApprovalProposal(context: WorkspaceContext, approvalId: string): Promise<ApprovalRow> {
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  return row;
}

export async function requireAndConsumeApproval(
  context: WorkspaceContext,
  capabilityName: string,
  approvalId: string | undefined,
  inputForProposal: Record<string, unknown>,
  targetResourceId?: string | null,
  targetVersion?: number | null,
  description = 'Esta operação requer confirmação explícita antes de ser executada.'
) {
  if (!approvalId) {
    const proposal = await createApprovalProposal(context, capabilityName, inputForProposal, targetResourceId, targetVersion);
    throw new CapabilityError('APPROVAL_REQUIRED', `${description} Proposta registrada [id: ${proposal.id}].`);
  }

  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Código de aprovação não encontrado.');
  if (row.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'Esta aprovação expirou. Solicite uma nova confirmação.');
  if (row.capability_name !== capabilityName) throw new CapabilityError('FORBIDDEN', 'Aprovação inválida para esta operação.');
  if (row.status === 'consumed') throw new CapabilityError('CONFLICT', 'Esta aprovação já foi utilizada.');
  if (targetResourceId && row.target_resource_id && row.target_resource_id !== targetResourceId) {
    throw new CapabilityError('FORBIDDEN', 'A aprovação não corresponde ao recurso alvo indicado.');
  }
  if (targetVersion !== undefined && targetVersion !== null && row.target_version !== null && row.target_version !== targetVersion) {
    throw new CapabilityError('FORBIDDEN', 'A versão do recurso mudou desde a solicitação de aprovação.');
  }
  const expectedNormalized = canonicalInput(inputForProposal);
  if (row.normalized_input !== expectedNormalized) {
    throw new CapabilityError('FORBIDDEN', 'Os argumentos da operação foram alterados desde a proposta de aprovação.');
  }
  if (row.status !== 'approved') throw new CapabilityError('APPROVAL_REQUIRED', 'A operação ainda não foi aprovada pelo usuário.');

  const consumed = await database.prepare(
    "UPDATE capability_approval SET status='consumed', consumed_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'",
  ).run(approvalId);
  if (!consumed.changes) throw new CapabilityError('CONFLICT', 'Esta aprovação já foi utilizada.');
}
