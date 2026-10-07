import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AgentChat } from "@/components/agent-chat";
import { appNavigation } from "@/lib/navigation";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { conversationBootstrap } from "@/lib/ai-store";
import { planTaskModel } from "@/lib/ai-connections";
import { planReadsImages } from "@/lib/ai-assignments-core";
import { caseAccess } from '@/lib/collaboration/access';
import { AiDataNotice } from '@/components/legal-gate';
import { hasAcceptedCurrent } from '@/lib/legal-acceptance';
import { isCanvasShellEnabled } from '@/lib/canvas-shell/rollout';

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ conversationId?: string; caseId?: string; doc?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: appNavigation.find((item) => item.slug === section)?.label ?? "Página não encontrada" };
}

export default async function SectionPage({ params, searchParams }: Props) {
  const { office, user } = await requireWorkspace();
  const { section } = await params;
  const item = appNavigation.find((entry) => entry.slug === section);
  if (!item) notFound();
  if (item.slug === "agents") {
    const { conversationId, caseId, doc } = await searchParams;
    if (caseId) await caseAccess(user.id, caseId);
    // In the canvas shell the Lume is the panel beside every page: its links open Início, or the
    // document they had open beside the chat, and the panel opens the conversation they name.
    if (await isCanvasShellEnabled(office.officeId)) {
      const query = new URLSearchParams({ ...(conversationId ? { conversationId } : {}), ...(caseId ? { caseId } : {}) }).toString();
      redirect(`${doc ? `/app/documents/${encodeURIComponent(doc)}` : "/app/command-center"}${query ? `?${query}` : ""}`);
    }
    // The first visit to the Lume explains, once, what reaches the AI providers and how.
    if (!await hasAcceptedCurrent(database, user.id, 'ai_notice')) return <AiDataNotice />;
    const [history, chat, transcription] = await Promise.allSettled([
      conversationBootstrap(database, { officeId: office.officeId, userId: user.id }, conversationId),
      planTaskModel('agent.chat'),
      planTaskModel('transcription.voice_note'),
    ]);
    // Images depend on the conversation's model; the microphone on the transcription task.
    const modalities = chat.status === 'fulfilled' && transcription.status === 'fulfilled'
      ? { image: planReadsImages(chat.value), audio: transcription.value.status === 'ready' } : undefined;
    // A failed prefetch falls back to the existing API loading/error path in the chat.
    return <AgentChat key={`${conversationId ?? 'latest'}:${caseId ?? ''}`} mode={{ kind: 'page', initialData: history.status === 'fulfilled' ? history.value : undefined }}
      userName={user.name} initialConversationId={conversationId} initialCaseId={caseId} modalities={modalities} />;
  }
  return (
    <div className="w-full max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="page-title max-md:sr-only">{item.label}</h1>
      <p className="grid min-h-[50dvh] place-items-center text-subtle-foreground">Em breve</p>
    </div>
  );
}
