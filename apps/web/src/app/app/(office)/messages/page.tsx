import { officePage } from '@/components/lume/canvas-leaf';
import { Suspense } from 'react';
import { requireWorkspace } from '@/lib/session';
import { MessagesInbox } from '@/components/messaging/inbox';

export const metadata = { title: 'Mensagens' };

async function MessagesPage() {
  await requireWorkspace();
  return <Suspense fallback={<p role="status" className="px-5 py-6 text-sm text-muted-foreground md:px-10">Carregando mensagens…</p>}>
    <MessagesInbox />
  </Suspense>;
}

export default officePage('/app/messages', MessagesPage);
