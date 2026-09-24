import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';

// Notifications are a panel beside the menu; old links and the open fallback land here.
export default async function NotificationsPage() {
  await requireWorkspace();
  redirect('/app/command-center?notificacoes=1');
}
