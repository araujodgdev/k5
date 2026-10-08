import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { GmailPanel } from '@/components/google/gmail-panel';

export const metadata = { title: 'E-mails' };

async function EmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const params = await searchParams;
  return <GmailPanel initialThreadId={typeof params.thread === 'string' ? params.thread : undefined}
    initialDraftId={typeof params.draft === 'string' ? params.draft : undefined} />;
}

export default officePage('/app/email', EmailPage);
