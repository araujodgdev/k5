import { ResearchModule } from '@/components/research-module';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Pesquisa' };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ search?: string; mode?: string }> }) {
  await requireWorkspace();
  const { search, mode } = await searchParams;
  const selected = mode === 'jurisprudence' ? 'jurisprudence' : 'trademarks';
  const searchId = mode === 'trademarks' || mode === 'jurisprudence' ? search ?? null : null;
  return <ResearchModule mode={selected} searchId={searchId} />;
}
