import "server-only";
import { database } from "@/lib/database";
import { planTaskModel } from "@/lib/ai-connections";
import { planReadsImages } from "@/lib/ai-assignments-core";
import { hasAcceptedCurrent } from "@/lib/legal-acceptance";
import type { Modalities } from "@/lib/ai-modalities";

/** What the panel needs from the server before its first paint: the AI notice and what the composer accepts. */
export type LumeSetup = { aiNoticeAccepted: boolean; modalities: Modalities };

/** The office layout already holds the workspace; it passes it here instead of resolving the session again. */
export async function lumeSetup(workspace: { user: { id: string } }): Promise<LumeSetup> {
  const [accepted, chat, transcription] = await Promise.allSettled([
    hasAcceptedCurrent(database, workspace.user.id, "ai_notice"),
    planTaskModel("agent.chat"),
    planTaskModel("transcription.voice_note"),
  ]);
  // Images depend on the conversation's model; the microphone on the transcription task.
  const modalities = chat.status === "fulfilled" && transcription.status === "fulfilled"
    ? { image: planReadsImages(chat.value), audio: transcription.value.status === "ready" }
    : { image: false, audio: false };
  return { aiNoticeAccepted: accepted.status === "fulfilled" && accepted.value, modalities };
}
