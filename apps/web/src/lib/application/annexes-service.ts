import 'server-only';
import type { WorkspaceContext } from './context';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { analyzeAnnexes, generateAnnexes, getAnnexPlan } from '@/lib/annexes';
import { asCapabilityError } from './vault-service';
import { assertCapabilityAllowed } from './context';
import { exposeContent, exposedPolicies } from '@/lib/content-policy';
export const readAnnexPlan = getAnnexPlan;

export async function planAnnexes(context: WorkspaceContext, input: CapabilityInput<'k5_vault_plan_annexes'>): Promise<CapabilityOutput<'k5_vault_plan_annexes'>> {
  try { const result = await analyzeAnnexes(context, input); await assertCapabilityAllowed(context, 'k5_vault_plan_annexes'); return result; } catch (error) { throw asCapabilityError(error); }
}
export async function createAnnexFiles(context: WorkspaceContext, input: CapabilityInput<'k5_vault_generate_annexes'>): Promise<CapabilityOutput<'k5_vault_generate_annexes'>> {
  try {
    const result = await generateAnnexes(context, input, () => assertCapabilityAllowed(context, 'k5_vault_generate_annexes'));
    return exposeContent({ folderId: result.folderId, documents: result.documents.map(document => ({ id: document.id, name: document.name })) }, exposedPolicies(result)!);
  } catch (error) { throw asCapabilityError(error); }
}
