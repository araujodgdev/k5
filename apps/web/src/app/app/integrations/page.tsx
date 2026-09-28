import { requireWorkspace } from '@/lib/session';
import { IntegrationsPanel } from '@/components/google/integrations-panel';
import { WhatsAppConnectionPanel } from '@/components/whatsapp/connection-panel';

export const metadata = { title: 'Integrações' };
export default async function IntegrationsPage() {
  const { office } = await requireWorkspace();
  return <>
    <IntegrationsPanel role={office.role} />
    <div className="mx-auto w-full max-w-5xl px-5 pb-6 md:px-10 md:pb-10"><WhatsAppConnectionPanel /></div>
  </>;
}
