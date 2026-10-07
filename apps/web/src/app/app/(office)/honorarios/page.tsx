import { requireWorkspace } from '@/lib/session';
import { HonorariosPanel } from '@/components/honorarios/panel';

export const metadata = { title: 'Honorários' };

export default async function HonorariosPage() {
  await requireWorkspace();
  return <HonorariosPanel />;
}
