import { NotificationInbox } from '@/components/notification-inbox';
import { requireWorkspace } from '@/lib/session';

export const metadata = { title: 'Notificações' };

export default async function NotificationsPage() {
  await requireWorkspace();
  return <NotificationInbox />;
}
