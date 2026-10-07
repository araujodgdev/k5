import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { CredentialRotation } from '@/components/credential-rotation';
import { AdminGrid } from '@/components/admin/admin-blocks';

export const metadata = { title: 'Credenciais · Administração' };

export default async function CredentialsPage() {
  if (!await requirePlatformPage()) notFound();
  return <>
    <AdminGrid><CredentialRotation /></AdminGrid>
  </>;
}
