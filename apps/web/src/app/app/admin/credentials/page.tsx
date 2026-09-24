import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { CredentialRotation } from '@/components/credential-rotation';

export default async function CredentialsPage() {
  if (!await requirePlatformPage()) notFound();
  return <CredentialRotation />;
}
