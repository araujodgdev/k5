import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AddressClaim } from '@/components/messaging/address-claim';
import { parseMessageClaimToken } from '@/components/messaging/claim-token';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Confirmar endereço', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function MessageClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const token = parseMessageClaimToken((await params).token);
  if (!token) notFound();
  const session = await getSession();
  if (session) return <AddressClaim token={token} email={session.user.email} />;
  const query = new URLSearchParams({ messageClaim: token }).toString();
  return <main className="mx-auto w-full max-w-xl px-5 py-12 md:py-20"><h1 className="page-title">Você recebeu uma mensagem</h1><p className="my-6 text-sm leading-relaxed">Entre ou crie sua conta com o e-mail que recebeu o convite. Depois, confirme seu endereço para continuar.</p><div className="flex flex-wrap gap-3"><Button className="min-h-11 md:min-h-9" asChild><Link href={`/sign-in?${query}`}>Entrar</Link></Button><Button variant="outline" className="min-h-11 md:min-h-9" asChild><Link href={`/sign-up?${query}`}>Criar conta</Link></Button></div></main>;
}
