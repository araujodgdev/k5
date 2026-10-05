import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformClientBilling } from '@/lib/billing/platform-billing';
import { BillingError } from '@/lib/billing/office-billing';
import { PlatformClientBilling } from '@/components/platform-client-billing';
import { creditOverview } from '@/lib/billing/credits';

export const metadata = { title: 'Cliente · Administração' };

export default async function ClientPage({ params,searchParams }: { params: Promise<{ officeId: string }>; searchParams: Promise<{ page?: string }> }) {
  if (!await requirePlatformPage()) notFound();
  const { officeId } = await params;
  const { page } = await searchParams;
  const data = await platformClientBilling(officeId,Math.max(1,Math.min(10000,Math.floor(Number(page)||1)))).catch(error => {
    if (error instanceof BillingError && error.status===404) notFound();
    throw error;
  });
  return <PlatformClientBilling data={data} credits={await creditOverview(officeId, 10)} />;
}
