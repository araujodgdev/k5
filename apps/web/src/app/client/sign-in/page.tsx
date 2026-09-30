import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { PortalAuthForm } from '@/components/client-portal/auth-form';
export default async function ClientSignIn({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const token = typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite) ? invite : undefined;
  if (await getSession()) redirect(token ? `/client/invite/${token}` : '/client');
  return <PortalAuthForm mode="sign-in" invite={token} />;
}
