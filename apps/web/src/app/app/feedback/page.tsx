import { requireWorkspace } from '@/lib/session';
import { database } from '@/lib/database';
import { feedbackView } from '@/lib/feedback-core';
import { FeedbackWorkspace } from '@/components/feedback-workspace';

export const metadata = { title: 'Avaliar respostas' };

export default async function FeedbackPage() {
  const { user, office } = await requireWorkspace();
  return <FeedbackWorkspace initial={await feedbackView(database, { userId: user.id, officeId: office.officeId })} />;
}
