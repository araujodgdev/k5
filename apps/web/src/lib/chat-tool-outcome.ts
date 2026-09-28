import type { ApprovalRequest } from '@/lib/agent-tools';

/** A tool call that finished, whether the tool returned or threw. */
export type ToolOutcome = { callId: string; name: string; result: unknown; failed: boolean };

/**
 * Mastra streams a returned value as `tool-result` and a thrown error as `tool-error`. The chat
 * needs both: a gated action throws, and it must still become a Confirmar button.
 */
export function toolOutcome(chunk: { type: string; payload?: unknown }): ToolOutcome | null {
  if (chunk.type === 'tool-result') {
    const payload = chunk.payload as { toolCallId: string; toolName: string; result: unknown; isError?: boolean };
    return { callId: payload.toolCallId, name: payload.toolName, result: payload.result, failed: Boolean(payload.isError) };
  }
  if (chunk.type === 'tool-error') {
    const payload = chunk.payload as { toolCallId: string; toolName: string; error: unknown };
    const message = payload.error instanceof Error ? payload.error.message : String(payload.error);
    return { callId: payload.toolCallId, name: payload.toolName, result: { error: message }, failed: true };
  }
  return null;
}

/** The confirmation this call is waiting for, taken out of the ones gated during the stream. */
export function takeApproval(pending: ApprovalRequest[], outcome: ToolOutcome): ApprovalRequest | undefined {
  if (!outcome.failed) return undefined;
  const index = pending.findIndex(item => item.toolCallId ? item.toolCallId === outcome.callId : item.capability === outcome.name);
  return index < 0 ? undefined : pending.splice(index, 1)[0];
}
