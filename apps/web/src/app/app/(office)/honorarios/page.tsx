import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { HonorariosPanel } from '@/components/honorarios/panel';

export const metadata = { title: 'Honorários' };

async function HonorariosPage() {
  await requireWorkspace();
  return <HonorariosPanel />;
}

export default officePage('/app/honorarios', HonorariosPage);
