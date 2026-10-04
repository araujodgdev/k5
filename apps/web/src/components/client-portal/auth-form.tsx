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
import { LEGAL_VERSION } from '@/lib/legal-version';

type Props = { mode: 'sign-in'; invite?: string } | { mode: 'invite'; token: string; email: string; officeName: string; clientName: string; signedInEmail?: string };
export function PortalAuthForm(props: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const headings = { 'sign-in': 'Entre no portal', invite: 'Acesso ao seu escritório' };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget);
    if (props.mode === 'invite' && !props.signedInEmail && password !== confirm) { setError('As senhas precisam ser iguais.'); return; }
    if (props.mode === 'invite' && !props.signedInEmail && data.get('acceptTerms') !== 'on') { setError('Para criar o acesso, aceite os Termos de uso e a Política de privacidade.'); return; }
    setPending(true); setError('');
    try {
      if (props.mode === 'sign-in') {
        const result = await authClient.signIn.email({ email: String(data.get('email')).trim().toLowerCase(), password, callbackURL: '/client' });
        if (result.error) throw new Error(authErrorMessage(result.error.code));
        router.replace(props.invite ? `/client/invite/${encodeURIComponent(props.invite)}` : '/client'); router.refresh();
      } else if (props.mode === 'invite') {
        const result = await portalCall(`/api/client-portal/invitations/${encodeURIComponent(props.token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), password, acceptedLegalVersion: LEGAL_VERSION }) });
        // A new account waits for the e-mail confirmation where it is required: no session yet.
        if (!props.signedInEmail && result && typeof result === 'object' && 'token' in result && !result.token) { setSentTo(props.email); return; }
        router.replace('/client'); router.refresh();
      }
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Não foi possível conectar. Tente novamente.'); }
    finally { setPending(false); }
  }
  const mismatch = props.mode === 'invite' && props.signedInEmail && props.email.toLowerCase() !== props.signedInEmail.toLowerCase();
  if (sentTo) return <main className="mx-auto w-full max-w-xl min-w-0 px-5 py-10 md:px-10 md:py-16">
    <h1 className="page-title mb-6">Confira seu e-mail</h1>
    <div role="status" className="grid gap-3 text-sm leading-relaxed">
      <p className="break-words">Enviamos um link de confirmação para {sentTo}. Abra o link em até 24 horas para entrar no portal.</p>
      <p className="text-muted-foreground">Se a mensagem não chegar em alguns minutos, confira a caixa de spam. Ao tentar entrar com o e-mail ainda não confirmado, enviamos um novo link.</p>
    </div>
  </main>;
  return <main className="mx-auto w-full max-w-xl min-w-0 px-5 py-10 md:px-10 md:py-16">
    <h1 className="page-title mb-6">{headings[props.mode]}</h1>
    {props.mode === 'invite' && <p className="mb-6 break-words text-sm">{props.officeName} convidou {props.clientName} para acessar documentos e pagamentos com o e-mail {props.email}.</p>}
    {mismatch ? <p role="alert" className="text-sm">Esta sessão pertence a {props.signedInEmail}. Saia e entre com o e-mail do convite.</p> : <form onSubmit={submit} className="grid gap-5">
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        {props.mode === 'invite' && !props.signedInEmail && <Field label="Nome completo">{id => <Input id={id} className="min-h-11" name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={props.clientName} />}</Field>}
        {props.mode === 'sign-in' && <Field label="E-mail">{id => <Input id={id} className="min-h-11" name="email" type="email" required maxLength={254} autoComplete="email" />}</Field>}
        {(props.mode === 'sign-in' || !props.signedInEmail) && <Field label={props.mode === 'sign-in' ? 'Senha' : 'Nova senha'}>{id => <Input id={id} className="min-h-11" name="password" type="password" required minLength={props.mode === 'sign-in' ? 1 : 8} maxLength={128} autoComplete={props.mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} />}</Field>}
        {props.mode === 'invite' && !props.signedInEmail && <Field label="Confirmar nova senha">{id => <Input id={id} className="min-h-11" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />}</Field>}
        {props.mode === 'invite' && !props.signedInEmail && <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input name="acceptTerms" type="checkbox" className="mt-1 size-4 shrink-0 accent-foreground" />
          <span>Li e aceito os <Link href="/termos-de-uso" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Termos de uso<span className="sr-only"> (abre em nova aba)</span></Link> e a <Link href="/politica-privacidade" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Política de privacidade<span className="sr-only"> (abre em nova aba)</span></Link>.</span>
        </label>}
        <Button type="submit" className="min-h-11 justify-self-start">{pending ? 'Aguarde…' : props.mode === 'sign-in' ? 'Entrar no portal' : props.signedInEmail ? 'Aceitar convite' : 'Criar acesso ao portal'}</Button>
      </fieldset>
    </form>}
    <Failure message={error} />
    <div className="mt-5 grid justify-items-start gap-2 text-sm">
      {props.mode === 'sign-in' && <Link className="inline-flex min-h-11 items-center underline" href="/client/recover-password">Esqueci minha senha</Link>}
      {props.mode === 'invite' && !props.signedInEmail && <Link className="inline-flex min-h-11 items-center underline" href={`/client/sign-in?invite=${encodeURIComponent(props.token)}`}>Já tenho uma conta</Link>}
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
