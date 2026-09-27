import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentChat } from "@/components/agent-chat";
import { Reveal } from "@/components/reveal";
import { appNavigation } from "@/lib/navigation";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { conversationBootstrap } from "@/lib/ai-store";
import { planTaskModel } from "@/lib/ai-connections";
import { planReadsImages } from "@/lib/ai-assignments-core";
import { caseAccess } from '@/lib/collaboration/access';

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ conversationId?: string; caseId?: string }> };

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
    const { conversationId, caseId } = await searchParams;
    if (caseId) await caseAccess(user.id, caseId);
    const [history, chat, transcription] = await Promise.allSettled([
      conversationBootstrap(database, { officeId: office.officeId, userId: user.id }, conversationId),
      planTaskModel('agent.chat'),
      planTaskModel('transcription.voice_note'),
    ]);
    // Images depend on the conversation's model; the microphone on the transcription task.
    const modalities = chat.status === 'fulfilled' && transcription.status === 'fulfilled'
      ? { image: planReadsImages(chat.value), audio: transcription.value.status === 'ready' } : undefined;
    // A failed prefetch falls back to the existing API loading/error path in the chat.
    return <AgentChat key={`${conversationId ?? 'latest'}:${caseId ?? ''}`} initialConversationId={conversationId} initialCaseId={caseId}
      initialData={history.status === 'fulfilled' ? history.value : undefined}
      modalities={modalities} />;
  }
  return (
    <Reveal className="mx-auto w-full max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="page-title max-md:sr-only" data-reveal>{item.label}</h1>
      <p className="grid min-h-[50dvh] place-items-center text-subtle-foreground" data-reveal>Em breve</p>
    </Reveal>
  );
}
