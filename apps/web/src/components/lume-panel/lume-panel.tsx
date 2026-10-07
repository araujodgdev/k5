"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AgentChat } from "@/components/agent-chat";
import { AiDataNotice } from "@/components/legal-gate";
import type { LumeSetup } from "./setup";

/**
 * The Lume's panel, mounted once by the office shell beside the canvas. A link that names a
 * conversation (`?conversationId=`, optionally `&caseId=`) opens it here, wherever the canvas is.
 */
export function LumePanel({ userName, setup }: { userName: string; officeName: string; setup: LumeSetup }) {
  const params = useSearchParams();
  const [accepted, setAccepted] = useState(setup.aiNoticeAccepted);
  if (!accepted) {
    return <div className="flex h-full min-h-0 flex-col overflow-y-auto"><AiDataNotice onAccepted={() => setAccepted(true)} /></div>;
  }
  return <AgentChat mode={{ kind: "panel" }} userName={userName} modalities={setup.modalities}
    initialConversationId={params.get("conversationId") ?? ""} initialCaseId={params.get("caseId") ?? undefined} />;
}
