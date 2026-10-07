import { requireWorkspace } from '@/lib/session';
import { CommandCenter } from '@/components/command-center';

import { lumeWork } from './data';

export const metadata = { title: "Início" };

export default async function HomePage() {
  const workspace = await requireWorkspace();
  const work = await lumeWork(workspace.office.officeId, workspace.user.id);
  return <CommandCenter lumeWork={work} />;
}
