import { cache } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { WebMCPProvider } from "@/components/webmcp-provider";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { isPlatformAdmin } from "@/lib/platform-core";
import { listOfficesForUser } from '@/lib/offices';
import { OfficeSwitcher } from '@/components/office-switcher';
import { isWhatsAppEnabled } from '@/lib/whatsapp/rollout';
import { isAdsEnabled } from '@/lib/ads/rollout';
import { avatarUrl } from '@/lib/profile-contract';
import { OnboardingTour } from '@/components/onboarding-tour';

const platformAdminFor = cache((userId: string) => isPlatformAdmin(database, userId));

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { office, user } = await requireWorkspace();
  const [whatsappEnabled, adsEnabled] = await Promise.all([
    isWhatsAppEnabled(office.officeId), isAdsEnabled({ officeId: office.officeId, userId: user.id, role: office.role }),
  ]);
  const invitationCount = Number((await database.prepare(`SELECT count(*) AS n FROM collaboration_invitation i
    LEFT JOIN vault_case c ON c.id=i.case_id WHERE i.recipient_user_id=? AND i.status='pending'
    AND i.expires_at>CURRENT_TIMESTAMP AND (i.case_id IS NULL OR c.deleted_at IS NULL)`).get(user.id))?.n ?? 0);
  const photo = await database.prepare('SELECT avatar_version AS "avatarVersion" FROM user_profile WHERE user_id=?').get<{ avatarVersion: string | null }>(user.id);
  return (
    <OnboardingTour key={`${user.id}:${office.officeId}`} userId={user.id} officeId={office.officeId} platformAdmin={await platformAdminFor(user.id)} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled}>
    <div className="app-shell flex min-h-dvh flex-col bg-background md:flex-row">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-line focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>
      <AppSidebar officeName={office.officeName} platformAdmin={await platformAdminFor(user.id)} whatsappEnabled={whatsappEnabled} adsEnabled={adsEnabled}
        person={{ name: user.name, avatarUrl: avatarUrl(user.id, photo?.avatarVersion ?? null) }} />
      <main id="main-content" tabIndex={-1} className="focus:outline-none flex min-h-0 min-w-0 flex-1 flex-col bg-background pb-dock md:min-h-dvh md:pb-0">
        <OfficeSwitcher offices={await listOfficesForUser(database, user.id)} activeOfficeId={office.officeId} invitationCount={invitationCount} />
        <WebMCPProvider role={(office).role} whatsappEnabled={whatsappEnabled}>
          {children}
        </WebMCPProvider>
      </main>
    </div>
    </OnboardingTour>
  );
}
