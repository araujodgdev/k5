import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { TypesafeSettings } from '@/components/typesafe-settings';
import { connectionView } from '@/lib/typesafe/config';

export const metadata = { title: 'TypeSafe · Administração' };

export default async function PlatformTypesafePage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  return <section>
    <TypesafeSettings initial={await connectionView()} />
  </section>;
}
