import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { ClientDetail } from '@/components/client-detail';

export const metadata = { title: 'Cliente' };

async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <ClientDetail key={id} clientId={id} />;
}

export default officePage('/app/agenda/clients/[id]', ClientPage);
