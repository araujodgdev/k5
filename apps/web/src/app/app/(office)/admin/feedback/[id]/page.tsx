import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformTicket } from '@/lib/feedback-tickets';
import { FeedbackTicketAdmin } from '@/components/feedback-ticket-admin';

export const metadata = { title: 'Ticket de feedback' };

export default async function PlatformFeedbackTicketPage({ params }: PageProps<'/app/admin/feedback/[id]'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const ticket = await platformTicket(context.user.id, (await params).id, context.db);
  if (!ticket) notFound();
  return <>
    <FeedbackTicketAdmin initial={ticket} />
  </>;
}
