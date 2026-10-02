import 'server-only';
import type { WorkspaceContext } from './context';
import type { CapabilityInput } from '@/lib/capabilities/contracts';
import { listInstructions, saveInstruction, deleteInstruction } from '@/lib/agent-instructions';
import { listKnowledge, addKnowledge, updateKnowledge, removeKnowledge } from '@/lib/agent-knowledge';
import { documentTemplates, setDocumentTemplate } from '@/lib/agent-profile';

export async function getAgentSettings(context: WorkspaceContext) {
  const [instructions, knowledge, templates] = await Promise.all([listInstructions(context), listKnowledge(context), documentTemplates(context)]);
  return { instructions, knowledge, templates };
}

export async function changeAgentSettings(context: WorkspaceContext, { scope = 'personal', change }: CapabilityInput<'k5_agent_settings_change'>) {
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
  return getAgentSettings(context);
}
