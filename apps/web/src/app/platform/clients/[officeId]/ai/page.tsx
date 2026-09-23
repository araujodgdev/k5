import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformConnections } from "@/components/platform-connections";
import { getOfficeForPlatform, listAiConnections } from "@/lib/ai-connections-core";
import { requirePlatformPage } from "@/lib/platform";
import { resolveOfficeModelConfig } from '@/lib/ai-connections';
import { providerCatalog } from '@/lib/ai-providers';
import { isChatModel } from '@/lib/ai-defaults';
import { AI_PROVIDERS, type AiProvider } from '@/lib/ai-connections-core';

export const metadata = { title: "Conexões de IA" };

export default async function ClientAiPage({ params }: PageProps<"/platform/clients/[officeId]/ai">) {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const { officeId } = await params;
  const office = await getOfficeForPlatform(context.db, officeId);
  if (!office) notFound();
  const connections = await listAiConnections(context.db, office.id);
  const current = await resolveOfficeModelConfig(office.id, 'chat').catch(() => null);
  const catalog = providerCatalog();
  const modelCatalog = Object.fromEntries(AI_PROVIDERS.map(provider => [
    provider, catalog[provider].filter(isChatModel),
  ])) as Record<AiProvider, string[]>;
  return (
    <section className="mx-auto max-w-5xl">
      <Link href="/platform/clients" className="inline-flex min-h-11 items-center rounded-md text-muted-foreground text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 md:min-h-0">← Clientes</Link>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="page-title">Conexões de IA</h1><p className="mt-1 text-muted-foreground">{office.name}</p></div>
      </div>
      <PlatformConnections officeId={office.id} initialConnections={connections} modelCatalog={modelCatalog}
        initialModel={current ? { connectionId: current.connectionId, modelId: current.modelId } : null} />
      <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">O TypeSafe usa a conexão única da plataforma. <Link href="/platform/typesafe" className="underline underline-offset-4">Configurar TypeSafe</Link></p>
    </section>
  );
}
