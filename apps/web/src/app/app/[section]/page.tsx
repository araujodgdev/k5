import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentChat } from "@/components/agent-chat";
import { Reveal } from "@/components/reveal";
import { appNavigation } from "@/lib/navigation";
import { requireWorkspace } from "@/lib/session";

type Props = { params: Promise<{ section: string }>; searchParams: Promise<{ conversationId?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: appNavigation.find((item) => item.slug === section)?.label ?? "Página não encontrada" };
}

export default async function SectionPage({ params, searchParams }: Props) {
  await requireWorkspace();
  const { section } = await params;
  const item = appNavigation.find((entry) => entry.slug === section);
  if (!item) notFound();
  if (item.slug === "agents") return <AgentChat initialConversationId={(await searchParams).conversationId} />;
  return (
    <Reveal className="mx-auto w-full max-w-5xl px-5 py-6 md:px-12 md:py-11">
      <h1 className="display text-[30px] md:text-[28px]" data-reveal>{item.label}</h1>
      <p className="grid min-h-[50dvh] place-items-center text-subtle-foreground" data-reveal>Em breve</p>
    </Reveal>
  );
}
