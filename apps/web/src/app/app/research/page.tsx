import { ResearchWorkspace } from '@/components/research-workspace';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Pesquisa' };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { office } = await requireWorkspace();
  const { search } = await searchParams;
  return <ResearchWorkspace role={office.role} initialSearchId={search ?? null} />;
}
