import { requireWorkspace } from '@/lib/session';
import { HonorariosPanel } from '@/components/honorarios/panel';

export default async function HonorariosPage() {
  const { office } = await requireWorkspace();
  return <HonorariosPanel canCreate={office.role !== 'reviewer'} />;
}
