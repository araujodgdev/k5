import { getSession } from '@/lib/session';
import { database } from '@/lib/database';
import { portalInvitation } from '@/lib/client-portal/invitations';
import { CapabilityError } from '@/lib/capabilities/errors';
import { PortalAuthForm } from '@/components/client-portal/auth-form';
export default async function ClientInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await portalInvitation(database, token).catch(error => { if (!(error instanceof CapabilityError)) throw error; return null; });
  if (!invitation) return <main className="mx-auto max-w-xl px-5 py-10"><h1 className="page-title">Convite indisponível</h1><p className="mt-5 text-sm">Este convite foi usado, revogado ou expirou. Peça um novo link ao escritório.</p></main>;
  const session = await getSession();
  return <PortalAuthForm mode="invite" token={token} email={invitation.email} officeName={invitation.officeName} clientName={invitation.clientName} signedInEmail={session?.user.email} />;
}
