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

export type ApprovalDto = {
  id: string; capabilityName: string; targetResourceId: string | null;
  status: ApprovalRow['status']; expiresAt: string; createdAt: string;
};

/** Public shape for HTTP responses: no tenant ids, no stored input. */
export function publicApproval(row: ApprovalRow): ApprovalDto {
  return {
    id: row.id, capabilityName: row.capability_name, targetResourceId: row.target_resource_id,
    status: row.status, expiresAt: new Date(row.expires_at).toISOString(), createdAt: row.created_at,
  };
}

const statusLabel = { approved: 'aprovada', rejected: 'rejeitada', consumed: 'utilizada', pending: 'pendente' } as const;

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
  const now = Date.now();
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  if (row.expires_at < now) throw new CapabilityError('CONFLICT', 'A solicitação de aprovação expirou.');
  if (row.status !== 'pending') throw new CapabilityError('CONFLICT', `A solicitação já foi ${statusLabel[row.status]}.`);

  const transitioned = await database.prepare(
    "UPDATE capability_approval SET status='approved' WHERE id=? AND office_id=? AND user_id=? AND status='pending' AND expires_at>=? RETURNING *",
  ).get(approvalId, context.officeId, context.userId, now) as ApprovalRow | undefined;
  if (!transitioned) throw new CapabilityError('CONFLICT', 'A solicitação já foi decidida.');
  return transitioned;
}

export async function rejectProposal(context: WorkspaceContext, approvalId: string): Promise<ApprovalRow> {
  const now = Date.now();
  const row = await database.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
    .get(approvalId, context.officeId, context.userId) as ApprovalRow | undefined;
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta de aprovação não encontrada.');
  if (row.expires_at < now) throw new CapabilityError('CONFLICT', 'A solicitação de aprovação expirou.');
  if (row.status !== 'pending') throw new CapabilityError('CONFLICT', `A solicitação já foi ${statusLabel[row.status]}.`);
  const transitioned = await database.prepare(
    "UPDATE capability_approval SET status='rejected' WHERE id=? AND office_id=? AND user_id=? AND status='pending' AND expires_at>=? RETURNING *",
  ).get(approvalId, context.officeId, context.userId, now) as ApprovalRow | undefined;
  if (!transitioned) throw new CapabilityError('CONFLICT', 'A solicitação já foi decidida.');
  return transitioned;
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
  description = 'Esta operação requer confirmação explícita antes de ser executada.',
  options: { allowConsumedRetry?: boolean } = {},
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
  if (row.status === 'consumed') {
    const sameResource = !targetResourceId || !row.target_resource_id || row.target_resource_id === targetResourceId;
    const sameVersion = targetVersion === undefined || targetVersion === null || row.target_version === null || row.target_version === targetVersion;
    const sameInput = row.normalized_input === canonicalInput(inputForProposal);
    if (options.allowConsumedRetry && sameResource && sameVersion && sameInput) return;
    throw new CapabilityError('CONFLICT', 'Esta aprovação já foi utilizada.');
  }
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
  if (!consumed.changes) {
    if (options.allowConsumedRetry) {
      const latest = await database.prepare('SELECT status FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
        .get(approvalId, context.officeId, context.userId) as Pick<ApprovalRow, 'status'> | undefined;
      if (latest?.status === 'consumed') return;
    }
    throw new CapabilityError('CONFLICT', 'Esta aprovação já foi utilizada.');
  }
}

/**
 * High-impact actions the agent may only run after the person presses Confirmar in the chat.
 * Someone acting in the interface already confirmed by clicking, so only agent and WebMCP calls
 * are gated here; the proposal stores the exact input, and the chat executes that input.
 */
export const agentConfirmedCapabilities = [
  'k5_vault_delete_case', 'k5_vault_delete_document', 'k5_vault_delete_folder', 'k5_conversations_delete',
  'k5_judicial_confirm_link', 'k5_judicial_unlink_case', 'k5_judicial_request_refresh', 'k5_artifacts_update',
  'k5_artifacts_edit', 'k5_vault_generate_annexes',
  // Google writes ask only when the office rules say so (src/lib/google/operations.ts decides).
  'k5_calendar_create_event', 'k5_calendar_update_event', 'k5_calendar_cancel_event', 'k5_calendar_respond',
  'k5_gmail_save_draft', 'k5_gmail_delete_draft', 'k5_gmail_send', 'k5_docs_edit', 'k5_drive_rename_file', 'k5_drive_upload_version',
  'k5_drive_share_file', 'k5_drive_revoke_permission',
] as const;

export async function requireAgentApproval(
  context: WorkspaceContext,
  capabilityName: (typeof agentConfirmedCapabilities)[number],
  approvalId: string | undefined,
  input: Record<string, unknown>,
  targetResourceId: string | null,
  description: string,
  // A retry with a consumed approval is safe for operations that land in the same state twice;
  // one that creates something new each time must not replay.
  options: { allowConsumedRetry?: boolean } = { allowConsumedRetry: true },
) {
  if (!context.invocation) return;
  await requireAndConsumeApproval(context, capabilityName, approvalId, input, targetResourceId, null, description, options);
}

/** The id the gate put in its refusal, so the chat can offer the confirmation. */
export function approvalIdFromMessage(message: string) {
  return /Proposta registrada \[id: ([0-9a-f-]{36})\]/i.exec(message)?.[1] ?? null;
}
