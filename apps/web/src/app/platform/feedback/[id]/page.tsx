import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformTicket } from '@/lib/feedback-tickets';
import { FeedbackTicketAdmin } from '@/components/feedback-ticket-admin';

export const metadata = { title: 'Ticket de feedback' };

export default async function PlatformFeedbackTicketPage({ params }: PageProps<'/platform/feedback/[id]'>) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const ticket = await platformTicket(context.user.id, (await params).id, context.db);
  if (!ticket) notFound();
  return <section className="mx-auto max-w-5xl">
    <Link href="/platform/feedback" className="inline-flex min-h-11 items-center rounded-md text-muted-foreground text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 md:min-h-0">← Feedback</Link>
    <FeedbackTicketAdmin initial={ticket} />
  </section>;
}
