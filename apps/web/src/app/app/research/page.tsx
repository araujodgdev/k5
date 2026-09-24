import { ResearchWorkspace } from '@/components/research-workspace';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Pesquisa' };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireWorkspace();
  const { search } = await searchParams;
  return <ResearchWorkspace initialSearchId={search ?? null} />;
}
