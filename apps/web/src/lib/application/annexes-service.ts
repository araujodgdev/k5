import 'server-only';
import type { WorkspaceContext } from './context';
import type { CapabilityInput, CapabilityOutput } from '@/lib/capabilities/contracts';
import { analyzeAnnexes, generateAnnexes } from '@/lib/annexes';
import { asCapabilityError } from './vault-service';
import { requireAgentApproval } from './approvals-service';

export async function planAnnexes(context: WorkspaceContext, input: CapabilityInput<'k5_vault_plan_annexes'>): Promise<CapabilityOutput<'k5_vault_plan_annexes'>> {
  try { return await analyzeAnnexes(context, input); } catch (error) { throw asCapabilityError(error); }
}
export async function createAnnexFiles(context: WorkspaceContext, input: CapabilityInput<'k5_vault_generate_annexes'>): Promise<CapabilityOutput<'k5_vault_generate_annexes'>> {
  // Cutting pages is not verified by code, so the agent's call waits for Confirmar in the chat.
  const proposal = { caseId: input.caseId, scanDocumentId: input.scanDocumentId, folderName: input.folderName, items: input.items };
  await requireAgentApproval(context, 'k5_vault_generate_annexes', input.approvalId, proposal, input.caseId, 'Gerar os anexos pede confirmação.');
  try {
    const result = await generateAnnexes(context, proposal);
    return { folderId: result.folderId, documents: result.documents.map(document => ({ id: document.id, name: document.name })) };
  } catch (error) { throw asCapabilityError(error); }
}
