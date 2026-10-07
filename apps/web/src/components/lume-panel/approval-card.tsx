"use client";

import { useContext, useState } from "react";
import { Check, CircleAlert, CircleMinus, LoaderCircle, ShieldCheck } from "lucide-react";
import { GoogleApprovalReview } from "@/components/google/client";
import { Button } from "@/components/ui/button";
import { approvalDecision } from "@/lib/chat-approval-state";
import { toolModule } from "@/lib/chat-status";
import { isCanvasHref } from "@/lib/canvas-protocol";
import { cn } from "@/lib/utils";
import { ApprovalDecisionsContext, ConversationIdContext, DocumentLinksContext } from "./chat-context";
import { MODULE_ICONS } from "./icons";
import { MODULE_LABELS } from "./plan";
import { OpenStep } from "./plan-card";

export type ApprovalData = { approvalId: string; capability?: string; summary: string; state: "pending" | "confirmed" | "cancelled" | "failed"; result?: string; href?: string };

const GOOGLE_WITHOUT_REVIEW = new Set(["k5_calendar_discard_pending", "k5_calendar_share_event", "k5_calendar_unshare_event"]);
const OUTCOME = { confirmed: "Confirmado", cancelled: "Cancelado", failed: "Não concluído" } as const;

/** "Enviar para Felipe no WhatsApp:\nOlá…" → the line that says what it is, and the content itself. */
function splitApproval(summary: string, fallback: string) {
  const [first, ...rest] = summary.trim().split("\n");
  const body = rest.join("\n").trim();
  return body ? { context: first.replace(/:$/, ""), body } : { context: fallback, body: summary.trim() };
}

/**
 * The only thing the Lume asks before acting: sending, deleting, reaching a court, overwriting a
 * draft, moving money. Confirmar runs exactly the action it proposed on the server; nothing is
 * retyped by the model.
 */
export function ApprovalCard({ data }: { data: ApprovalData }) {
  const conversationId = useContext(ConversationIdContext);
  const documents = useContext(DocumentLinksContext);
  const decisions = useContext(ApprovalDecisionsContext);
  const capability = data?.capability ?? "";
  const googleApproval = /^k5_(gmail|calendar|drive|docs)_/.test(capability) && !GOOGLE_WITHOUT_REVIEW.has(capability);
  const [reviewReady, setReviewReady] = useState(false);
  const [busy, setBusy] = useState<"" | "confirm" | "cancel">("");
  const [error, setError] = useState("");
  if (!data?.approvalId) return null;
  const current = decisions?.decisions.get(data.approvalId) ?? data;
  const pending = current.state === "pending";
  const area = toolModule(capability);
  const Icon = area ? MODULE_ICONS[area] : ShieldCheck;
  const { context, body } = splitApproval(data.summary, area ? MODULE_LABELS[area] : "Ação do Lume");

  async function decide(decision: "confirm" | "cancel") {
    setBusy(decision); setError("");
    try {
      const response = await fetch(`/api/chat/approvals/${encodeURIComponent(data.approvalId)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, conversationId }),
      });
      const result = await response.json().catch(() => ({})) as ApprovalData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível concluir. Peça de novo ao Lume.");
      decisions?.record(data.approvalId, approvalDecision.parse(result));
      // A confirmed action is the Lume's change too: the canvas brings up what it touched.
      if (result.state === "confirmed" && result.href && isCanvasHref(result.href)) documents?.follow({ action: "open", href: result.href });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível concluir."); }
    finally { setBusy(""); }
  }

  return (
    <div role="group" aria-label="Confirmação" className={cn("flex flex-col gap-3 rounded-lg border bg-card p-3.5 max-md:rounded-[14px]", pending ? "border-brand" : "border-border")}>
      <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{context}</span>
      </p>
      <p className="text-sm leading-[1.55] break-words whitespace-pre-wrap text-foreground max-md:text-[15px]">{body}</p>
      {googleApproval && pending && <GoogleApprovalReview approvalId={data.approvalId} onReady={setReviewReady} />}
      {current.state === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-40 flex-1 text-[12.5px] text-muted-foreground max-md:basis-full">O Lume só faz isso com a sua confirmação.</span>
          <Button type="button" variant="outline" className="max-md:h-11 max-md:flex-1" disabled={Boolean(busy)} onClick={() => void decide("cancel")}>
            {busy === "cancel" && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Cancelar
          </Button>
          <Button type="button" className="max-md:h-11 max-md:flex-1" disabled={Boolean(busy) || (googleApproval && !reviewReady)} onClick={() => void decide("confirm")}>
            {busy === "confirm" && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Confirmar
          </Button>
        </div>
      ) : (
        <p role="status" className={cn("flex flex-wrap items-center gap-x-1.5 text-[12.5px]", current.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {current.state === "confirmed" ? <Check className="size-3.5" aria-hidden="true" /> : current.state === "cancelled" ? <CircleMinus className="size-3.5" aria-hidden="true" /> : <CircleAlert className="size-3.5" aria-hidden="true" />}
          <span>{OUTCOME[current.state]}{current.result ? ` · ${current.result}` : ""}</span>
          {current.href && <OpenStep href={current.href} title={context} className="-my-1" />}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
