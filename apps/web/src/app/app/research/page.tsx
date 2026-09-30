import { ResearchModule } from '@/components/research-module';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Pesquisa' };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ search?: string; mode?: string }> }) {
  const workspace = await requireWorkspace();
  const { search, mode } = await searchParams;
  const selected = mode === 'web' || mode === 'jurisprudence' || mode === 'trademarks' ? mode : search ? 'web' : 'trademarks';
  return <ResearchModule mode={selected} searchId={search ?? null} role={workspace.office.role} />;
}
