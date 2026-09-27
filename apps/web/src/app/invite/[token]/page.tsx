import Link from 'next/link';
import { getSession } from '@/lib/session';
import { InvitationAcceptance } from '@/components/collaboration-panel';

export const metadata = { title: 'Convite', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!await getSession()) return <main className="mx-auto max-w-xl px-5 py-12"><h1 className="page-title">Você recebeu um convite</h1><p className="my-6">Entre ou crie sua conta com o e-mail que recebeu o convite para continuar.</p><div className="flex gap-5"><Link className="underline" href={`/sign-in?invite=${encodeURIComponent(token)}`}>Entrar</Link><Link className="underline" href={`/sign-up?invite=${encodeURIComponent(token)}`}>Criar conta</Link></div></main>;
  return <InvitationAcceptance token={token} />;
}
