import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { TypeSafeClient, type EntryType, type Questions } from '@typesafe-ai/sdk';
import { database, withTransaction } from '@/lib/database';
import { decryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { decisionResponse, type DecisionPurpose, type Evaluation } from './contracts';
import { getConnection } from './config';

export type DecisionRequest = { state: EntryType; questions: Questions; model: string };
export type DecisionTransport = (key: string, request: DecisionRequest, signal: AbortSignal) => Promise<unknown>;
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sendDecision: DecisionTransport = async (apiKey, request, signal) => {
  const client = new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai', logLevel: 'off', retry: { maxRetries: 0 }, timeout: 10_000 });
  return client.systemOne(request, { signal });
};

/**
 * One platform connection serves every office; evaluations still record the office they ran for.
 * No caller-provided office, keys or provider errors cross the public capability boundary.
 */
export async function evaluate(
  context: { officeId: string | null; userId: string | null },
  purpose: DecisionPurpose,
  request: Omit<DecisionRequest, 'model'> & { questionVersion: string },
  options: { signal?: AbortSignal; deadlineMs?: number; send?: DecisionTransport; test?: boolean } = {},
): Promise<Evaluation> {
  const config = await getConnection();
  const mode = options.test ? 'shadow' : config?.[`${purpose}_mode`] ?? 'off';
  if (!config?.enabled || !config.encrypted_api_key || mode === 'off') return { status: 'disabled', mode };
  const now = Date.now();
  const deadline = options.deadlineMs ?? ({ rag: 2000, agenda: 5000, documents: 10000, research: 10000, feedback: 10000, email: 10000 })[purpose];
  const signal = AbortSignal.any([AbortSignal.timeout(deadline), ...(options.signal ? [options.signal] : [])]);
  if (signal.aborted || config.circuit_until > now) return { status: 'unavailable', mode, reason: 'temporarily_unavailable' };
  const sizes = Object.values(request.questions).map(q => Buffer.byteLength(JSON.stringify(q)));
  const stateBytes = Buffer.byteLength(JSON.stringify(request.state));
  // UTF-8 bytes conservatively bound tokens; leave room for service framing.
  const reserved = stateBytes + sizes.reduce((a, b) => a + b, 0) + sizes.length * 256 + 512;
  if (!sizes.length || stateBytes + Math.max(...sizes) > 28_000 || reserved > 60_000) return { status: 'budget_exceeded', mode, reason: 'context_limit' };
  const id = randomUUID();
  const day = new Date(now).toISOString().slice(0, 10);
  const reservation = await withTransaction(async tx => {
    // Serialize reservations across purposes so concurrent email batches cannot overspend.
    const live = await tx.prepare('SELECT version,enabled FROM typesafe_platform_connection WHERE id=1 FOR UPDATE').get<{ version: number; enabled: number }>();
    if (!live?.enabled || live.version !== config.version) return { changes: 0 };
    return tx.prepare(`INSERT INTO typesafe_evaluation(id,office_id,user_id,purpose,model,question_version,fingerprint,config_version,status,reserved_tokens,started_at,expires_at,day)
    SELECT ?,?,?,?,?,?,?,?,'running',?,?,?,? WHERE
    (SELECT coalesce(sum(reserved_tokens),0) FROM typesafe_evaluation WHERE day=?) + ? <= ?
    AND (SELECT count(*) FROM typesafe_evaluation WHERE status='running' AND expires_at>?) < ?`)
    .run(id, context.officeId, context.userId, purpose, config.model, request.questionVersion, fingerprint(request), config.version, reserved, now, now + deadline, day,
      day, reserved, config.daily_tokens, now, config.concurrency);
  });
  if (!reservation.changes) return { status: 'budget_exceeded', mode, reason: 'platform_limit' };
  let status: Evaluation['status'] = 'unavailable';
  let reason: string | undefined;
  let response: Evaluation['response'];
  try {
    const apiKey = decryptCredential(config.encrypted_api_key, parseCredentialKeyring());
    signal.throwIfAborted();
    const raw = await (options.send ?? sendDecision)(apiKey, { state: request.state, questions: request.questions, model: config.model }, signal);
    signal.throwIfAborted();
    response = decisionResponse.parse(raw);
    if (response.model !== config.model || Object.keys(response.answers).length !== sizes.length) throw new Error('invalid_response');
    for (const [name, question] of Object.entries(request.questions)) {
      const answer = response.answers[name];
      if (!answer || answer.type !== question.type) throw new Error('invalid_response');
      if (answer.type === 'choice' && question.type === 'choice' && (!Object.hasOwn(question.criteria, answer.choice)
        || Object.keys(answer.probabilities).sort().join() !== Object.keys(question.criteria).sort().join())) throw new Error('invalid_response');
      if (answer.type === 'score' && question.type === 'score' && (answer.score < 0 || answer.score > question.criteria.length - 1
        || Object.keys(answer.probabilities).sort().join() !== question.criteria.map((_, i) => String(i)).sort().join())) throw new Error('invalid_response');
      if ('probabilities' in answer && Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) > 0.02) throw new Error('invalid_response');
    }
    const current = await getConnection();
    if (!current?.enabled || current.version !== config.version) throw new Error('configuration_changed');
    status = 'evaluated';
    await database.prepare('UPDATE typesafe_platform_connection SET failures=0,circuit_until=0 WHERE id=1 AND version=?').run(config.version);
  } catch (error) {
    const httpStatus = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    reason = signal.aborted ? 'cancelled_or_timeout' : httpStatus === 401 || httpStatus === 403 ? 'credential' : 'invalid_or_unavailable';
    response = undefined;
    await database.prepare(`UPDATE typesafe_platform_connection SET failures=failures+1,circuit_until=CASE WHEN failures>=2 THEN ? ELSE circuit_until END,
      enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE id=1 AND version=?`).run(Date.now() + 30000, Number(reason === 'credential'), config.version);
  }
  await database.prepare('UPDATE typesafe_evaluation SET status=?,reason=?,input_tokens=?,output_tokens=?,duration_ms=? WHERE id=?')
    .run(status, reason ?? null, response?.usage.input_tokens ?? null, response?.usage.output_tokens ?? null, Date.now() - now, id);
  // Keep the conservative reservation even after timeout: attempted calls can be charged.
  return { status, mode, evaluationId: id, ...(reason ? { reason } : {}), ...(response ? { response } : {}) };
}
