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

function canonicalInput(input: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) clean[key] = value;
  }
  return JSON.stringify(clean, Object.keys(clean).sort());
}

export function createApprovalProposal(
  context: WorkspaceContext,
  capabilityName: string,
  input: Record<string, unknown>,
  targetResourceId?: string | null,
  targetVersion?: number | null,
  ttlMs = 600_000,
): ApprovalRow {
  const id = randomUUID();
  const inferredResourceId = targetResourceId ?? (input.caseId as string | undefined) ?? (input.documentId as string | undefined) ?? (input.artifactId as string | undefined) ?? null;
  const inferredVersion = targetVersion ?? (typeof input.version === 'number' ? input.version : null);
  const normalizedInput = canonicalInput(input);
  const expiresAt = Date.now() + ttlMs;

  database.prepare(`
    INSERT INTO capability_approval (id, office_id, user_id, capability_name, normalized_input, target_resource_id, target_version, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, context.officeId, context.userId, capabilityName, normalizedInput, inferredResourceId, inferredVersion, expiresAt);

  return database.prepare('SELECT * FROM capability_approval WHERE id=?').get(id) as ApprovalRow;
}

export function approveProposal(context: WorkspaceContext, approvalId: string): ApprovalRow {
  const row = database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=?').get(approvalId, context.officeId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  if (row.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'A solicitação de aprovação expirou.');
  if (row.status !== 'pending') throw new CapabilityError('CONFLICT', `A solicitação está ${row.status}.`);

  database.prepare("UPDATE capability_approval SET status='approved' WHERE id=?").run(approvalId);
  return database.prepare('SELECT * FROM capability_approval WHERE id=?').get(approvalId) as ApprovalRow;
}

export function rejectProposal(context: WorkspaceContext, approvalId: string): ApprovalRow {
  const row = database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=?').get(approvalId, context.officeId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  database.prepare("UPDATE capability_approval SET status='rejected' WHERE id=?").run(approvalId);
  return database.prepare('SELECT * FROM capability_approval WHERE id=?').get(approvalId) as ApprovalRow;
}

export function getApprovalProposal(context: WorkspaceContext, approvalId: string): ApprovalRow {
  const row = database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=?').get(approvalId, context.officeId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  return row;
}

export function requireAndConsumeApproval(
  context: WorkspaceContext,
  capabilityName: string,
  approvalId: string | undefined,
  inputForProposal: Record<string, unknown>,
  targetResourceId?: string | null,
  targetVersion?: number | null,
  description = 'Esta operação requer confirmação explícita antes de ser executada.'
) {
  if (!approvalId) {
    const proposal = createApprovalProposal(context, capabilityName, inputForProposal, targetResourceId, targetVersion);
    throw new CapabilityError('APPROVAL_REQUIRED', `${description} Proposta registrada [id: ${proposal.id}].`);
  }

  const row = database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=?').get(approvalId, context.officeId) as ApprovalRow | undefined;
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

  database.prepare("UPDATE capability_approval SET status='consumed', consumed_at=CURRENT_TIMESTAMP WHERE id=?").run(approvalId);
}
