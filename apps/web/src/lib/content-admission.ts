import 'server-only';
import { createHash } from 'node:crypto';
import { aclReadTransaction } from './acl-transaction';
import type { Transaction } from './database';
import { assertCapabilityAllowed, assertSourcesAdmitted, assertWorkspaceSession, assertLumeAdmission, type WorkspaceContext } from './application/context';
import type { CapabilityName } from './capabilities/contracts';
import { assertPolicyAccess, parsePolicy, type ContentPolicy } from './content-policy';
import { CapabilityError } from './capabilities/errors';
import { caseAccess } from './collaboration/access';

export type ContentAdmission = {
  readonly applicationDigest: string;
  admit(signal?: AbortSignal): Promise<void>;
};

/** Constructed by the owner of the exact input, before configuration, staging or credit waits. */
export function contentAdmission(context: WorkspaceContext, input: unknown, policies: readonly ContentPolicy[],
  options: { capability?: CapabilityName; lease?: (tx: Transaction) => Promise<void> } = {}): ContentAdmission {
  const authority = { ...context, caseScope: context.caseScope ? { ...context.caseScope } : undefined, contentTransaction: undefined };
  const pinned = policies.map(policy => parsePolicy(JSON.parse(JSON.stringify(policy))));
  const applicationDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return {
    applicationDigest,
    async admit(signal) {
      signal?.throwIfAborted();
      authority.signal?.throwIfAborted();
      await aclReadTransaction(async tx => {
        if (!authority.sessionId) throw new CapabilityError('UNAUTHENTICATED', 'A sessão original deste pedido não está disponível.');
        if (options.capability) await assertCapabilityAllowed(authority, options.capability, tx);
        else {
          await assertWorkspaceSession(authority, tx);
          if (authority.caseScope) {
            const access = await caseAccess(authority.userId,authority.caseScope.caseId,tx);
            if (access.officeId !== authority.officeId) throw new CapabilityError('FORBIDDEN','Seu acesso não permite esta operação.');
          } else if (!await tx.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(authority.officeId,authority.userId))
            throw new CapabilityError('FORBIDDEN','Seu acesso ao escritório foi removido.');
        }
        {
          const caseId = authority.caseScope?.caseId ?? authority.allowedResearchCaseId;
          if (caseId) { await caseAccess(authority.userId, caseId, tx); await assertLumeAdmission(caseId, tx); }
        }
        for (const policy of pinned) {
          await assertPolicyAccess(authority.userId, policy, tx);
          await assertSourcesAdmitted(policy, tx);
        }
        await options.lease?.(tx);
        // clock_timestamp is evaluated after lock acquisition, including the lease owner's waits.
        await assertWorkspaceSession(authority, tx);
        signal?.throwIfAborted();
      });
    },
  };
}

/** One latch per invocation, shared by first dispatch, retries and schema repair requests. */
export function admissionTransport(admission: ContentAdmission, downstream: typeof fetch = globalThis.fetch) {
  let denied = false;
  let denial: unknown;
  let attempted = false;
  const wireDigests: string[] = [];
  const admit = async (signal?: AbortSignal) => {
    if (denied) throw denial;
    try {
      await admission.admit(signal);
    } catch (error) {
      denied = true;
      denial = error;
      throw error;
    }
  };
  const guardedFetch: typeof fetch = async (input, init) => {
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : '');
    if (body !== null && typeof body !== 'string' && !(body instanceof Uint8Array)) throw new Error('Unsupported protected wire body.');
    const wireDigest = createHash('sha256').update(body ?? '').digest('hex');
    await admit(init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined);
    attempted = true;
    wireDigests.push(wireDigest);
    const response = await downstream(input, { ...init, redirect: 'manual' });
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Protected provider redirect refused.');
    }
    return response;
  };
  return { fetch: guardedFetch, admit, get wireDigests() { return [...wireDigests]; }, get denied() { return denied; }, get denial() { return denial; }, get attempted() { return attempted; },
    throwIfDenied() { if (denied) throw denial; } };
}
