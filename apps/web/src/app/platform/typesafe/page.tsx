import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { TypesafeSettings } from '@/components/typesafe-settings';
import { connectionView } from '@/lib/typesafe/config';

export const metadata = { title: 'TypeSafe' };

export default async function PlatformTypesafePage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  return <section className="mx-auto max-w-5xl">
    <h1 className="page-title">TypeSafe</h1>
    <TypesafeSettings initial={await connectionView()} />
  </section>;
}
