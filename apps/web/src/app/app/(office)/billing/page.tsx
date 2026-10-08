import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { billingOverview, billingSettings, syncPendingCheckouts } from '@/lib/billing/office-billing';
import { BillingPanel } from '@/components/billing-panel';
import { subscriptionsForOffice, syncOfficeSubscriptions } from '@/lib/billing/subscriptions';
import { creditOverview, isCreditExempt } from '@/lib/billing/credits';

export const metadata = { title: 'Plano' };

type Props = { searchParams: Promise<{ pagamento?: string }> };

async function BillingPage({ searchParams }: Props) {
  const { office, user } = await requireWorkspace();
  // Coming back from the checkout, the payment may be settled before the webhook arrives (and
  // locally no webhook arrives at all), so the pending checkouts are read from AbacatePay first.
  if (billingSettings().configured) await syncPendingCheckouts(office.officeId).catch(() => undefined);
  if (billingSettings().configured) await syncOfficeSubscriptions(office.officeId).catch(() => undefined);
  const overview = await billingOverview(office.officeId);
  const { pagamento } = await searchParams;
  const [subscriptions, credits, exempt] = await Promise.all([subscriptionsForOffice(office.officeId), creditOverview(office.officeId), isCreditExempt(user.id)]);
  return <BillingPanel overview={overview} credits={credits} exempt={exempt} hasSubscription={subscriptions.some(item => item.status === 'ACTIVE')} returned={pagamento === 'concluido'} />;
}

export default officePage('/app/billing', BillingPage);
