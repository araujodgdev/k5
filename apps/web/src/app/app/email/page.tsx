import { requireWorkspace } from '@/lib/session';
import { GmailPanel } from '@/components/google/gmail-panel';

export const metadata = { title: 'E-mails' };

export default async function EmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { office } = await requireWorkspace();
  const params = await searchParams;
  return <GmailPanel role={office.role} initialThreadId={typeof params.thread === 'string' ? params.thread : undefined}
    initialDraftId={typeof params.draft === 'string' ? params.draft : undefined} />;
}
