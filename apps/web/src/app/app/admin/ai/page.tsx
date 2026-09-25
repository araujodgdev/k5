import { notFound } from 'next/navigation';
import { PlatformConnections } from '@/components/platform-connections';
import { AiProfileSettings, type InheritedModel } from '@/components/ai-profile-settings';
import { AiUsageSummary } from '@/components/ai-usage-summary';
import { AI_PROFILES, PROFILE_DEFINITIONS } from '@/lib/ai-profiles';
import { listProfileOverrides } from '@/lib/ai-profiles-core';
import { aiUsageSummary, USAGE_WINDOW_DAYS } from '@/lib/ai-usage';
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
  const [connections, current, typesafe, profiles, usage, ...tasks] = await Promise.all([
    listAiConnections(context.db),
    resolveModelConfig('chat').catch(() => null),
    connectionView(),
    listProfileOverrides(context.db),
    aiUsageSummary(context.db).catch(() => null),
    ...(['chat', 'extraction', 'drafting'] as const).map(task => resolveModelConfig(task).catch(() => null)),
  ]);
  // The model each step inherits from its task, named by connection so the administrator sees what "herdar" means.
  const byTask = { chat: tasks[0], extraction: tasks[1], drafting: tasks[2] };
  const inherited = Object.fromEntries(AI_PROFILES.map(profile => {
    const config = byTask[PROFILE_DEFINITIONS[profile].task];
    const connection = config && connections.find(item => item.id === config.connectionId);
    return [profile, config && connection ? { connectionName: connection.name, modelId: config.modelId, provider: config.provider } : null];
  })) as Record<string, InheritedModel>;
  const catalog = providerCatalog();
  const modelCatalog = Object.fromEntries(AI_PROVIDERS.map(provider => [provider, catalog[provider].filter(isChatModel)])) as Record<AiProvider, string[]>;
  return (
    <div className="grid gap-12">
      <section aria-labelledby="ai-lume-title">
        <h2 id="ai-lume-title" className="text-2xl">Lume</h2>
        <p className="mt-1 mb-8 max-w-3xl text-sm text-muted-foreground">Os provedores e o modelo que respondem em todos os escritórios: conversas, cronologias, minutas e a busca do Cofre.</p>
        <PlatformConnections initialConnections={connections} modelCatalog={modelCatalog}
          initialModel={current ? { connectionId: current.connectionId, modelId: current.modelId } : null} />
        <AiProfileSettings profiles={profiles} connections={connections} inherited={inherited} />
        <AiUsageSummary rows={usage ?? []} failed={usage === null} days={USAGE_WINDOW_DAYS} />
      </section>
      <section aria-labelledby="ai-typesafe-title" className="border-t border-line pt-10">
        <h2 id="ai-typesafe-title" className="text-2xl">TypeSafe</h2>
        <TypesafeSettings initial={typesafe} />
      </section>
    </div>
  );
}
