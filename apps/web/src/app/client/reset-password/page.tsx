import { PasswordRecoveryForm } from '@/components/password-recovery-form';
export default async function ClientReset({ searchParams }: { searchParams: Promise<{ token?: string | string[]; error?: string | string[] }> }) {
  const { token, error } = await searchParams;
  if (typeof token !== 'string' || !token || token.length > 256 || error) return <PasswordRecoveryForm audience="client" mode="invalid" />;
  return <PasswordRecoveryForm audience="client" mode="reset" token={token} />;
}
