import { z } from 'zod';
import type { Capability } from './contracts';

const id = z.string().min(1).max(128);
const scope = z.enum(['office', 'personal']);
const instruction = { title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(2000), appliesTo: z.enum(['all', 'chat', 'documents']), enabled: z.boolean() };
const instructionDto = z.object({ ...instruction, id, version: z.number(), updatedAt: z.string() });
const knowledge = { mode: z.enum(['always', 'search']), note: z.string().max(300).default('') };
const knowledgeDto = z.object({ ...knowledge, id, documentId: id, name: z.string(), status: z.string(), characters: z.number(), version: z.number() });
const template = z.object({ documentId: id, name: z.string(), status: z.string(), updatedAt: z.string() }).nullable();
const view = z.object({
  instructions: z.object({ office: z.array(instructionDto), personal: z.array(instructionDto) }),
  knowledge: z.object({ office: z.array(knowledgeDto), personal: z.array(knowledgeDto) }),
  templates: z.object({ office: template, personal: template }),
});
export const agentSettingsCapabilities = {
  k5_agent_settings_get: { module: 'agent_settings', effect: 'read', roles: ['administrator', 'lawyer', 'reviewer'],
    description: 'Consulta regras de escrita, documentos de conhecimento e modelo Word do Lume, nos escopos pessoal e escritório.', input: z.object({}), output: view },
  k5_agent_settings_change: { module: 'agent_settings', effect: 'write', roles: ['administrator', 'lawyer'],
    description: 'Cria, atualiza ou remove regra/conhecimento e define/remove modelo Word. Alterações exigem confirmação; escopo office exige administrador. Conhecimento e modelo referenciam documentos já enviados ao Cofre; nunca alteram políticas de segurança.',
    input: z.object({ scope, approvalId: z.uuid().optional(), idempotencyKey: z.string().min(8).max(128), change: z.discriminatedUnion('action', [
      z.object({ action: z.literal('create_instruction'), ...instruction }),
      z.object({ action: z.literal('update_instruction'), id, version: z.number().int().positive(), ...instruction }),
      z.object({ action: z.literal('delete_instruction'), id }),
      z.object({ action: z.literal('add_knowledge'), documentId: id, ...knowledge }),
      z.object({ action: z.literal('update_knowledge'), id, version: z.number().int().positive(), ...knowledge }),
      z.object({ action: z.literal('remove_knowledge'), id }),
      z.object({ action: z.literal('set_template'), documentId: id.nullable() }),
    ]) }), output: view },
} as const satisfies Record<string, Capability>;
