import { handleCapability } from '@/lib/capability-route';
import type { CapabilityName } from '@/lib/capabilities/contracts';

const operations: Readonly<Record<string, CapabilityName>> = { preview: 'k5_calc_preview', save: 'k5_calc_save', get: 'k5_calc_get', list: 'k5_calc_list' };
export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  const name = Object.hasOwn(operations, operation) ? operations[operation] : undefined;
  if (!name) return Response.json({ error: 'Operação não encontrada.' }, { status: 404 });
  return handleCapability(request, name);
}
