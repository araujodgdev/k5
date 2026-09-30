'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage, signInSchema, signUpSchema } from '@/lib/auth-validation';

type Props = { audience: 'office' | 'client' } & ({ mode: 'recover' | 'invalid' } | { mode: 'reset'; token: string });

export function PasswordRecoveryForm(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const prefix = props.audience === 'client' ? '/client' : '';
  const signInHref = `${prefix}/sign-in`;
  const recoveryHref = `${prefix}/recover-password`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || props.mode === 'invalid') return;
    setError(''); setNotice(''); setFieldErrors({});
    const data = new FormData(event.currentTarget);
    const email = signInSchema.shape.email.safeParse(data.get('email'));
    const password = signUpSchema.shape.password.safeParse(data.get('password'));
    const errors: Record<string, string> = {};
    if (props.mode === 'recover' && !email.success) errors.email = email.error.issues[0].message;
    if (props.mode === 'reset') {
      if (!password.success) errors.password = password.error.issues[0].message;
      else if (password.data !== data.get('confirmPassword')) errors.confirmPassword = 'As senhas precisam ser iguais.';
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const field = event.currentTarget.elements.namedItem(Object.keys(errors)[0]);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    setPending(true);
    try {
      if (props.mode === 'recover' && email.success) {
        const result = await authClient.requestPasswordReset({ email: email.data, redirectTo: `${window.location.origin}${prefix}/reset-password` });
        if (result.error) throw new Error(result.error.status === 429 ? authErrorMessage('TOO_MANY_REQUESTS') : result.error.status === 503
          ? `A recuperação por e-mail está indisponível. Entre em contato com ${props.audience === 'client' ? 'o escritório' : 'o suporte'}.`
          : 'Não foi possível solicitar a recuperação. Tente novamente.');
        setNotice('Se houver uma conta para este e-mail, você receberá um link para redefinir a senha.');
      } else if (props.mode === 'reset' && password.success) {
        const result = await authClient.resetPassword({ token: props.token, newPassword: password.data });
        if (result.error) throw new Error(result.error.status === 429 ? authErrorMessage('TOO_MANY_REQUESTS') : result.error.status >= 500
          ? 'Não foi possível redefinir a senha. Tente novamente.'
          : 'O link expirou ou não é válido. Solicite uma nova recuperação.');
        router.replace(signInHref); router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível conectar. Confira sua conexão e tente novamente.');
    } finally { setPending(false); }
  }

  function fieldProps(name: string) {
    return { id: `recovery-${name}`, name, className: 'min-h-11', 'aria-invalid': !!fieldErrors[name],
      'aria-describedby': fieldErrors[name] ? `recovery-${name}-error` : undefined };
  }
  function fieldError(name: string) {
    return fieldErrors[name] && <p id={`recovery-${name}-error`} className="text-xs text-destructive">{fieldErrors[name]}</p>;
  }

  return <main className="mx-auto w-full max-w-xl min-w-0 px-5 py-10 md:px-10 md:py-16">
    <h1 className="page-title mb-6">{props.mode === 'recover' ? 'Recupere sua senha' : props.mode === 'reset' ? 'Defina uma nova senha' : 'Link indisponível'}</h1>
    {props.mode === 'invalid' ? <p className="text-sm">Solicite um novo link para redefinir sua senha.</p> : <form onSubmit={submit} noValidate aria-busy={pending} className="grid gap-5">
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        {props.mode === 'recover' ? <div className="grid gap-1.5">
          <Label htmlFor="recovery-email">E-mail</Label><Input {...fieldProps('email')} type="email" required maxLength={254} autoComplete="email" />{fieldError('email')}
        </div> : <>
          <div className="grid gap-1.5"><Label htmlFor="recovery-password">Nova senha</Label><Input {...fieldProps('password')} type="password" required minLength={8} maxLength={128} autoComplete="new-password" />{fieldError('password')}</div>
          <div className="grid gap-1.5"><Label htmlFor="recovery-confirmPassword">Confirmar nova senha</Label><Input {...fieldProps('confirmPassword')} type="password" required minLength={8} maxLength={128} autoComplete="new-password" />{fieldError('confirmPassword')}</div>
        </>}
        <Button type="submit" className="min-h-11 justify-self-start">{pending ? 'Aguarde…' : props.mode === 'recover' ? 'Solicitar recuperação' : 'Salvar nova senha'}</Button>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    <div className="mt-5 grid justify-items-start gap-2 text-sm">
      {props.mode !== 'recover' && <Link className="inline-flex min-h-11 items-center underline" href={recoveryHref}>Solicitar novo link</Link>}
      <Link className="inline-flex min-h-11 items-center underline" href={signInHref}>Voltar para entrar</Link>
    </div>
  </main>;
}
