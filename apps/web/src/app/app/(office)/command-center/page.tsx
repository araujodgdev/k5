import { requireWorkspace } from '@/lib/session';
import { CommandCenter } from '@/components/command-center';

export const metadata = { title: "Início" };

export default async function HomePage() {
  await requireWorkspace();
  return <CommandCenter />;
}
