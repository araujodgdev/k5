import { officePage } from '@/components/lume/canvas-leaf';
import { notFound } from 'next/navigation';
import { WhatsAppInbox } from '@/components/whatsapp/inbox';
import { requireWorkspace } from '@/lib/session';
import { isWhatsAppEnabled } from '@/lib/whatsapp/rollout';

export const metadata = { title: 'WhatsApp' };

async function WhatsAppPage() {
  const { office } = await requireWorkspace();
  if (!await isWhatsAppEnabled(office.officeId)) notFound();
  return <WhatsAppInbox />;
}

export default officePage('/app/whatsapp', WhatsAppPage);
