import { requireWorkspace } from '@/lib/session';
import { CalcPanel } from '@/components/calc/panel';

export const metadata = { title: 'Cálculos' };

export default async function CalcPage() {
  await requireWorkspace();
  return <CalcPanel />;
}
