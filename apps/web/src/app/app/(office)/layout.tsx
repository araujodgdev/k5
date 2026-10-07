import { cache } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { WebMCPProvider } from "@/components/webmcp-provider";
import { getSession, requireWorkspace } from "@/lib/session";
import { redirect } from "next/navigation";
import { database } from "@/lib/database";
import { isPlatformAdmin } from "@/lib/platform-core";
import { InvitationNotice } from '@/components/invitation-notice';
import { isWhatsAppEnabled } from '@/lib/whatsapp/rollout';
import { isAdsEnabled } from '@/lib/ads/rollout';
import { avatarUrl } from '@/lib/profile-contract';
import { OnboardingTour } from '@/components/onboarding-tour';
import { DocumentDraftsProvider } from '@/components/document/document-drafts-provider';
import { TermsGate } from '@/components/legal-gate';
import { hasAcceptedAny, hasAcceptedCurrent } from '@/lib/legal-acceptance';
import { LEGAL_UPDATED_LABEL, LEGAL_VERSION } from '@/lib/legal-version';
import { isCanvasShellEnabled } from '@/lib/canvas-shell/rollout';
import { OfficeShell } from '@/components/shell/office-shell';
import { LumePanel } from '@/components/lume-panel/lume-panel';
import { lumeSetup } from '@/components/lume-panel/setup';

const platformAdminFor = cache((userId: string) => isPlatformAdmin(database, userId));

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const userId = session.user.id;
  const [workspace, accepted, anyAccepted] = await Promise.all([
    requireWorkspace(),
    hasAcceptedCurrent(database, userId, 'terms'),
    hasAcceptedAny(database, userId, 'terms'),
  ]);
  if (!accepted)
    return <TermsGate version={LEGAL_VERSION} updatedLabel={LEGAL_UPDATED_LABEL} firstTime={!anyAccepted} />;
  const { office, user } = workspace;
  const [whatsappEnabled, adsEnabled, invitationRow, photo, platformAdmin, lume] = await Promise.all([
    isWhatsAppEnabled(office.officeId),
    isAdsEnabled({ officeId: office.officeId, userId: user.id }),
    database.prepare(`SELECT count(*) AS n FROM collaboration_invitation
      WHERE recipient_user_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP`).get(userId),
    database.prepare('SELECT avatar_version AS "avatarVersion" FROM user_profile WHERE user_id=?').get<{ avatarVersion: string | null }>(userId),
    platformAdminFor(userId),
    // The Lume panel loads its setup only for offices on the canvas shell.
    isCanvasShellEnabled(office.officeId).then((enabled) => enabled ? lumeSetup(workspace) : null),
  ]);
  const invitationCount = Number(invitationRow?.n ?? 0);
  const person = { name: user.name, avatarUrl: avatarUrl(user.id, photo?.avatarVersion ?? null) };
  const tourKey = `${user.id}:${office.officeId}`;
  const tour = { userId: user.id, officeId: office.officeId, platformAdmin, whatsappEnabled, adsEnabled, canvasShell: lume !== null };

  if (lume) {
    return (
      <OnboardingTour key={tourKey} {...tour}>
      <DocumentDraftsProvider key={tourKey}>
        <OfficeShell userId={user.id} officeId={office.officeId} officeName={office.officeName} person={person}
          platformAdmin={platformAdmin} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled}
          lume={<LumePanel userName={user.name} officeName={office.officeName} setup={lume} />}>
          <InvitationNotice count={invitationCount} />
          <WebMCPProvider whatsappEnabled={whatsappEnabled}>
            {children}
          </WebMCPProvider>
        </OfficeShell>
      </DocumentDraftsProvider>
      </OnboardingTour>
    );
  }

  return (
    <OnboardingTour key={tourKey} {...tour}>
    <DocumentDraftsProvider key={tourKey}>
    <div className="app-shell flex min-h-dvh flex-col bg-background md:flex-row">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>
      <AppSidebar officeName={office.officeName} platformAdmin={platformAdmin} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled} person={person} />
      <main id="main-content" tabIndex={-1} className="focus:outline-none flex min-h-0 min-w-0 flex-1 flex-col bg-background pb-dock md:min-h-dvh md:pb-0">
        <InvitationNotice count={invitationCount} />
        <WebMCPProvider whatsappEnabled={whatsappEnabled}>
          {children}
        </WebMCPProvider>
      </main>
    </div>
    </DocumentDraftsProvider>
    </OnboardingTour>
  );
}
