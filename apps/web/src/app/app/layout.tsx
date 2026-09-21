import { cache } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { WebMCPProvider } from "@/components/webmcp-provider";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { isPlatformAdmin } from "@/lib/platform-core";

const platformAdminFor = cache((userId: string) => isPlatformAdmin(database, userId));

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { office, user } = await requireWorkspace();
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row md:bg-canvas">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2">Ir para o conteúdo</a>
      <AppSidebar officeName={office.officeName} platformAdmin={await platformAdminFor(user.id)} />
      <main id="main-content" className="flex min-w-0 flex-1 flex-col bg-background pb-dock md:my-2 md:mr-2 md:h-[calc(100dvh-1rem)] md:rounded-2xl md:border md:pb-0">
        <WebMCPProvider role={(office).role}>
          {children}
        </WebMCPProvider>
      </main>
    </div>
  );
}
