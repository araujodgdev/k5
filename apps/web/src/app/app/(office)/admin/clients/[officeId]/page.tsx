import { notFound } from 'next/navigation';
import { requirePlatformPage } from '@/lib/platform';
import { platformClientBilling } from '@/lib/billing/platform-billing';
import { BillingError } from '@/lib/billing/office-billing';
import { creditOverview } from '@/lib/billing/credits';
import { PlatformClientBilling } from '@/components/platform-client-billing';
import { AdminMeta } from '@/components/admin/admin-meta';

export const metadata = { title: 'Cliente · Administração' };

/** One client office: WhatsApp, plan, credits, charges, subscriptions and payments. */
export default async function ClientPage({ params, searchParams }: PageProps<'/app/admin/clients/[officeId]'>) {
  if (!await requirePlatformPage()) notFound();
  const { officeId } = await params;
  const raw = (await searchParams).page;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(Array.isArray(raw) ? raw[0] : raw) || 1)));
  const data = await platformClientBilling(officeId, page).catch(error => {
    if (error instanceof BillingError && error.status === 404) notFound();
    throw error;
  });
  const credits = await creditOverview(officeId, 10);
  return <>
    <AdminMeta title={data.office.name} />
    <PlatformClientBilling data={data} credits={credits} />
  </>;
}
