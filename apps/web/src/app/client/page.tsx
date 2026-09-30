import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { portalChoices } from '@/lib/client-portal/service';
import { ClientPortal } from '@/components/client-portal/portal';
export default async function ClientPage() {
  const session = await getSession(); if (!session?.session.id) redirect('/client/sign-in');
  const choices = await portalChoices({ userId: session.user.id, sessionId: session.session.id });
  return <ClientPortal accesses={choices.accesses} />;
}
