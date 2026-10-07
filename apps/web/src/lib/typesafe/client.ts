import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { TypeSafeClient, type EntryType, type Questions } from '@typesafe-ai/sdk';
import { database, withTransaction } from '@/lib/database';
import { decryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { decisionResponse, type DecisionPurpose, type Evaluation } from './contracts';
import { getConnection } from './config';
import { captureOperationalError } from '@/lib/observability/report';
import { admissionTransport, type ContentAdmission } from '@/lib/content-admission';

export type DecisionRequest = { state: EntryType; questions: Questions; model: string };
export type DecisionTransport = (key: string, request: DecisionRequest, signal: AbortSignal) => Promise<unknown>;
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class EvaluationConfigurationChanged extends Error {}

/**
 * One platform connection serves every office; evaluations still record the office they ran for.
 * No caller-provided office, keys or provider errors cross the public capability boundary.
 */
export async function evaluate(
  context: { officeId: string | null; userId: string | null },
  purpose: DecisionPurpose,
  requestInput: Omit<DecisionRequest, 'model'> & { questionVersion: string },
  options: { signal?: AbortSignal; deadlineMs?: number; send?: DecisionTransport; test?: boolean; admission: ContentAdmission; expectedConfiguration?: { version: number; model: string } },
): Promise<Evaluation> {
  const transport = admissionTransport({ applicationDigest: options.admission.applicationDigest, async admit(signal) {
    signal?.throwIfAborted();
    const current = await getConnection();
    signal?.throwIfAborted();
    if (!current?.enabled || current.version !== config?.version || current.model !== config?.model ||
        options.expectedConfiguration && (current.version !== options.expectedConfiguration.version || current.model !== options.expectedConfiguration.model))
      throw new EvaluationConfigurationChanged();
    await options.admission.admit(signal);
  } });
  const request = structuredClone(requestInput);
  options.signal?.throwIfAborted();
  let injectedAttempted = false;
  const config = await getConnection();
  const mode = options.test ? 'shadow' : config?.[`${purpose}_mode`] ?? 'off';
  if (options.expectedConfiguration && (!config?.enabled || config.version !== options.expectedConfiguration.version || config.model !== options.expectedConfiguration.model))
    return { status: 'unavailable', mode, reason: 'configuration_changed' };
  if (!config?.enabled || !config.encrypted_api_key || mode === 'off') return { status: 'disabled', mode };
  const now = Date.now();
  const deadline = options.deadlineMs ?? ({ rag: 2000, agenda: 5000, documents: 10000, research: 10000, feedback: 10000, email: 10000 })[purpose];
  const signal = AbortSignal.any([AbortSignal.timeout(deadline), ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  if (config.circuit_until > now) return { status: 'unavailable', mode, reason: 'temporarily_unavailable' };
  const sizes = Object.values(request.questions).map(q => Buffer.byteLength(JSON.stringify(q)));
  const stateBytes = Buffer.byteLength(JSON.stringify(request.state));

  const reserved = stateBytes + sizes.reduce((a, b) => a + b, 0) + sizes.length * 256 + 512;
  if (!sizes.length || stateBytes + Math.max(...sizes) > 28_000 || reserved > 60_000) return { status: 'budget_exceeded', mode, reason: 'context_limit' };
  const id = randomUUID();
  const day = new Date(now).toISOString().slice(0, 10);
  const reservation = await withTransaction(async tx => {

    const live = await tx.prepare('SELECT version,enabled FROM typesafe_platform_connection WHERE id=1 FOR UPDATE').get<{ version: number; enabled: number }>();
    if (options.expectedConfiguration && (!live?.enabled || live.version !== options.expectedConfiguration.version)) return 'configuration_changed';
    if (!live?.enabled) return 'disabled';
    if (live.version !== config.version || options.expectedConfiguration && live.version !== options.expectedConfiguration.version) return 'configuration_changed';
    const inserted = await tx.prepare(`INSERT INTO typesafe_evaluation(id,office_id,user_id,purpose,model,question_version,fingerprint,config_version,status,reserved_tokens,started_at,expires_at,day)
    SELECT ?,?,?,?,?,?,?,?,'running',?,?,?,? WHERE
    (SELECT coalesce(sum(reserved_tokens),0) FROM typesafe_evaluation WHERE day=?) + ? <= ?
    AND (SELECT count(*) FROM typesafe_evaluation WHERE status='running' AND expires_at>?) < ?`)
    .run(id, context.officeId, context.userId, purpose, config.model, request.questionVersion, fingerprint(request), config.version, reserved, now, now + deadline, day,
      day, reserved, config.daily_tokens, now, config.concurrency);
    return inserted.changes ? 'reserved' : 'platform_limit';
  });
  if (reservation === 'disabled') return { status: 'disabled', mode };
  if (reservation === 'configuration_changed') return { status: 'unavailable', mode, reason: 'configuration_changed' };
  if (reservation === 'platform_limit') return { status: 'budget_exceeded', mode, reason: 'platform_limit' };
  let status: Evaluation['status'] = 'unavailable';
  let reason: string | undefined;
  let response: Evaluation['response'];
  try {
    const apiKey = decryptCredential(config.encrypted_api_key, parseCredentialKeyring());
    signal.throwIfAborted();
    const payload = { state: request.state, questions: request.questions, model: config.model };
    const raw = options.send ? await (async () => {
      await transport.admit(signal);
      injectedAttempted = true;
      return options.send!(apiKey, payload, signal);
    })() : await new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai', logLevel: 'off',
      retry: { maxRetries: 0 }, timeout: 10_000, fetch: transport.fetch }).systemOne(payload, { signal });
    transport.throwIfDenied();
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
    if (!current?.enabled || current.version !== config.version || current.model !== config.model) throw new EvaluationConfigurationChanged();
    status = 'evaluated';
    await database.prepare('UPDATE typesafe_platform_connection SET failures=0,circuit_until=0 WHERE id=1 AND version=?').run(config.version);
  } catch (error) {
    if (error instanceof EvaluationConfigurationChanged || transport.denial instanceof EvaluationConfigurationChanged) {
      await database.prepare("UPDATE typesafe_evaluation SET status='unavailable',reason='configuration_changed',reserved_tokens=CASE WHEN ? THEN reserved_tokens ELSE 0 END,duration_ms=? WHERE id=?")
        .run(Number(transport.attempted || injectedAttempted), Date.now() - now, id);
      return { status: 'unavailable', mode, evaluationId: id, reason: 'configuration_changed' };
    }
    if (signal.aborted && !transport.denied) {
      try { await database.prepare("UPDATE typesafe_evaluation SET status='unavailable',reason='cancelled',reserved_tokens=CASE WHEN ? THEN reserved_tokens ELSE 0 END,duration_ms=? WHERE id=?")
        .run(Number(transport.attempted || injectedAttempted), Date.now() - now, id); }
      catch (accountingError) {captureOperationalError(accountingError,'typesafe.cancellation-accounting');}
      throw signal.reason;
    }
    if (transport.denied) {
      try {
        await database.prepare("UPDATE typesafe_evaluation SET status='unavailable',reason='denied',reserved_tokens=CASE WHEN ? THEN reserved_tokens ELSE 0 END,duration_ms=? WHERE id=?")
          .run(Number(transport.attempted || injectedAttempted), Date.now() - now, id);
      } catch (accountingError) { captureOperationalError(accountingError, 'typesafe.denial-accounting'); }
      transport.throwIfDenied();
    }
    const httpStatus = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
    reason = signal.aborted ? 'cancelled_or_timeout' : httpStatus === 401 || httpStatus === 403 ? 'credential' : 'invalid_or_unavailable';
    if (!options.signal?.aborted) captureOperationalError(error, 'typesafe.evaluate', { purpose, reason });
    response = undefined;
    await database.prepare(`UPDATE typesafe_platform_connection SET failures=failures+1,circuit_until=CASE WHEN failures>=2 THEN ? ELSE circuit_until END,
      enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE id=1 AND version=?`).run(Date.now() + 30000, Number(reason === 'credential'), config.version);
  }
  await database.prepare('UPDATE typesafe_evaluation SET status=?,reason=?,input_tokens=?,output_tokens=?,duration_ms=? WHERE id=?')
    .run(status, reason ?? null, response?.usage.input_tokens ?? null, response?.usage.output_tokens ?? null, Date.now() - now, id);

  return { status, mode, evaluationId: id, ...(reason ? { reason } : {}), ...(response ? { response } : {}) };
}
