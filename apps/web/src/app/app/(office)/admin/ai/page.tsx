import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import { notFound } from 'next/navigation';
import { AiTaskModels } from '@/components/ai-task-models';
import { PlatformConnections } from '@/components/platform-connections';
import { TypesafeSettings } from '@/components/typesafe-settings';
import { AdminGrid } from '@/components/admin/admin-blocks';
import { AdminMeta } from '@/components/admin/admin-meta';
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
async function PlatformAiPage() {
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
  return <>
    <AdminMeta title="IA" />
    <AdminGrid>
      <AiTaskModels initial={overview} catalogs={{ chat, transcription }} />
      <PlatformConnections initialConnections={connections} usage={usage} />
      <TypesafeSettings initial={typesafe} />
    </AdminGrid>
  </>;
}

export default officePage('/app/admin/ai', PlatformAiPage, AdminCanvas);
