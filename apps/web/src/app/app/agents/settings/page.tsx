import type { Metadata } from "next";
import { AgentSettings } from "@/components/agent-settings";
import { requireWorkspace } from "@/lib/session";
import { canEditTemplate, documentTemplates, templateCandidates } from "@/lib/agent-profile";
import { canEditInstructions, INSTRUCTION_BUDGET, listInstructions } from "@/lib/agent-instructions";
import { ALWAYS_BUDGET, canEditKnowledge, knowledgeCandidates, listKnowledge } from "@/lib/agent-knowledge";

export const metadata: Metadata = { title: "Personalizar Lume" };

export default async function AgentSettingsPage() {
  const { office, user } = await requireWorkspace();
  const owner = { officeId: office.officeId, userId: user.id };
  const [templates, candidates, rules, knowledge, documents] = await Promise.all([
    documentTemplates(owner), templateCandidates(office.officeId), listInstructions(owner), listKnowledge(owner), knowledgeCandidates(office.officeId),
  ]);
  return (
    <AgentSettings
      initialTemplates={{ ...templates, canEditOffice: canEditTemplate(office.role, "office"), canEditPersonal: canEditTemplate(office.role, "personal") }}
      initialCandidates={candidates}
      initialRules={{ ...rules, budget: INSTRUCTION_BUDGET, canEditOffice: canEditInstructions(office.role, "office") }}
      initialKnowledge={{ ...knowledge, budget: ALWAYS_BUDGET, canEditOffice: canEditKnowledge(office.role, "office") }}
      knowledgeCandidates={documents}
    />
  );
}
