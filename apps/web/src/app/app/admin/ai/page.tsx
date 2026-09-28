import { notFound } from 'next/navigation';
import { AiTaskModels } from '@/components/ai-task-models';
import { PlatformConnections } from '@/components/platform-connections';
import { TypesafeSettings } from '@/components/typesafe-settings';
import { assignmentOverview } from '@/lib/ai-assignments-core';
import { AI_PROVIDERS, listAiConnections, type AiProvider } from '@/lib/ai-connections-core';
import { isChatModel } from '@/lib/ai-defaults';
import { chatHearsAudio } from '@/lib/ai-modalities';
import { providerCatalog } from '@/lib/ai-providers';
import { AI_TASK_DEFINITIONS, AI_TASK_GROUP_DEFINITIONS, isAiTaskKey, isTranscriptionModel } from '@/lib/ai-tasks';
import { requirePlatformPage } from '@/lib/platform';
import { connectionView } from '@/lib/typesafe/config';

export const metadata = { title: 'IA · Administração' };

/** OpenAI's transcription endpoint models; the registry lists chat models only. */
const TRANSCRIPTION_MODELS = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'];

/** The platform's AI, configured once for every office: Lume's models per task, its connections and TypeSafe. */
export default async function PlatformAiPage() {
  const context = await requirePlatformPage();
  if (!context) notFound();
  const [connections, overview, typesafe] = await Promise.all([listAiConnections(context.db), assignmentOverview(context.db), connectionView()]);
  const catalog = providerCatalog();
  const chat = Object.fromEntries(AI_PROVIDERS.map(provider => [provider, catalog[provider].filter(isChatModel)])) as Record<AiProvider, string[]>;
  const transcription = Object.fromEntries(AI_PROVIDERS.map(provider => [provider, [
    ...(provider === 'openai' ? TRANSCRIPTION_MODELS : []),
    ...catalog[provider].filter(model => isTranscriptionModel(provider, model) ? !TRANSCRIPTION_MODELS.includes(model) : chatHearsAudio(provider, model)),
  ]])) as Record<AiProvider, string[]>;
  // What each connection serves, so disabling or deleting one shows what stops.
  const usage: Record<string, string[]> = {};
  for (const [scope, entries] of [['group', overview.groups], ['task', overview.tasks]] as const) {
    for (const entry of entries) {
      const connectionId = entry.assignment?.model.mode === 'explicit' ? entry.assignment.model.connectionId : null;
      if (!connectionId) continue;
      const label = scope === 'task' && isAiTaskKey(entry.key) ? AI_TASK_DEFINITIONS[entry.key].label : AI_TASK_GROUP_DEFINITIONS[entry.key as keyof typeof AI_TASK_GROUP_DEFINITIONS]?.label ?? entry.key;
      (usage[connectionId] ??= []).push(label);
    }
  }
  return (
    <div className="grid gap-12">
      <section aria-labelledby="ai-agent-title">
        <h2 id="ai-agent-title" className="text-2xl">Lume</h2>
        <p className="mt-1 mb-8 max-w-3xl text-sm text-muted-foreground">Os modelos e os provedores que respondem em todos os escritórios: conversas, e-mails, cronologias, minutas, anexos e a busca do Cofre.</p>
        <AiTaskModels initial={overview} catalogs={{ chat, transcription }} />
        <PlatformConnections initialConnections={connections} usage={usage} />
      </section>
      <section aria-labelledby="ai-typesafe-title" className="border-t border-line pt-10">
        <h2 id="ai-typesafe-title" className="text-2xl">TypeSafe</h2>
        <TypesafeSettings initial={typesafe} />
      </section>
    </div>
  );
}
