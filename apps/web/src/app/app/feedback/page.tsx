import { requireWorkspace } from '@/lib/session';
import { listAuthorTickets } from '@/lib/feedback-tickets';
import { FeedbackForm } from '@/components/feedback-form';

export const metadata = { title: 'Feedback' };

export default async function FeedbackPage() {
  const { user, office } = await requireWorkspace();
  return <FeedbackForm initial={await listAuthorTickets({ userId: user.id, officeId: office.officeId })} />;
}
