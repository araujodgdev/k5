'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-validation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Failure, Field } from '@/components/honorarios/fields';
import { portalCall } from './client';

type Props = { mode: 'sign-in'; invite?: string } | { mode: 'invite'; token: string; email: string; officeName: string; clientName: string; signedInEmail?: string } | { mode: 'recover' } | { mode: 'reset'; token: string };
export function PortalAuthForm(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const headings = { 'sign-in': 'Entre no portal', invite: 'Acesso ao seu escritório', recover: 'Recupere sua senha', reset: 'Defina uma nova senha' };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget);
    if ((props.mode === 'reset' || (props.mode === 'invite' && !props.signedInEmail)) && password !== confirm) { setError('As senhas precisam ser iguais.'); return; }
    setPending(true); setError(''); setNotice('');
    try {
      if (props.mode === 'sign-in') {
        const result = await authClient.signIn.email({ email: String(data.get('email')).trim().toLowerCase(), password });
        if (result.error) throw new Error(authErrorMessage(result.error.code));
        router.replace(props.invite ? `/client/invite/${encodeURIComponent(props.invite)}` : '/client'); router.refresh();
      } else if (props.mode === 'invite') {
        await portalCall(`/api/client-portal/invitations/${encodeURIComponent(props.token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), password }) });
        router.replace('/client'); router.refresh();
      } else if (props.mode === 'recover') {
        const result = await authClient.requestPasswordReset({ email: String(data.get('email')).trim().toLowerCase(), redirectTo: `${window.location.origin}/client/reset-password` });
        if (result.error) throw new Error(result.error.status === 503 ? 'A recuperação por e-mail está indisponível. Entre em contato com o escritório.' : 'Não foi possível solicitar a recuperação. Tente novamente.');
        setNotice('Se houver uma conta para este e-mail, você receberá um link para redefinir a senha.');
      } else {
        const result = await authClient.resetPassword({ token: props.token, newPassword: password });
        if (result.error) throw new Error('O link expirou ou não é válido. Solicite uma nova recuperação.');
        router.replace('/client/sign-in'); router.refresh();
      }
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }
  const mismatch = props.mode === 'invite' && props.signedInEmail && props.email.toLowerCase() !== props.signedInEmail.toLowerCase();
  return <main className="mx-auto w-full max-w-xl min-w-0 px-5 py-10 md:px-10 md:py-16">
    <h1 className="page-title mb-6">{headings[props.mode]}</h1>
    {props.mode === 'invite' && <p className="mb-6 break-words text-sm">{props.officeName} convidou {props.clientName} para acessar documentos e pagamentos com o e-mail {props.email}.</p>}
    {mismatch ? <p role="alert" className="text-sm">Esta sessão pertence a {props.signedInEmail}. Saia e entre com o e-mail do convite.</p> : <form onSubmit={submit} className="grid gap-5">
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        {props.mode === 'invite' && !props.signedInEmail && <Field label="Nome completo">{id => <Input id={id} className="min-h-11" name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={props.clientName} />}</Field>}
        {(props.mode === 'sign-in' || props.mode === 'recover') && <Field label="E-mail">{id => <Input id={id} className="min-h-11" name="email" type="email" required maxLength={254} autoComplete="email" />}</Field>}
        {(props.mode === 'sign-in' || props.mode === 'reset' || (props.mode === 'invite' && !props.signedInEmail)) && <Field label={props.mode === 'sign-in' ? 'Senha' : 'Nova senha'}>{id => <Input id={id} className="min-h-11" name="password" type="password" required minLength={props.mode === 'sign-in' ? 1 : 8} maxLength={128} autoComplete={props.mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} />}</Field>}
        {(props.mode === 'reset' || (props.mode === 'invite' && !props.signedInEmail)) && <Field label="Confirmar nova senha">{id => <Input id={id} className="min-h-11" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />}</Field>}
        <Button type="submit" className="min-h-11 justify-self-start">{pending ? 'Aguarde…' : props.mode === 'sign-in' ? 'Entrar no portal' : props.mode === 'invite' ? props.signedInEmail ? 'Aceitar convite' : 'Criar acesso ao portal' : props.mode === 'recover' ? 'Solicitar recuperação' : 'Salvar nova senha'}</Button>
      </fieldset>
    </form>}
    <Failure message={error} />{notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    <div className="mt-5 grid justify-items-start gap-2 text-sm">
      {props.mode === 'sign-in' && <Link className="inline-flex min-h-11 items-center underline" href="/client/recover-password">Esqueci minha senha</Link>}
      {props.mode === 'invite' && !props.signedInEmail && <Link className="inline-flex min-h-11 items-center underline" href={`/client/sign-in?invite=${encodeURIComponent(props.token)}`}>Já tenho uma conta</Link>}
      {(props.mode === 'recover' || props.mode === 'reset') && <Link className="inline-flex min-h-11 items-center underline" href="/client/sign-in">Voltar para entrar</Link>}
    </div>
  </main>;
}

export function PortalSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <div className="flex items-center gap-3"><Button className="min-h-11" variant="ghost" disabled={pending} onClick={() => {
    setPending(true); setError('');
    void authClient.signOut().then(result => { if (result.error) { setError('Não foi possível sair. Tente novamente.'); return; } router.replace('/client/sign-in'); router.refresh(); })
      .catch(() => setError('Não foi possível sair. Tente novamente.')).finally(() => setPending(false));
  }}>{pending ? 'Saindo…' : 'Sair'}</Button><Failure message={error} /></div>;
}
