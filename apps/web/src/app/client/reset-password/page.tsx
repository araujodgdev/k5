import { PortalAuthForm } from '@/components/client-portal/auth-form';
export default async function ClientReset({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || token.length > 256 || error) return <main className="mx-auto max-w-xl px-5 py-10"><h1 className="page-title">Link indisponível</h1><p className="mt-5 text-sm">Solicite uma nova recuperação de senha.</p></main>;
  return <PortalAuthForm mode="reset" token={token} />;
}
