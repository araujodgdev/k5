import { ResearchReader } from '@/components/research-reader';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Julgado' };

export default async function ResearchJudgmentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const [{ id }, { search }, { office }] = await Promise.all([params, searchParams, requireWorkspace()]);
  return <ResearchReader judgmentId={id} searchId={search ?? null} role={office.role} />;
}
