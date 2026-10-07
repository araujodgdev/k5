import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { AdminTabs } from "@/components/admin-tabs";
import { AdminLumeStrip } from "@/components/admin/admin-lume-strip";
import { CanvasHeader, CanvasPage } from "@/components/canvas/canvas-page";
import { requirePlatformPage } from "@/lib/platform";

/** Platform administration is a module of the app, open only to platform administrators. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const fresh = await context.db.prepare("SELECT count(*)::int AS total FROM feedback_ticket WHERE status = 'new'").get<{ total: number }>();
  return (
    <CanvasPage width="wide" className="gap-5 md:gap-5">
      <CanvasHeader title="Administração" eyebrow={
        <span className="flex items-center gap-1.5"><Lock aria-hidden className="size-3.5 shrink-0" />Só administradores da plataforma veem esta área</span>
      } />
      <AdminLumeStrip />
      <AdminTabs newTickets={fresh?.total ?? 0} />
      {children}
    </CanvasPage>
  );
}
