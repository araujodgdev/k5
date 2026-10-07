import { contentResult, ownedContentResult, payloadDigest } from '@/lib/content-result';
import 'server-only';
import { z } from 'zod';
import { database } from '@/lib/database';
import { aclReadTransaction } from '@/lib/acl-transaction';
import { artifactPolicy, assertPolicyAccess, assertSourceGuards, contentDigest, exposedPolicies, exposedSourcePolicies, exposeContent,
  observePage, observeVaultFile, vaultPolicy, parsePolicy, privateGenerationPolicy, personPolicy, type ContentPolicy } from '@/lib/content-policy';
import type { Capability } from '@/lib/capabilities/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertWorkspaceSession, type WorkspaceContext } from './context';

const identity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), id: z.string(), version: z.number().int().positive(), digest: z.string() }),
  z.object({ kind: z.literal('page'), id: z.string(), caseId: z.string(), version: z.number().int().positive(), digest: z.string() }),
  z.object({ kind: z.literal('document'), id: z.string(), version: z.number().int().positive(), digest: z.string() }),
  z.object({ kind: z.literal('annex-plan'), id: z.string() }),
]);
const bindingSchema = z.object({ format: z.literal(2), payloadDigest: z.string(), contentIdentities: z.array(z.object({ kind: z.string(), id: z.string(), version: z.union([z.string(), z.number()]), digest: z.string() })), identities: z.array(identity), policies: z.array(z.unknown()), sources: z.record(z.string(), z.unknown()).optional() });
export type ReplayBinding = z.infer<typeof bindingSchema>;
const unavailable = () => new CapabilityError('NOT_FOUND', 'O resultado original não está disponível ou seu acesso foi removido.');

export async function captureCapabilityReplay(context: WorkspaceContext, capability: Capability, result: unknown): Promise<ReplayBinding> {
  const value = z.record(z.string(), z.unknown()).parse(result);
  const identities: ReplayBinding['identities'] = [];
  const policies: ContentPolicy[] = [...exposedPolicies(result) ?? []];
  const owned = ownedContentResult(result);
  if ((capability.contentResult === 'owned' || capability.module === 'agent_settings') && !owned) throw unavailable();
  if (capability.module === 'vault') {
    if (value.case) policies.push({ ...personPolicy('', ''), guards: [{ kind: 'case', id: z.object({ id: z.string() }).parse(value.case).id }] });
    if (value.folder) {
      const folder = z.object({ id: z.string(), caseId: z.string() }).parse(value.folder);
      policies.push({ ...personPolicy('', ''), guards: [{ kind: 'folder', id: folder.id, caseId: folder.caseId }] });
    }
  }
  if (capability.exposure === 'artifact' && value.artifact) {
    const artifact = z.object({ id: z.string(), version: z.number(), title: z.string(), content: z.string() }).parse(value.artifact);
    const policy = await artifactPolicy(context, artifact.id, database, artifact.version);
    parsePolicy(policy, contentDigest(artifact.title, artifact.content));
    identities.push({ kind: 'artifact', id: artifact.id, version: artifact.version, digest: policy.digest });
    policies.push(policy);
  }
  if (capability.exposure === 'page' && value.page) {
    const page = z.object({ id: z.string(), caseId: z.string(), version: z.number() }).parse(value.page);
    const source = await observePage(context.userId, page.id, page.caseId, database, page.version);
    identities.push({ kind: 'page', id: page.id, caseId: page.caseId, version: page.version, digest: source.policy.digest });
    policies.push(source.policy);
  }
  if (capability.exposure === 'document') {
    const documents = [value.document, ...(Array.isArray(value.documents) ? value.documents : [])].filter(Boolean);
    for (const document of documents) {
      const { id, version } = z.object({ id: z.string(), version: z.number().optional() }).parse(document);
      const source = await observeVaultFile(context.userId, id);
      if (version !== undefined && version !== source.version || typeof value.version === 'number' && value.document === document && value.version !== source.version)
        throw new CapabilityError('CONFLICT', 'O arquivo mudou antes de registrar o resultado desta operação.');
      identities.push({ kind: 'document', id, version: source.version, digest: source.sha256 });
      policies.push(source.policy);
    }
  }
  if (capability.replay === 'annex-plan') {
    const { planId } = z.object({ planId: z.string() }).parse(value);
    const plan = await database.prepare('SELECT content_policy FROM annex_plan WHERE id=? AND office_id=? AND user_id=?')
      .get<{ content_policy: unknown }>(planId, context.officeId, context.userId);
    if (!plan) throw unavailable();
    identities.push({ kind: 'annex-plan', id: planId });
    policies.push(parsePolicy(plan.content_policy));
  }
  if (!owned && !policies.length && capability.exposure !== 'none') policies.push(await privateGenerationPolicy(context));
  for (const policy of policies) await assertPolicyAccess(context.userId, policy);
  return { format: 2, payloadDigest: payloadDigest(result), contentIdentities: [...owned?.identities ?? []], identities, policies, sources: exposedSourcePolicies(result) };
}

export async function replayCapabilityResult(context: WorkspaceContext, result: unknown, rawBinding: unknown): Promise<unknown> {
  const parsed = bindingSchema.safeParse(rawBinding);
  if (!parsed.success) throw unavailable();
  const binding = parsed.data;
  if (binding.payloadDigest !== payloadDigest(result)) throw unavailable();
  const policies = binding.policies.map(policy => parsePolicy(policy));
  return aclReadTransaction(async tx => {
    await assertWorkspaceSession(context, tx);
    for (const ref of binding.identities) {
      if (ref.kind === 'artifact') parsePolicy(await artifactPolicy(context, ref.id, tx, ref.version), ref.digest);
      else if (ref.kind === 'page') parsePolicy((await observePage(context.userId, ref.id, ref.caseId, tx, ref.version)).policy, ref.digest);
      else if (ref.kind === 'document') {
        await assertSourceGuards(context.userId, [{ kind: 'document', id: ref.id }], tx);
        await assertPolicyAccess(context.userId, parsePolicy(await vaultPolicy(ref.id, ref.version, tx), ref.digest), tx);
      } else if (!await tx.prepare('SELECT 1 FROM annex_plan WHERE id=? AND office_id=? AND user_id=?').get(ref.id, context.officeId, context.userId)) throw unavailable();
    }
    for (const policy of policies) await assertPolicyAccess(context.userId, policy, tx);
    await assertWorkspaceSession(context, tx);
    return result && typeof result === 'object' ? exposeContent(contentResult(result, policies, binding.contentIdentities), policies, binding.sources
      ? Object.fromEntries(Object.entries(binding.sources).map(([key, policy]) => [key, parsePolicy(policy)])) : undefined) : result;
  });
}
