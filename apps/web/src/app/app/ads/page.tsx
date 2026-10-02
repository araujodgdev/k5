import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';
import { isAdsEnabled } from '@/lib/ads/rollout';
import { AdsConnection } from '@/components/ads/connection';

export const metadata = { title: 'Anúncios' };
export default async function AdsPage() {
  const { office, user } = await requireWorkspace();
  if (!await isAdsEnabled({ officeId: office.officeId, userId: user.id })) notFound();
  return <AdsConnection key={office.officeId} />;
}
