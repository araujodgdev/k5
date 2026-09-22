import { ResearchDraftStatus } from '@/components/research-draft-status';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Minuta' };

export default async function ResearchDraftPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ case?: string }>;
}) {
  const [{ id }, { case: caseId }] = await Promise.all([params, searchParams, requireWorkspace()]);
  return <ResearchDraftStatus runId={id} caseId={caseId ?? null} />;
}
