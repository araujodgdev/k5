import { PasswordRecoveryForm } from '@/components/password-recovery-form';

export const metadata = { title: 'Recupere sua senha' };

export default function RecoverPasswordPage() {
  return <PasswordRecoveryForm audience="office" mode="recover" />;
}
