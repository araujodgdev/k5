import { z } from 'zod';

const id = z.string().min(1).max(64);
export const caseTaskStatus = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const caseTaskFields = z.object({
  title: z.string().trim().min(2).max(180), notes: z.string().max(4000).default(''),
  status: caseTaskStatus.default('pending'),
  dueOn: z.iso.date().nullable().default(null), assigneeId: id.nullable().default(null),
});
export const caseTaskIdentity = z.object({ caseId: id, activityId: id });
export const caseTaskCreate = caseTaskFields.extend({ caseId: id, idempotencyKey: z.string().min(8).max(128), approvalId: id.optional() }).strict();
export const caseTaskUpdate = caseTaskFields.extend(caseTaskIdentity.shape).extend({ version: z.number().int().positive(), approvalId: id.optional() }).strict();
const taskAgentFields = caseTaskFields.omit({ title: true, notes: true }).partial();
export const caseTaskDto = caseTaskFields.extend({
  id, caseId: id, visibility: z.literal('case'), version: z.number().int().positive(),
  createdAt: z.string(), updatedAt: z.string(), agentConversationId: id.optional(),
});
export type CaseTask = z.infer<typeof caseTaskDto>;
export const caseTaskCapabilities = {
  k5_case_tasks_list: { module: 'case_tasks', effect: 'read', untrustedResult: true, description: 'Lista somente tarefas compartilhadas do caso e responsáveis atuais. Tarefas pessoais e conversas de outras pessoas permanecem privadas.', input: z.object({ caseId: id }), output: z.object({ tasks: z.array(caseTaskDto), members: z.array(z.object({ id, name: z.string() })) }) },
  k5_case_tasks_get: { module: 'case_tasks', effect: 'read', untrustedResult: true, description: 'Lê a tarefa compartilhada e sua versão atual.', input: caseTaskIdentity, output: z.object({ task: caseTaskDto }) },
  k5_case_tasks_create: { module: 'case_tasks', effect: 'write', description: 'Prepara uma tarefa compartilhada a partir do pedido original e fontes selecionadas. Informe o caso, responsável e prazo. A pessoa revisa o texto exato antes de publicar.', input: caseTaskCreate, agentInput: taskAgentFields.extend({caseId:id,idempotencyKey:z.string().min(8).max(128)}).strict(), output: z.object({ task: caseTaskDto }) },
  k5_case_tasks_update: { module: 'case_tasks', effect: 'write', description: 'Edita responsável, prazo ou estado comparando a versão lida. Use editText para preparar novos textos a partir do pedido original. Exige confirmação.', input: caseTaskUpdate, agentInput: taskAgentFields.extend(caseTaskIdentity.shape).extend({version:z.number().int().positive(),editText:z.boolean().optional()}).strict(), output: z.object({ task: caseTaskDto }) },
} as const;
