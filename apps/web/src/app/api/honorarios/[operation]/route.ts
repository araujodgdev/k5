import { handleCapability } from '@/lib/capability-route';
import type { CapabilityName } from '@/lib/capabilities/contracts';

const operations: Readonly<Record<string, CapabilityName>> = {
  list: 'k5_honorarios_list', get: 'k5_honorarios_get', options: 'k5_honorarios_options',
  create: 'k5_honorarios_create', receive: 'k5_honorarios_receive', reverse: 'k5_honorarios_reverse', cancel: 'k5_honorarios_cancel',
};

export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  const { operation } = await params;
  const name = Object.hasOwn(operations, operation) ? operations[operation] : undefined;
  if (!name) return Response.json({ error: 'Operação não encontrada.' }, { status: 404 });
  return handleCapability(request, name);
}
