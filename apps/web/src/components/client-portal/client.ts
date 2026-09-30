'use client';
import { z } from 'zod';
export async function portalCall(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const error = z.object({ error: z.string() }).safeParse(body); throw new Error(error.success ? error.data.error : 'Não foi possível concluir. Tente novamente.'); }
  return body;
}
export function portalMutation(operation: string, data: Record<string, unknown>) {
  return portalCall('/api/client-portal/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, data }) });
}
