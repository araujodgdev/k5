/**
 * Step count alone does not bound cost, and it does not stop an agent that calls the same tool
 * with the same arguments forever. This budgets both for one chat turn.
 *
 * A provider-executed tool (the model's own web search) reaches us with an empty input: what it
 * did is only in its result (`action`: the queries it ran, the page it opened). Its repeats are
 * judged by that action, and it has its own, larger allowance because one answer may search and
 * open several pages inside a single model step.
 */
export const MAX_TOOL_CALLS = 16;
export const MAX_PROVIDER_CALLS = 30;
export const MAX_REPEATS = 2;

export class ToolBudget {
  private calls = 0;
  private providerCalls = 0;
  private readonly repeats = new Map<string, number>();
  private readonly inputs = new Map<string, { input: string; providerExecuted: boolean }>();

  called(callId: string, input: unknown, providerExecuted: boolean) {
    this.inputs.set(callId, { input: JSON.stringify(input ?? null), providerExecuted });
  }

  /** Counts a finished call; returns why the turn must stop, or null to go on. */
  finished(callId: string, name: string, result: unknown): { reason: 'repeated' | 'budget'; message: string } | null {
    const call = this.inputs.get(callId);
    const providerExecuted = call?.providerExecuted ?? false;
    const action = providerExecuted && result && typeof result === 'object' ? (result as { action?: unknown }).action : undefined;
    const signature = `${name}:${providerExecuted ? JSON.stringify(action ?? callId) : call?.input ?? callId}`;
    const seen = (this.repeats.get(signature) ?? 0) + 1;
    this.repeats.set(signature, seen);
    if (providerExecuted) this.providerCalls += 1; else this.calls += 1;
    if (seen > MAX_REPEATS) return { reason: 'repeated', message: `\n[Interrompi: a mesma consulta (${name}) se repetiu sem mudar o resultado. Reformule o pedido ou ajuste os documentos selecionados.]` };
    if (this.calls >= MAX_TOOL_CALLS || this.providerCalls >= MAX_PROVIDER_CALLS) {
      return { reason: 'budget', message: '\n[Interrompi: limite de operações desta resposta atingido. Peça a próxima etapa e eu continuo.]' };
    }
    return null;
  }

  get total() { return this.calls + this.providerCalls; }
}
