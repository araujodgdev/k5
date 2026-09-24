import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/admin-tabs";
import { requirePlatformPage } from "@/lib/platform";

/** Platform administration is a module of the app, open only to platform administrators. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!await requirePlatformPage()) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="page-title max-md:sr-only">Administração</h1>
      <AdminTabs />
      <div className="pt-6 md:pt-8">{children}</div>
    </div>
  );
}
