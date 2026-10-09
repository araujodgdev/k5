import { requireWorkspace } from '@/lib/session';
import { CommandCenter } from '@/components/command-center';

import { lumeWork } from './data';
import { officePage } from '@/components/lume/canvas-leaf';

export const metadata = { title: "Início" };

async function HomePage() {
  const workspace = await requireWorkspace();
  const work = await lumeWork(workspace.office.officeId, workspace.user.id);
  return <CommandCenter lumeWork={work} />;
}

export default officePage('/app/command-center', HomePage);
