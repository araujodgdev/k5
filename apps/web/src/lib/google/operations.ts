import { createHash, randomUUID } from 'node:crypto';
import { database, withTransaction, type Database, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { requireAndConsumeApproval } from '@/lib/application/approvals-service';
import type { WorkspaceContext } from '@/lib/application/context';
import { usageDay, type GoogleModule } from './config';
import { requireConnection, type ConnectionRow } from './connections';
import { evaluateRule, googleActions, readPolicy, type ActionMetrics, type GoogleAction, type PolicyRules } from './policy';
import { GoogleApiError, GoogleNetworkError } from './transport';
import { withGoogleWriteGuard } from './write-context';
import { googleEnvironment } from './environment';

export type OperationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
export type OperationRecord = {
  id: string; office_id: string; user_id: string; connection_id: string; action: GoogleAction; capability_name: string;
  invocation: string; idempotency_key: string; request_hash: string; encrypted_args: string; policy_version: number;
  policy_mode: 'automatic' | 'confirmation'; approval_id: string | null; status: OperationStatus; attempts: number;
  reconcile_key: string | null; external_ref: string | null; encrypted_result: string | null; error_code: string | null;
  error_message: string | null; usage_day: string; lease_token: string | null; lease_until: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
  bound_hash: string | null; effect_key: string | null; actions_json: string; checkpoint_json: string | null; has_effect: number;
};

export type OperationDto = {
  id: string; action: GoogleAction; status: OperationStatus; createdAt: string; finishedAt: string | null;
  errorMessage: string | null; externalRef: string | null;
};
export function operationDto(row: OperationRecord): OperationDto {
  return { id: row.id, action: row.action, status: row.status, createdAt: row.created_at, finishedAt: row.finished_at, errorMessage: row.error_message, externalRef: row.external_ref };
}

export type ReconcileOutcome<T> = { state: 'found'; externalRef: string | null; result: T } | { state: 'absent' } | { state: 'unknown' };
export type RunningOperation = { id: string; reconcileKey: string; connection: ConnectionRow; attempt: number; args: Record<string, unknown>; leaseToken: string; checkpoint: Record<string, unknown> | null };

export type OperationSpec<T> = {
  module: GoogleModule;
  /** The first action names the operation; every listed action has to pass the office rules. */
  actions: [GoogleAction, ...GoogleAction[]];
  capabilityName: string;
  /** The capability input as received (approvalId and idempotencyKey are read and stripped here). */
  input: Record<string, unknown>;
  /** What the person actually approves beyond the input: content digests, remote revisions. */
  bound?: Record<string, unknown>;
  /** Stable remote target when different requests could repeat the same uncertain effect (a Gmail draft). */
  effectKey?: string;
  targetResourceId?: string | null;
  metrics?: ActionMetrics;
  /** pt-BR sentence shown with Confirmar. */
  describe: string;
  execute: (operation: RunningOperation) => Promise<{ externalRef?: string | null; result: T }>;
  /** Looks for the effect at Google when the outcome of a call is unknown. */
  reconcile?: (operation: RunningOperation) => Promise<ReconcileOutcome<T>>;
};

const keyring = () => parseCredentialKeyring(googleEnvironment().K5_CREDENTIALS_KEY, googleEnvironment().K5_CREDENTIALS_PREVIOUS_KEYS, googleEnvironment().K5_CREDENTIALS_NEXT_KEY ?? '');
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, canonical(item)]));
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const errorMessages: Record<string, string> = {
  not_delivered: 'O Google não registrou a operação. Você pode tentar novamente.',
  google_rejected: 'O Google recusou a operação.',
  permission: 'A conta Google não tem permissão para esta ação.',
  not_found: 'O item não existe mais no Google.',
  conflict: 'O item mudou no Google. Atualize e tente novamente.',
  rate_limited: 'O Google limitou as solicitações. Tente novamente em instantes.',
  unknown: 'Não foi possível confirmar se o Google concluiu a operação. O Lume vai verificar antes de permitir nova tentativa.',
};

function failureFrom(error: unknown): { status: 'failed' | 'unknown'; code: string; message: string; capability?: CapabilityError } {
  if (error instanceof CapabilityError) return { status: 'failed', code: error.code.toLowerCase(), message: error.message, capability: error };
  if (error instanceof GoogleNetworkError) return { status: 'unknown', code: 'unknown', message: errorMessages.unknown };
  if (error instanceof GoogleApiError) {
    // 429 and 4xx are refusals: nothing happened. A 5xx on a write may have been applied.
    if (error.status === 429) return { status: 'failed', code: 'rate_limited', message: errorMessages.rate_limited };
    if (error.status >= 500) return { status: 'unknown', code: 'unknown', message: errorMessages.unknown };
    if (error.status === 403) return { status: 'failed', code: 'permission', message: errorMessages.permission };
    if (error.status === 404 || error.status === 410) return { status: 'failed', code: 'not_found', message: errorMessages.not_found };
    if (error.status === 409 || error.status === 412) return { status: 'failed', code: 'conflict', message: errorMessages.conflict };
    return { status: 'failed', code: 'google_rejected', message: errorMessages.google_rejected };
  }
  // A failure in our own code after the call could hide a completed effect.
  return { status: 'unknown', code: 'unknown', message: errorMessages.unknown };
}

async function load(owner: { officeId: string; userId: string }, key: string, db: Pick<Database, 'prepare'> = database) {
  return db.prepare('SELECT * FROM google_operation WHERE office_id=? AND user_id=? AND idempotency_key=?').get<OperationRecord>(owner.officeId, owner.userId, key);
}

export function operationArgs(row: OperationRecord): Record<string, unknown> {
  return JSON.parse(decryptCredential(row.encrypted_args, keyring())) as Record<string, unknown>;
}
export function operationResult<T>(row: OperationRecord): T | null {
  return row.encrypted_result ? JSON.parse(decryptCredential(row.encrypted_result, keyring())) as T : null;
}

type Admission = { kind: 'admitted'; row: OperationRecord } | { kind: 'needs_approval'; reason: string } | { kind: 'existing'; row: OperationRecord };

/**
 * Checks the rules and the daily counters under row locks and writes the durable record in the same
 * transaction, so two automatic operations cannot both take the last unit of a daily limit and a
 * rule change is either seen before the record exists or after it.
 */
async function admit(context: WorkspaceContext, spec: OperationSpec<unknown>, connection: ConnectionRow, key: string, requestHash: string,
  args: Record<string, unknown>, confirmed: boolean, approvalId: string | null, retryOf?: OperationRecord): Promise<Admission> {
  const day = usageDay();
  try {
    return await withTransaction(async (tx: Transaction) => {
      await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`google-operation:${context.officeId}:${context.userId}`);
      const previous = await load(context, key, tx);
      if (previous && (!retryOf || previous.status !== 'failed')) return { kind: 'existing', row: previous };
      const unresolved = await tx.prepare(`SELECT * FROM google_operation WHERE office_id=? AND user_id=? AND connection_id=?
        AND effect_key=? AND status IN ('pending','running','unknown') LIMIT 1`)
        .get<OperationRecord>(context.officeId, context.userId, connection.id, spec.effectKey ?? requestHash);
      if (unresolved) throw new CapabilityError('CONFLICT', 'Há uma operação equivalente em andamento ou em verificação. Aguarde a confirmação do resultado.');
      await tx.prepare('SELECT version FROM google_policy WHERE office_id=? FOR SHARE').get(context.officeId);
      const policy = await readPolicy(context.officeId, tx);
      if (confirmed && approvalId) {
        const approval = await tx.prepare('SELECT normalized_input FROM capability_approval WHERE id=? AND office_id=? AND user_id=?')
          .get<{ normalized_input: string }>(approvalId, context.officeId, context.userId);
        const approvedVersion = approval ? (JSON.parse(approval.normalized_input) as { __policyVersion?: number }).__policyVersion : undefined;
        if (approvedVersion !== policy.version) throw new CapabilityError('CONFLICT', 'As regras mudaram durante a confirmação. Prepare a operação novamente.');
      }
      const used: number[] = [];
      for (const action of spec.actions) {
        await tx.prepare('INSERT INTO google_usage_counter(office_id,user_id,action,usage_day,used) VALUES(?,?,?,?,0) ON CONFLICT DO NOTHING').run(context.officeId, context.userId, action, day);
        const row = await tx.prepare('SELECT used FROM google_usage_counter WHERE office_id=? AND user_id=? AND action=? AND usage_day=? FOR UPDATE')
          .get<{ used: number }>(context.officeId, context.userId, action, day);
        used.push(row?.used ?? 0);
      }
      const decision = gate(policy.rules, spec, used);
      if (decision.kind === 'blocked') throw new CapabilityError('FORBIDDEN', decision.reason);
      if (decision.kind === 'invalid') throw new CapabilityError('INVALID', decision.reason);
      if (decision.kind === 'needs_confirmation' && !confirmed) return { kind: 'needs_approval', reason: decision.reason };
      const mode = decision.kind === 'automatic' && !confirmed ? 'automatic' : 'confirmation';
      if (retryOf) {
        const row = await tx.prepare(`UPDATE google_operation SET status='pending',policy_version=?,policy_mode=?,usage_day=?,error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='failed' RETURNING *`).get<OperationRecord>(policy.version, mode, day, retryOf.id);
        if (!row) return { kind: 'existing', row: (await load(context, key, tx))! };
        for (const action of spec.actions) await tx.prepare('UPDATE google_usage_counter SET used=used+1 WHERE office_id=? AND user_id=? AND action=? AND usage_day=?').run(context.officeId, context.userId, action, day);
        return { kind: 'admitted', row };
      }
      for (const action of spec.actions) await tx.prepare('UPDATE google_usage_counter SET used=used+1 WHERE office_id=? AND user_id=? AND action=? AND usage_day=?').run(context.officeId, context.userId, action, day);
      const id = randomUUID();
      const row = await tx.prepare(`INSERT INTO google_operation(id,office_id,user_id,connection_id,action,capability_name,invocation,idempotency_key,request_hash,
        encrypted_args,policy_version,policy_mode,approval_id,status,reconcile_key,usage_day,usage_units,bound_hash,effect_key,actions_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?) RETURNING *`)
        .get<OperationRecord>(id, context.officeId, context.userId, connection.id, spec.actions[0], spec.capabilityName, context.invocation ?? 'ui', key, requestHash,
          encryptCredential(JSON.stringify(args), keyring()), policy.version, mode, approvalId, `lume-${id}`, day, spec.actions.length,
          digest(spec.bound ?? {}), spec.effectKey ?? requestHash, JSON.stringify(spec.actions));
      return { kind: 'admitted', row: row! };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const row = await load(context, key);
      if (row) return { kind: 'existing', row };
    }
    throw error;
  }
}

function gate(rules: PolicyRules, spec: OperationSpec<unknown>, used: number[]) {
  let confirmation: { kind: 'needs_confirmation'; reason: string } | null = null;
  for (const [index, action] of spec.actions.entries()) {
    const decision = evaluateRule(rules, action, spec.metrics ?? {}, used[index] ?? 0);
    if (decision.kind === 'blocked' || decision.kind === 'invalid') return decision;
    if (decision.kind === 'needs_confirmation') confirmation ??= decision;
  }
  return confirmation ?? { kind: 'automatic' as const };
}

async function releaseUsage(row: OperationRecord, actions: GoogleAction[]) {
  for (const action of actions) {
    await database.prepare('UPDATE google_usage_counter SET used=GREATEST(0,used-1) WHERE office_id=? AND user_id=? AND action=? AND usage_day=?')
      .run(row.office_id, row.user_id, action, row.usage_day);
  }
}

async function finish(row: OperationRecord, lease: string, update: { status: OperationStatus; externalRef?: string | null; result?: unknown; code?: string | null; message?: string | null }) {
  return database.prepare(`UPDATE google_operation SET status=?,external_ref=COALESCE(?,external_ref),encrypted_result=COALESCE(?,encrypted_result),
    error_code=?,error_message=?,finished_at=CASE WHEN ? IN ('succeeded','failed') THEN CURRENT_TIMESTAMP ELSE finished_at END,
    lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=? RETURNING *`)
    .get<OperationRecord>(update.status, update.externalRef ?? null,
      update.result === undefined ? null : encryptCredential(JSON.stringify(update.result ?? null), keyring()),
      update.code ?? null, update.message ?? null, update.status, row.id, lease);
}

/** Calendar checks are light and run at the edge; Gmail/Drive/Docs checks load Cofre code and run in Node. */
export function reconcileRuntime(action: string): 'edge' | 'node' { return action.startsWith('calendar.') ? 'edge' : 'node'; }

export async function enqueueReconcile(row: Pick<OperationRecord, 'id' | 'office_id' | 'user_id' | 'connection_id' | 'action'>, delayMs = 60_000, db: Database = database) {
  await db.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,runtime,subject_id,dedupe_key,status,run_after)
    VALUES(?,?,?,?,'operation_reconcile',?,?,?,'queued',?) ON CONFLICT DO NOTHING`)
    .run(randomUUID(), row.office_id, row.user_id, row.connection_id, reconcileRuntime(row.action), row.id, `reconcile:${row.id}`, new Date(Date.now() + delayMs).toISOString());
}

function operationHandle(row: OperationRecord, connection: ConnectionRow, args: Record<string, unknown>, lease: string): RunningOperation {
  return { id: row.id, reconcileKey: row.reconcile_key ?? `lume-${row.id}`, connection, attempt: row.attempts, args, leaseToken: lease,
    checkpoint: row.checkpoint_json ? JSON.parse(decryptCredential(row.checkpoint_json, keyring())) as Record<string, unknown> : null };
}

/** Persist a successful sub-step before another write; later failure can never be treated as no effect. */
export async function markOperationEffect(operation: RunningOperation, checkpoint: Record<string, unknown>) {
  return saveCheckpoint(operation, checkpoint, true);
}
/** Snapshot before the first request. Unlike an acknowledged effect, a definite 4xx can still fail. */
export async function checkpointOperation(operation: RunningOperation, checkpoint: Record<string, unknown>) {
  return saveCheckpoint(operation, checkpoint, false);
}
async function saveCheckpoint(operation: RunningOperation, checkpoint: Record<string, unknown>, effected: boolean) {
  const changed = await database.prepare(`UPDATE google_operation SET has_effect=GREATEST(has_effect,?),checkpoint_json=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND lease_token=? AND status='running'`).run(effected ? 1 : 0, encryptCredential(JSON.stringify(checkpoint), keyring()), operation.id, operation.leaseToken);
  if (!changed.changes) throw new GoogleNetworkError('response', 'A execução perdeu sua reserva; o resultado precisa ser verificado.');
  operation.checkpoint = checkpoint;
}

async function assertExecution(context: WorkspaceContext, row: OperationRecord, spec: OperationSpec<unknown>) {
  if (context.sessionId && !await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId)) {
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente.');
  }
  const member = await database.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?').get<{ role: string }>(context.officeId, context.userId);
  if (!member || !['administrator', 'lawyer'].includes(member.role)) throw new CapabilityError('FORBIDDEN', 'Seu acesso de escrita foi removido.');
  const live = await requireConnection(context, spec.module);
  if (live.id !== row.connection_id) throw new CapabilityError('CONFLICT', 'A conexão Google mudou. Prepare a operação novamente.');
  const policy = await readPolicy(context.officeId);
  if (policy.version !== row.policy_version) throw new CapabilityError('CONFLICT', 'As regras do escritório mudaram. Prepare a operação novamente.');
  const decision = gate(policy.rules, spec, spec.actions.map(() => 0));
  if (decision.kind === 'blocked' || decision.kind === 'invalid') throw new CapabilityError('FORBIDDEN', decision.reason);
}

async function execute<T>(context: WorkspaceContext, row: OperationRecord, connection: ConnectionRow, spec: OperationSpec<T>, args: Record<string, unknown>) {
  const lease = randomUUID();
  const running = await database.prepare(`UPDATE google_operation SET status='running',attempts=attempts+1,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
    lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' RETURNING *`)
    .get<OperationRecord>(lease, new Date(Date.now() + 120_000).toISOString(), row.id);
  if (!running) throw new CapabilityError('CONFLICT', 'A operação ainda está em andamento.');
  const handle = operationHandle(running, connection, args, lease);
  try {
    const guard = async () => {
      await assertExecution(context, running, spec as OperationSpec<unknown>);
      const live = await database.prepare(`SELECT 1 FROM google_operation WHERE id=? AND lease_token=? AND status='running' AND lease_until>CURRENT_TIMESTAMP`).get(running.id, lease);
      if (!live) throw new GoogleNetworkError('response');
    };
    await guard();
    const outcome = await withGoogleWriteGuard(guard, () => spec.execute(handle));
    const done = await finish(running, lease, { status: 'succeeded', externalRef: outcome.externalRef ?? null, result: outcome.result });
    if (!done) throw new GoogleNetworkError('response');
    return { row: done, result: outcome.result };
  } catch (error) {
    const effect = await database.prepare('SELECT has_effect FROM google_operation WHERE id=?').get<{ has_effect: number }>(running.id);
    const failure = effect?.has_effect ? failureFrom(new GoogleNetworkError('response')) : failureFrom(error);
    if (failure.status === 'failed') {
      const failed = await finish(running, lease, { status: 'failed', code: failure.code, message: failure.message });
      if (failed) await releaseUsage(running, spec.actions);
      if (failure.capability) throw failure.capability;
      throw new CapabilityError(failure.code === 'rate_limited' ? 'RATE_LIMITED' : failure.code === 'conflict' ? 'CONFLICT' : failure.code === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN', failure.message);
    }
    const unknown = await finish(running, lease, { status: 'unknown', code: 'unknown', message: failure.message });
    if (!unknown) throw new CapabilityError('CONFLICT', 'O resultado está sendo verificado por outra execução.');
    const settled = await settleUnknown(unknown, connection, spec, args);
    if (settled) return settled;
    await enqueueReconcile(unknown);
    return { row: (await database.prepare('SELECT * FROM google_operation WHERE id=?').get<OperationRecord>(unknown.id))!, result: null as T | null };
  }
}

/** Resolves an unknown outcome by looking at Google. Only a confirmed absence allows running the call again. */
async function settleUnknown<T>(row: OperationRecord, connection: ConnectionRow, spec: Pick<OperationSpec<T>, 'reconcile' | 'actions'>, args: Record<string, unknown>) {
  if (!spec.reconcile) return null;
  const lease = randomUUID();
  const claimed = await database.prepare(`UPDATE google_operation SET lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='unknown' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) RETURNING *`)
    .get<OperationRecord>(lease, new Date(Date.now() + 60_000).toISOString(), row.id);
  if (!claimed) return null;
  let outcome: ReconcileOutcome<T>;
  try { outcome = await spec.reconcile(operationHandle(row, connection, args, lease)); }
  catch { outcome = { state: 'unknown' }; }
  if (outcome.state === 'found') {
    const done = await finish(claimed, lease, { status: 'succeeded', externalRef: outcome.externalRef, result: outcome.result });
    return done ? { row: done, result: outcome.result } : null;
  }
  if (outcome.state === 'absent') {
    if (row.has_effect) { await database.prepare('UPDATE google_operation SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(row.id, lease); return null; }
    const failed = await finish(claimed, lease, { status: 'failed', code: 'not_delivered', message: errorMessages.not_delivered });
    if (failed) await releaseUsage(claimed, spec.actions);
    return null;
  }
  await database.prepare('UPDATE google_operation SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').run(row.id, lease);
  return null;
}

export type OperationOutcome<T> = { operation: OperationDto; result: T | null };

/**
 * The single path for every write to Google, whoever asked for it (interface, agent, WebMCP).
 * Order: ownership and scopes, idempotent replay, office rules and approval, durable record, effect.
 */
export async function runGoogleOperation<T>(context: WorkspaceContext, spec: OperationSpec<T>): Promise<OperationOutcome<T>> {
  if (context.role === 'reviewer') throw new CapabilityError('FORBIDDEN', 'Seu papel permite apenas consultas.');
  const connection = await requireConnection(context, spec.module);
  const { approvalId: rawApproval, idempotencyKey: rawKey, ...args } = spec.input;
  const approvalId = typeof rawApproval === 'string' && rawApproval ? rawApproval : null;
  // One approval is one operation: a confirmed proposal can never be replayed under a fresh key.
  const key = approvalId ? `approval:${approvalId}` : typeof rawKey === 'string' && rawKey ? `key:${rawKey}` : `once:${randomUUID()}`;
  const requestHash = digest({ capability: spec.capabilityName, args });
  const policy = await readPolicy(context.officeId);
  const approvalInput = { ...args, __bound: spec.bound ?? {}, __connectionId: connection.id, __policyVersion: policy.version };
  const storedArgs = { ...args, __bound: spec.bound ?? {} };

  const existing = await load(context, key);
  if (existing) return replay(context, existing, requestHash, connection, spec, args);

  if (approvalId) {
    await requireAndConsumeApproval(context, spec.capabilityName, approvalId, approvalInput, spec.targetResourceId ?? null, null, spec.describe, { allowConsumedRetry: true });
  }
  const admission = await admit(context, spec as OperationSpec<unknown>, connection, key, requestHash, storedArgs, Boolean(approvalId), approvalId);
  if (admission.kind === 'needs_approval') {
    await requireAndConsumeApproval(context, spec.capabilityName, undefined, approvalInput, spec.targetResourceId ?? null, null, `${spec.describe}. ${admission.reason}`);
    throw new CapabilityError('APPROVAL_REQUIRED', admission.reason);
  }
  if (admission.kind === 'existing') return replay(context, admission.row, requestHash, connection, spec, args);
  const { row, result } = await execute(context, admission.row, connection, spec, storedArgs);
  return { operation: operationDto(row), result };
}

async function replay<T>(context: WorkspaceContext, row: OperationRecord, requestHash: string, connection: ConnectionRow, spec: OperationSpec<T>, args: Record<string, unknown>): Promise<OperationOutcome<T>> {
  if (row.request_hash !== requestHash) throw new CapabilityError('CONFLICT', 'Esta chave de idempotência já foi usada com outros argumentos.');
  if (row.connection_id !== connection.id) throw new CapabilityError('CONFLICT', 'Esta operação pertence a outra conexão Google.');
  if (row.status === 'succeeded') return { operation: operationDto(row), result: operationResult<T>(row) };
  if (row.status === 'pending' || (row.status === 'running' && row.lease_until && Date.parse(row.lease_until) > Date.now())) {
    throw new CapabilityError('CONFLICT', 'A operação ainda está em andamento.');
  }
  if (row.status === 'running') {
    // The process that held it died mid-call: its effect may exist.
    await database.prepare(`UPDATE google_operation SET status='unknown',lease_token=NULL,lease_until=NULL,error_code='unknown',error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)`)
      .run(errorMessages.unknown, row.id);
    row = (await load(context, row.idempotency_key))!;
  }
  if (row.status === 'unknown') {
    const settled = await settleUnknown(row, connection, spec, operationArgs(row));
    if (settled) return { operation: operationDto(settled.row), result: settled.result };
    const current = (await load(context, row.idempotency_key))!;
    if (current.status !== 'failed') {
      await enqueueReconcile(current);
      return { operation: operationDto(current), result: null };
    }
    row = current;
  }
  // failed: nothing reached Google, so the same request may run again under the current rules.
  if (row.bound_hash !== digest(spec.bound ?? {})) throw new CapabilityError('CONFLICT', 'O conteúdo ou a versão mudou. Prepare uma nova operação e revise a confirmação.');
  if (row.approval_id) {
    const policy = await readPolicy(context.officeId);
    await requireAndConsumeApproval(context, spec.capabilityName, row.approval_id,
      { ...args, __bound: spec.bound ?? {}, __connectionId: connection.id, __policyVersion: policy.version }, spec.targetResourceId ?? null, null, spec.describe, { allowConsumedRetry: true });
  }
  const admission = await admit(context, spec as OperationSpec<unknown>, connection, row.idempotency_key, requestHash, args,
    Boolean(row.approval_id), row.approval_id, row);
  if (admission.kind === 'needs_approval') throw new CapabilityError('APPROVAL_REQUIRED', `${admission.reason} Peça a confirmação novamente.`);
  if (admission.kind === 'existing') return replay(context, admission.row, requestHash, connection, spec, args);
  const outcome = await execute(context, admission.row, connection, spec, operationArgs(admission.row));
  return { operation: operationDto(outcome.row), result: outcome.result };
}

export type Reconciler = (operation: RunningOperation) => Promise<ReconcileOutcome<unknown>>;

/** Worker entry: settles one unknown or abandoned operation with the module's reconciler. */
export async function reconcileOperationById(operationId: string, reconcilers: Partial<Record<GoogleAction, Reconciler>>, db: Database = database) {
  let row = await db.prepare('SELECT * FROM google_operation WHERE id=?').get<OperationRecord>(operationId);
  if (!row) return 'gone' as const;
  if (row.status === 'running' && (!row.lease_until || Date.parse(row.lease_until) < Date.now())) {
    row = await db.prepare(`UPDATE google_operation SET status='unknown',lease_token=NULL,lease_until=NULL,error_code='unknown',error_message=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='running' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) RETURNING *`).get<OperationRecord>(errorMessages.unknown, row.id) ?? row;
  }
  if (row.status !== 'unknown') return 'settled' as const;
  const connection = await db.prepare(`SELECT * FROM google_connection WHERE id=? AND status='active'`).get<ConnectionRow>(row.connection_id);
  const reconcile = reconcilers[row.action];
  if (!connection || !reconcile) return 'unresolved' as const;
  if (!await db.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(row.office_id, row.user_id)) return 'unresolved' as const;
  const savedActions = JSON.parse(row.actions_json || '[]') as GoogleAction[];
  const settled = await settleUnknown(row, connection, { reconcile, actions: savedActions.length ? savedActions as [GoogleAction, ...GoogleAction[]] : [row.action] }, operationArgs(row));
  if (settled) return 'settled' as const;
  const current = await db.prepare('SELECT status FROM google_operation WHERE id=?').get<{ status: OperationStatus }>(row.id);
  return current?.status === 'unknown' ? 'unresolved' as const : 'settled' as const;
}

export async function listOwnOperations(context: WorkspaceContext, input: { status?: OperationStatus; limit: number }) {
  const rows = await database.prepare(`SELECT * FROM google_operation WHERE office_id=? AND user_id=? ${input.status ? 'AND status=?' : ''} ORDER BY created_at DESC LIMIT ?`)
    .all<OperationRecord>(...[context.officeId, context.userId, ...(input.status ? [input.status] : []), input.limit]);
  return rows.map(operationDto);
}

/** Administrator view: who did which kind of action and how it ended. Never arguments, content or recipients. */
export async function listOfficeAudit(officeId: string, limit: number) {
  const rows = await database.prepare(`SELECT o.id,o.action,o.status,o.invocation,o.policy_mode,o.created_at,o.finished_at,o.usage_units,u.name AS member_name
    FROM google_operation o JOIN "user" u ON u.id=o.user_id WHERE o.office_id=? ORDER BY o.created_at DESC LIMIT ?`)
    .all<{ id: string; action: GoogleAction; status: OperationStatus; invocation: string; policy_mode: string; created_at: string; finished_at: string | null; usage_units: number; member_name: string }>(officeId, limit);
  const usage = await database.prepare(`SELECT action,sum(used) AS used FROM google_usage_counter WHERE office_id=? AND usage_day=? GROUP BY action`)
    .all<{ action: GoogleAction; used: number }>(officeId, usageDay());
  return {
    entries: rows.map(row => ({ id: row.id, action: row.action, actionLabel: googleActions[row.action]?.label ?? row.action, status: row.status, invocation: row.invocation,
      mode: row.policy_mode, memberName: row.member_name, createdAt: row.created_at, finishedAt: row.finished_at })),
    usageToday: usage.map(row => ({ action: row.action, actionLabel: googleActions[row.action]?.label ?? row.action, used: Number(row.used) })),
  };
}
