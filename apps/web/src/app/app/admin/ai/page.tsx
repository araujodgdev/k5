import { notFound } from 'next/navigation';
import { PlatformConnections } from '@/components/platform-connections';
import { TypesafeSettings } from '@/components/typesafe-settings';
import { AI_PROVIDERS, listAiConnections, type AiProvider } from '@/lib/ai-connections-core';
import { resolveModelConfig } from '@/lib/ai-connections';
import { isChatModel } from '@/lib/ai-defaults';
import { providerCatalog } from '@/lib/ai-providers';
import { requirePlatformPage } from '@/lib/platform';
import { connectionView } from '@/lib/typesafe/config';

export const metadata = { title: 'IA · Administração' };

/** The platform's AI, configured once for every office: the Lume's model and TypeSafe. */
export default async function PlatformAiPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const [connections, current, typesafe] = await Promise.all([
    listAiConnections(context.db),
    resolveModelConfig('chat').catch(() => null),
    connectionView(),
  ]);
  const catalog = providerCatalog();
  const modelCatalog = Object.fromEntries(AI_PROVIDERS.map(provider => [provider, catalog[provider].filter(isChatModel)])) as Record<AiProvider, string[]>;
  return (
    <div className="grid gap-12">
      <section aria-labelledby="ai-lume-title">
        <h2 id="ai-lume-title" className="text-2xl">Lume</h2>
        <p className="mt-1 mb-8 max-w-3xl text-sm text-muted-foreground">Os provedores e o modelo que respondem em todos os escritórios: conversas, cronologias, minutas e a busca do Cofre.</p>
        <PlatformConnections initialConnections={connections} modelCatalog={modelCatalog}
          initialModel={current ? { connectionId: current.connectionId, modelId: current.modelId } : null} />
      </section>
      <section aria-labelledby="ai-typesafe-title" className="border-t border-line pt-10">
        <h2 id="ai-typesafe-title" className="text-2xl">TypeSafe</h2>
        <TypesafeSettings initial={typesafe} />
      </section>
    </div>
  );
}
