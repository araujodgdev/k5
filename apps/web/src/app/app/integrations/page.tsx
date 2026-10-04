import { requireWorkspace } from '@/lib/session';
import { IntegrationsPanel } from '@/components/google/integrations-panel';
import { WhatsAppConnectionPanel } from '@/components/whatsapp/connection-panel';
import { AsaasConnectionPanel } from '@/components/asaas/connection-panel';

export const metadata = { title: 'Integrações' };
export default async function IntegrationsPage() {
  await requireWorkspace();
  return <>
    <IntegrationsPanel />
    <div className="grid w-full max-w-5xl gap-8 px-5 pb-6 md:px-10 md:pb-10"><WhatsAppConnectionPanel /><AsaasConnectionPanel /></div>
  </>;
}
