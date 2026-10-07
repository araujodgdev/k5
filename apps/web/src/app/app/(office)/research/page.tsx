import { ResearchHistory } from '@/components/research-history';
import { ResearchModule } from '@/components/research-module';
import { workspaceContext } from '@/lib/application/context';
import { listResearchHistory } from '@/lib/application/research-service';
import { listTrademarkSearches } from '@/lib/research/trademarks/service';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Pesquisa' };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ search?: string; mode?: string }> }) {
  const workspace = await requireWorkspace();
  const { search, mode } = await searchParams;
  if (mode === 'jurisprudence' || mode === 'trademarks') return <ResearchModule mode={mode} searchId={search ?? null} />;
  const context = workspaceContext(workspace);
  const [judgments, trademarks] = await Promise.all([listResearchHistory(context), listTrademarkSearches(context)]);
  return <ResearchHistory judgments={judgments} trademarks={trademarks.searches} />;
}
