import { requireWorkspace } from '@/lib/session';
import { CalcPanel } from '@/components/calc/panel';
import { officePage } from '@/components/lume/canvas-leaf';

export const metadata = { title: 'Cálculos' };

async function CalcPage() {
  await requireWorkspace();
  return <CalcPanel />;
}

export default officePage('/app/calc', CalcPage);
