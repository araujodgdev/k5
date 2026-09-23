import 'server-only';
import type { WorkspaceContext } from './context';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { analyzeAnnexes, generateAnnexes } from '@/lib/annexes';
import { asCapabilityError } from './vault-service';

export async function planAnnexes(context: WorkspaceContext, input: CapabilityInput<'k5_vault_plan_annexes'>): Promise<CapabilityOutput<'k5_vault_plan_annexes'>> {
  try { return await analyzeAnnexes(context, input); } catch (error) { throw asCapabilityError(error); }
}
export async function createAnnexFiles(context: WorkspaceContext, input: CapabilityInput<'k5_vault_generate_annexes'>): Promise<CapabilityOutput<'k5_vault_generate_annexes'>> {
  try {
    const result = await generateAnnexes(context, input);
    return { folderId: result.folderId, documents: result.documents.map(document => ({ id: document.id, name: document.name })) };
  } catch (error) { throw asCapabilityError(error); }
}
