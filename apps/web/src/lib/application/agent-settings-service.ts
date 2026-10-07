import 'server-only';
import { contentResult, mapContentResult, ownedContentResult, payloadDigest, type ContentIdentity } from '@/lib/content-result';
import { documentTransaction } from '@/lib/documents/service';
import { assertPolicyAccess, parsePolicy, privateGenerationPolicy } from '@/lib/content-policy';
import { canonicalInput, createApprovalProposal, type ApprovalRow } from './approvals-service';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertCapabilityAllowed } from './context';
import type { WorkspaceContext } from './context';
import type { CapabilityInput } from '@/lib/capabilities/contracts';
import { listInstructions, saveInstruction, deleteInstruction } from '@/lib/agent-instructions';
import { listKnowledge, addKnowledge, updateKnowledge, removeKnowledge } from '@/lib/agent-knowledge';
import { documentTemplates, setDocumentTemplate } from '@/lib/agent-profile';

type AgentSettings = { instructions: Awaited<ReturnType<typeof listInstructions>>; knowledge: Awaited<ReturnType<typeof listKnowledge>>; templates: Awaited<ReturnType<typeof documentTemplates>> };
export async function getAgentSettings(context: WorkspaceContext): Promise<AgentSettings> {
  if (!context.contentTransaction) return documentTransaction(context, tx => getAgentSettings({ ...context, contentTransaction: tx }));
  const instructions = await listInstructions(context);
  const knowledge = await listKnowledge(context);
  const templates = await documentTemplates(context);
  return mapContentResult({ instructions, knowledge, templates }, instructions, knowledge, templates);
}

export async function changeAgentSettings(context: WorkspaceContext, input: CapabilityInput<'k5_agent_settings_change'>) {
  const { approvalId, ...payload } = input;
  const { scope = 'personal', change } = payload;
  const outcome = await documentTransaction(context, async tx => {
    await assertCapabilityAllowed(context, 'k5_agent_settings_change', tx);
    let approval: ApprovalRow & { content_policy: unknown } | undefined;
    if (context.invocation) {
      if (!approvalId) {
        const policy = await privateGenerationPolicy(context, tx);
        await assertPolicyAccess(context.userId, policy, tx);
        const proposal = await createApprovalProposal(context, 'k5_agent_settings_change', payload, null, null, 600_000, tx);
        await tx.prepare('UPDATE capability_approval SET content_policy=?::jsonb WHERE id=?').run(JSON.stringify(policy), proposal.id);
        return { proposalId: proposal.id };
      }
      approval = await tx.prepare('SELECT * FROM capability_approval WHERE id=? AND office_id=? AND user_id=? FOR UPDATE')
        .get<ApprovalRow & { content_policy: unknown }>(approvalId, context.officeId, context.userId);
      if (!approval || approval.capability_name !== 'k5_agent_settings_change' || approval.normalized_input !== canonicalInput(payload)) throw new CapabilityError('FORBIDDEN', 'Esta confirmação não corresponde à alteração.');
      const policy = approval.content_policy ? parsePolicy(approval.content_policy) : await privateGenerationPolicy(context, tx);
      await assertPolicyAccess(context.userId, policy, tx);
      if (approval.status === 'consumed' && approval.content_result) {
        const saved = approval.content_result as { value?: Awaited<ReturnType<typeof getAgentSettings>>; policies?: unknown[]; payloadDigest?: string; identities?: ContentIdentity[] };
        if (!saved.value || !saved.policies || saved.payloadDigest !== payloadDigest(saved.value)) throw new CapabilityError('NOT_FOUND', 'O resultado original não está disponível.');
        const policies = saved.policies.map(value => parsePolicy(value));
        for (const policy of policies) await assertPolicyAccess(context.userId, policy, tx);
        return { settings: contentResult(saved.value, policies, saved.identities) };
      }
      if (approval.status !== 'approved' || approval.expires_at < Date.now()) throw new CapabilityError('CONFLICT', 'Esta confirmação não está disponível.');
      context = { ...context, contentSources: [policy] };
    }
    context = { ...context, contentTransaction: tx };
    switch (change.action) {
    case 'create_instruction': await saveInstruction(context, scope, change); break;
    case 'update_instruction': await saveInstruction(context, scope, change, { id: change.id, version: change.version }); break;
    case 'delete_instruction': await deleteInstruction(context, scope, change.id); break;
    case 'add_knowledge': await addKnowledge(context, scope, change.documentId, change.mode, change.note); break;
    case 'update_knowledge': await updateKnowledge(context, scope, change.id, change.version, change.mode, change.note); break;
    case 'remove_knowledge': await removeKnowledge(context, scope, change.id); break;
    case 'set_template': await setDocumentTemplate(context, scope, change.documentId); break;
    default: { const exhaustive: never = change; return exhaustive; }
  }
    const settings = await getAgentSettings(context);
    if (approval) await tx.prepare("UPDATE capability_approval SET status='consumed',consumed_at=CURRENT_TIMESTAMP,content_result=?::jsonb WHERE id=?").run(JSON.stringify(ownedContentResult(settings)), approval.id);
    return { settings };
  });
  if ('proposalId' in outcome) throw new CapabilityError('APPROVAL_REQUIRED', `Revise a alteração das preferências. Proposta registrada [id: ${outcome.proposalId}].`);
  return outcome.settings;
}
