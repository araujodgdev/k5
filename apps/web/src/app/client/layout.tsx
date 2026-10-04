import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { LumeMark } from '@/components/lume-mark';
import { ThemeSwitch } from '@/components/theme-provider';
import { PortalSignOut } from '@/components/client-portal/auth-form';
import { TermsGate } from '@/components/legal-gate';
import { database } from '@/lib/database';
import { hasAcceptedAny, hasAcceptedCurrent } from '@/lib/legal-acceptance';
import { LEGAL_UPDATED_LABEL, LEGAL_VERSION } from '@/lib/legal-version';
export const metadata: Metadata = { title: 'Portal do cliente', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session && !await hasAcceptedCurrent(database, session.user.id, 'terms'))
    return <TermsGate version={LEGAL_VERSION} updatedLabel={LEGAL_UPDATED_LABEL} firstTime={!await hasAcceptedAny(database, session.user.id, 'terms')} signInHref="/client/sign-in" />;
  return <div className="min-h-dvh min-w-0"><header className="flex min-h-15 flex-wrap items-center justify-between gap-3 border-b px-5 py-2 md:px-10"><Link href="/client" className="inline-flex min-h-11 items-center gap-3 text-sm font-medium"><LumeMark width={22} height={22} aria-hidden="true" />Lume · Portal do cliente</Link><div className="flex items-center gap-2"><ThemeSwitch />{session && <PortalSignOut />}</div></header>{children}</div>;
}
