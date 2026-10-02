import { requireWorkspace } from '@/lib/session';
import { HonorariosPanel } from '@/components/honorarios/panel';

export default async function HonorariosPage() {
  await requireWorkspace();
  return <HonorariosPanel />;
}
