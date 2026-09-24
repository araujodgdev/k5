import 'server-only';
import type { CapabilityInput as Input } from '@/lib/capabilities/contracts';
import { googleModules, googleOAuthConfig, googlePickerConfig, calendarWebhookUrl, moduleLabels, modulesForScopes } from '@/lib/google/config';
import { findLiveConnection, rolloutFor } from '@/lib/google/connections';
import { googleActionNames, googleActions, readPolicy, savePolicy as storePolicy, technicalLimits, type PolicyRules } from '@/lib/google/policy';
import { listOfficeAudit, listOwnOperations } from '@/lib/google/operations';
import type { WorkspaceContext } from './context';

export async function getStatus(context: WorkspaceContext) {
  const [connection, rollout, policy] = await Promise.all([findLiveConnection(context), rolloutFor(context.officeId), readPolicy(context.officeId)]);
  const granted = connection ? modulesForScopes(connection.granted_scopes) : [];
  return {
    configured: Boolean(googleOAuthConfig()),
    connection: connection ? {
      email: connection.email, displayName: connection.display_name, status: connection.status as 'active' | 'reauth_required',
      grantedModules: granted, connectedAt: connection.connected_at,
    } : null,
    modules: googleModules.map(module => ({ module, label: moduleLabels[module], rolledOut: rollout[module], enabledByOffice: policy.rules.modules[module], granted: granted.includes(module) })),
    pickerAvailable: Boolean(googlePickerConfig()),
    pushAvailable: Boolean(calendarWebhookUrl()),
  };
}

function policyView(policy: Awaited<ReturnType<typeof readPolicy>>) {
  return {
    version: policy.version, updatedAt: policy.updatedAt, rules: policy.rules,
    actions: googleActionNames.map(action => ({ action, module: googleActions[action].module, label: googleActions[action].label, limits: [...googleActions[action].limits] })),
    technicalLimits: { ...technicalLimits },
  };
}

export async function getPolicy(context: WorkspaceContext) { return policyView(await readPolicy(context.officeId)); }

export async function savePolicy(context: WorkspaceContext, input: Input<'k5_google_save_policy'>) {
  return policyView(await storePolicy(context.officeId, context.userId, input.version, input.rules as PolicyRules));
}

export async function listAudit(context: WorkspaceContext, input: Input<'k5_google_list_audit'>) {
  return listOfficeAudit(context.officeId, input.limit ?? 50);
}

export async function listOperations(context: WorkspaceContext, input: Input<'k5_google_list_operations'>) {
  return { operations: await listOwnOperations(context, { status: input.status, limit: input.limit ?? 20 }) };
}
