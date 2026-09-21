import { z } from 'zod';
import type { Capability } from './contracts';

const readers = ['administrator', 'lawyer', 'reviewer'] as const;
const writers = ['administrator', 'lawyer'] as const;
const id = z.string().min(1).max(64);
const key = z.string().min(8).max(128).optional();
const page = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100000).default(0) };
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const clientFields = {
  name: z.string().trim().min(2).max(180),
  email: z.union([z.email().max(200), z.literal('')]).nullable().default(null),
  phone: z.string().trim().max(40).nullable().default(null),
  notes: z.string().trim().max(8000).default(''),
  stage: z.enum(['prospect', 'active', 'archived']).default('prospect'),
  caseIds: z.array(id).max(100).default([]),
};
export const crmClientDto = z.object({ ...clientFields, id, version: z.number(), createdAt: z.string(), updatedAt: z.string() });
const activityFields = {
  kind: z.enum(['task', 'meeting']), title: z.string().trim().min(2).max(180),
  notes: z.string().trim().max(8000).default(''),
  status: z.enum(['pending', 'completed', 'cancelled']).default('pending'),
  dueOn: date.nullable().default(null), startsAt: instant.nullable().default(null), endsAt: instant.nullable().default(null),
  clientId: id.nullable().default(null), caseId: id.nullable().default(null), assigneeId: id.nullable().default(null),
};
export const activityDto = z.object({ ...activityFields, id, version: z.number(), createdAt: z.string(), updatedAt: z.string() });
export const activityData = z.object(activityFields).superRefine((value, ctx) => {
  if (value.kind === 'meeting' ? (!value.startsAt || !value.endsAt || Date.parse(value.endsAt) <= Date.parse(value.startsAt) || value.dueOn !== null) : (value.startsAt !== null || value.endsAt !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Reuniões exigem início e fim posterior; tarefas usam apenas uma data.' });
  }
});
export const agendaCapabilities = {
  k5_crm_list_clients: { module: 'agenda', effect: 'read', roles: readers,
    description: 'Lista clientes do CRM do escritório, com busca, etapa e paginação.',
    input: z.object({ query: z.string().trim().max(180).optional(), stage: clientFields.stage.removeDefault().optional(), caseId: id.optional(), ...page }),
    output: z.object({ clients: z.array(crmClientDto), total: z.number() }) },
  k5_crm_get_client: { module: 'agenda', effect: 'read', roles: readers,
    description: 'Consulta contato, observações, etapa, casos e versão de um cliente.',
    input: z.object({ clientId: id }), output: z.object({ client: crmClientDto }) },
  k5_crm_create_client: { module: 'agenda', effect: 'write', roles: writers,
    description: 'Cadastra um cliente no CRM e vincula casos existentes do escritório. Consulte antes para evitar duplicatas.',
    input: z.object({ ...clientFields, idempotencyKey: key }), output: z.object({ client: crmClientDto }) },
  k5_crm_update_client: { module: 'agenda', effect: 'write', roles: writers,
    description: 'Atualiza campos informados de um cliente; caseIds substitui os vínculos. Exige versão consultada; arquive com stage=archived.',
    input: z.object({ name: clientFields.name.optional(), email: clientFields.email.removeDefault().optional(), phone: clientFields.phone.removeDefault().optional(), notes: clientFields.notes.removeDefault().optional(), stage: clientFields.stage.removeDefault().optional(), caseIds: clientFields.caseIds.removeDefault().optional(), clientId: id, version: z.number().int().positive(), idempotencyKey: key }), output: z.object({ client: crmClientDto }) },
  k5_agenda_list_members: { module: 'agenda', effect: 'read', roles: readers,
    description: 'Lista integrantes do escritório para escolher o responsável de uma atividade.',
    input: z.object({}), output: z.object({ members: z.array(z.object({ id, name: z.string() })) }) },
  k5_agenda_list_activities: { module: 'agenda', effect: 'read', roles: readers,
    description: 'Lista tarefas humanas e reuniões (não jobs de documentos). Filtre tarefas por dueFrom/dueTo (datas inclusivas), reuniões por from/to (instantes, sobreposição). Sem datas inclui tarefas sem data. Paginação por offset.',
    input: z.object({ kind: activityFields.kind.optional(), status: activityFields.status.removeDefault().optional(), clientId: id.optional(), caseId: id.optional(), assigneeId: id.optional(), query: z.string().trim().max(180).optional(), dueFrom: date.optional(), dueTo: date.optional(), from: instant.optional(), to: instant.optional(), ...page }),
    output: z.object({ activities: z.array(activityDto), total: z.number() }) },
  k5_agenda_get_activity: { module: 'agenda', effect: 'read', roles: readers,
    description: 'Consulta uma tarefa ou reunião e sua versão antes de editar.', input: z.object({ activityId: id }), output: z.object({ activity: activityDto }) },
  k5_agenda_create_activity: { module: 'agenda', effect: 'write', roles: writers,
    description: 'Cria tarefa ou reunião interna. Tarefa usa dueOn opcional; reunião exige startsAt e endsAt ISO com offset. Não envia convite nem calcula prazo judicial. Esclareça horários ambíguos.',
    input: z.object({ ...activityFields, idempotencyKey: key }), output: z.object({ activity: activityDto }) },
  k5_agenda_update_activity: { module: 'agenda', effect: 'write', roles: writers,
    description: 'Edita, reagenda, conclui (completed), cancela (cancelled) ou reabre (pending) uma atividade. Exige versão consultada; campos omitidos são preservados.',
    input: z.object({ kind: activityFields.kind.optional(), title: activityFields.title.optional(), notes: activityFields.notes.removeDefault().optional(), status: activityFields.status.removeDefault().optional(), dueOn: activityFields.dueOn.removeDefault().optional(), startsAt: activityFields.startsAt.removeDefault().optional(), endsAt: activityFields.endsAt.removeDefault().optional(), clientId: activityFields.clientId.removeDefault().optional(), caseId: activityFields.caseId.removeDefault().optional(), assigneeId: activityFields.assigneeId.removeDefault().optional(), activityId: id, version: z.number().int().positive(), idempotencyKey: key }), output: z.object({ activity: activityDto }) },
} as const satisfies Record<string, Capability>;

export type CrmClient = z.output<typeof crmClientDto>;
export type AgendaActivity = z.output<typeof activityDto>;
