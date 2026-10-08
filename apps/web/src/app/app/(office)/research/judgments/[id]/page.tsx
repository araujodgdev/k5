import { officePage } from '@/components/lume/canvas-leaf';
import { ResearchReader } from '@/components/research-reader';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Julgado' };

async function ResearchJudgmentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const [{ id }, { search }] = await Promise.all([params, searchParams, requireWorkspace()]);
  return <ResearchReader judgmentId={id} searchId={search ?? null} />;
}

export default officePage('/app/research/judgments/[id]', ResearchJudgmentPage);
