import { requireWorkspace } from '@/lib/session';
import { ClientDetail } from '@/components/client-detail';

export const metadata = { title: 'Cliente' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { office } = await requireWorkspace();
  const { id } = await params;
  return <ClientDetail key={id} clientId={id} role={office.role} />;
}
