import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformTicket } from '@/lib/feedback-tickets';
import { FeedbackTicketAdmin } from '@/components/feedback-ticket-admin';
import { AdminMeta } from '@/components/admin/admin-meta';

export const metadata = { title: 'Ticket de feedback' };

async function PlatformFeedbackTicketPage({ params }: PageProps<'/app/admin/feedback/[id]'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const ticket = await platformTicket(context.user.id, (await params).id, context.db);
  if (!ticket) notFound();
  return <>
    <AdminMeta title={`Ticket #${ticket.number}`} />
    <FeedbackTicketAdmin initial={ticket} />
  </>;
}

export default officePage('/app/admin/feedback/[id]', PlatformFeedbackTicketPage, AdminCanvas);
