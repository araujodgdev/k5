import { PasswordRecoveryForm } from '@/components/password-recovery-form';

export const metadata = { title: 'Defina uma nova senha' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; error?: string | string[] }> }) {
  const { token, error } = await searchParams;
  if (typeof token !== 'string' || !token || token.length > 256 || error) return <PasswordRecoveryForm audience="office" mode="invalid" />;
  return <PasswordRecoveryForm audience="office" mode="reset" token={token} />;
}
