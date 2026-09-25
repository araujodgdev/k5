import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentChat } from "@/components/agent-chat";
import { Reveal } from "@/components/reveal";
import { appNavigation } from "@/lib/navigation";
import { requireWorkspace } from "@/lib/session";
import { database } from "@/lib/database";
import { conversationBootstrap } from "@/lib/ai-store";
import { resolveProfileConfig } from "@/lib/ai-connections";
import { modelModalities } from "@/lib/ai-modalities";

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ conversationId?: string }> };

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
    const { conversationId } = await searchParams;
    const [history, model] = await Promise.allSettled([
      conversationBootstrap(database, { officeId: office.officeId, userId: user.id }, conversationId),
      resolveProfileConfig('chat'),
    ]);
    // A failed prefetch falls back to the existing API loading/error path in the chat.
    return <AgentChat key={conversationId ?? 'latest'} initialConversationId={conversationId}
      initialData={history.status === 'fulfilled' ? history.value : undefined}
      modalities={model.status === 'fulfilled' ? modelModalities(model.value.provider, model.value.modelId) : undefined} />;
  }
  return (
    <Reveal className="mx-auto w-full max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="page-title max-md:sr-only" data-reveal>{item.label}</h1>
      <p className="grid min-h-[50dvh] place-items-center text-subtle-foreground" data-reveal>Em breve</p>
    </Reveal>
  );
}
