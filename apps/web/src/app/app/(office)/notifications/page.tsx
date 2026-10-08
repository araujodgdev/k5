import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';

// Notifications are a panel beside the menu; old links and the open fallback land here.
async function NotificationsPage() {
  await requireWorkspace();
  return redirect('/app/command-center?notificacoes=1');
}

export default officePage('/app/notifications', NotificationsPage);
