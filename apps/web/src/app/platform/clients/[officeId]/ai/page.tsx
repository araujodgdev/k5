import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformConnections } from "@/components/platform-connections";
import { getOfficeForPlatform, listAiConnections } from "@/lib/ai-connections-core";
import { requirePlatformPage } from "@/lib/platform";

export const metadata = { title: "Conexões de IA" };

export default async function ClientAiPage({ params }: PageProps<"/platform/clients/[officeId]/ai">) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const { officeId } = await params;
  const office = getOfficeForPlatform(context.db, officeId);
  if (!office) notFound();
  return (
    <section className="mx-auto max-w-5xl">
      <Link href="/platform/clients" className="inline-flex min-h-11 items-center rounded-md text-muted-foreground text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 md:min-h-0">← Clientes</Link>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="display text-[28px]">Conexões de IA</h1><p className="mt-1 text-muted-foreground">{office.name}</p></div>
      </div>
      <PlatformConnections officeId={office.id} initialConnections={listAiConnections(context.db, office.id)} />
    </section>
  );
}
