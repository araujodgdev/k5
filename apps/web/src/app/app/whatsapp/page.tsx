import { notFound } from 'next/navigation';
import { WhatsAppInbox } from '@/components/whatsapp/inbox';
import { requireWorkspace } from '@/lib/session';
import { isWhatsAppEnabled } from '@/lib/whatsapp/rollout';

export const metadata = { title: 'WhatsApp' };

export default async function WhatsAppPage() {
  const { office } = await requireWorkspace();
  if (!await isWhatsAppEnabled(office.officeId)) notFound();
  return <WhatsAppInbox canSendRole={office.role === 'administrator' || office.role === 'lawyer'} />;
}
