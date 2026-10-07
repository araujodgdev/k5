import { requireWorkspace } from '@/lib/session';
import { IntegrationsPanel } from '@/components/google/integrations-panel';
import { WhatsAppConnectionPanel } from '@/components/whatsapp/connection-panel';
import { AsaasConnectionPanel } from '@/components/asaas/connection-panel';

export const metadata = { title: 'Integrações' };
export default async function IntegrationsPage() {
  await requireWorkspace();
  return <IntegrationsPanel><WhatsAppConnectionPanel /><AsaasConnectionPanel /></IntegrationsPanel>;
}
