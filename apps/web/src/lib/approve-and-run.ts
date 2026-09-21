/**
 * Runs a capability that is gated on an explicit approval, from the browser.
 *
 * Destructive capabilities refuse to act on an `approvalId` they were not given, and the proposal
 * records the exact arguments: changing one after the fact invalidates it. An agent therefore
 * cannot delete anything a person did not confirm. A person clicking through a confirmation
 * dialog has confirmed it, so the dialog proposes and approves on their behalf and then calls
 * the capability — the same audited path the agent takes, not a bypass around it.
 *
 * `input` must be exactly what the route will rebuild the proposal from, or the approval is
 * rejected as tampered with.
 */
export async function approveAndRun(
  capabilityName: string,
  input: Record<string, unknown>,
  run: (approvalId: string) => Promise<Response>,
): Promise<string | undefined> {
  const proposed = await fetch("/api/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capabilityName, input }),
  });
  const proposal = await proposed.json().catch(() => null) as { proposal?: { id: string }; error?: string } | null;
  if (!proposed.ok || !proposal?.proposal?.id) return proposal?.error ?? "Não foi possível registrar a confirmação.";

  const approvalId = proposal.proposal.id;
  const approved = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve" }),
  });
  if (!approved.ok) {
    const result = await approved.json().catch(() => null) as { error?: string } | null;
    return result?.error ?? "Não foi possível confirmar a operação.";
  }

  const response = await run(approvalId);
  if (response.ok) return undefined;
  const result = await response.json().catch(() => null) as { error?: string } | null;
  return result?.error ?? "Não foi possível concluir a operação.";
}
