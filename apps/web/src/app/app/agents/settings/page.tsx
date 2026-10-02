import type { Metadata } from "next";
import { AgentSettings } from "@/components/agent-settings";
import { requireWorkspace } from "@/lib/session";
import { documentTemplates, templateCandidates } from "@/lib/agent-profile";
import { INSTRUCTION_BUDGET, listInstructions } from "@/lib/agent-instructions";
import { ALWAYS_BUDGET, knowledgeCandidates, listKnowledge } from "@/lib/agent-knowledge";

export const metadata: Metadata = { title: "Personalizar Lume" };

export default async function AgentSettingsPage() {
  const { office, user } = await requireWorkspace();
  const owner = { officeId: office.officeId, userId: user.id };
  const [templates, candidates, rules, knowledge, documents] = await Promise.all([
    documentTemplates(owner), templateCandidates(owner), listInstructions(owner), listKnowledge(owner), knowledgeCandidates(owner),
  ]);
  return (
    <AgentSettings
      initialTemplates={templates}
      initialCandidates={candidates}
      initialRules={{ ...rules, budget: INSTRUCTION_BUDGET }}
      initialKnowledge={{ ...knowledge, budget: ALWAYS_BUDGET }}
      knowledgeCandidates={documents}
    />
  );
}
