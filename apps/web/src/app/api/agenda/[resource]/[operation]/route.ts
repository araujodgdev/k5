import { handleCapability } from '@/lib/capability-route';
import type { CapabilityName } from '@/lib/capabilities/contracts';

const operations: Record<string, CapabilityName> = {
  'proposals/interpret': 'k5_agenda_interpret', 'proposals/get': 'k5_agenda_get_proposal',
  'proposals/list': 'k5_agenda_list_proposals', 'proposals/apply': 'k5_agenda_apply_proposal',
  'clients/list': 'k5_crm_list_clients', 'clients/get': 'k5_crm_get_client',
  'clients/create': 'k5_crm_create_client', 'clients/update': 'k5_crm_update_client',
  'members/list': 'k5_agenda_list_members', 'activities/list': 'k5_agenda_list_activities',
  'activities/get': 'k5_agenda_get_activity', 'activities/create': 'k5_agenda_create_activity',
  'activities/update': 'k5_agenda_update_activity',
};

export async function POST(request: Request, { params }: { params: Promise<{ resource: string; operation: string }> }) {
  const { resource, operation } = await params;
  const name = operations[`${resource}/${operation}`];
  if (!name) return Response.json({ error: 'Operação não encontrada.' }, { status: 404 });
  return handleCapability(request, name);
}
