import { requestCapability } from '@/lib/capabilities/http-client';
import type { CapabilityName, CapabilityOutput } from '@/lib/capabilities/contracts';

// UI forms validate fields; authenticated endpoints remain the authority for contracts and roles.
export const selectStyle = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9';
export type Choice = { id: string; name: string };
export async function agendaCall<N extends CapabilityName>(name: N, input: Record<string, unknown>): Promise<CapabilityOutput<N>> {
  const result = await requestCapability(name, input);
  if (!result.ok) throw new Error(result.error);
  return result.data as CapabilityOutput<N>;
}
