import { requireWorkspace } from '@/lib/session';
import { IntegrationsPanel } from '@/components/google/integrations-panel';

export const metadata = { title: 'Integrações' };
export default async function IntegrationsPage() {
  const { office } = await requireWorkspace();
  return <IntegrationsPanel role={office.role} />;
}
