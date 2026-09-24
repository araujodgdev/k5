import { requireWorkspace } from '@/lib/session';
import { CommandCenter } from '@/components/command-center';

export const metadata = { title: "Início" };

export default async function HomePage() {
  const { office } = await requireWorkspace();
  return <CommandCenter role={office.role} />;
}
