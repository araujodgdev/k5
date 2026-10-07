import { cache } from "react";
import { LumeWorkspace } from '@/components/lume/lume-workspace';
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
import { planTaskModel } from '@/lib/ai-connections';
import { planReadsImages } from '@/lib/ai-assignments-core';

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
  const [whatsappEnabled, adsEnabled, invitationRow, photo, platformAdmin, aiNoticeAccepted, chatPlan, transcriptionPlan] = await Promise.all([
    isWhatsAppEnabled(office.officeId),
    isAdsEnabled({ officeId: office.officeId, userId: user.id }),
    database.prepare(`SELECT count(*) AS n FROM collaboration_invitation
      WHERE recipient_user_id=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP`).get(userId),
    database.prepare('SELECT avatar_version AS "avatarVersion" FROM user_profile WHERE user_id=?').get<{ avatarVersion: string | null }>(userId),
    platformAdminFor(userId),
    hasAcceptedCurrent(database, user.id, 'ai_notice'),
    planTaskModel('agent.chat').catch(() => null),
    planTaskModel('transcription.voice_note').catch(() => null),
  ]);
  const invitationCount = Number(invitationRow?.n ?? 0);
  return (
    <OnboardingTour key={`${user.id}:${office.officeId}`} userId={user.id} officeId={office.officeId} platformAdmin={platformAdmin} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled}>
    <DocumentDraftsProvider key={`${user.id}:${office.officeId}`}>
    <LumeWorkspace key={`${user.id}:${office.officeId}`} identity={{ userId: user.id, officeId: office.officeId }}
      aiNoticeAccepted={aiNoticeAccepted} modalities={{ image: chatPlan ? planReadsImages(chatPlan) : false, audio: transcriptionPlan?.status === 'ready' }}
      officeName={office.officeName} platformAdmin={platformAdmin} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled}
      person={{ name: user.name, avatarUrl: avatarUrl(user.id, photo?.avatarVersion ?? null) }}>
        <InvitationNotice count={invitationCount} />
        <WebMCPProvider whatsappEnabled={whatsappEnabled}>
          {children}
        </WebMCPProvider>
    </LumeWorkspace>
    </DocumentDraftsProvider>
    </OnboardingTour>
  );
}
