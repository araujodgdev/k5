import { z } from 'zod';
import { apiError, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { cancelSignature, managedSignatures, recoverSignature, refreshManagedSignature, requestSignature } from '@/lib/signatures/service';
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try { const { clientId } = await params; return Response.json(await managedSignatures(workspaceContext(await apiWorkspace(request)), z.string().uuid().parse(clientId)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
const inputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('request'), fileId: z.string().uuid(), method: z.enum(['email','certificate']), idempotencyKey: z.string().uuid() }),
  z.object({ operation: z.literal('refresh'), id: z.string().uuid() }),
  z.object({ operation: z.literal('cancel'), id: z.string().uuid() }),
  z.object({ operation: z.literal('recover'), id: z.string().uuid(), providerToken: z.string().uuid() }),
]);
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const context = workspaceContext(await apiWorkspace(request, true)), { clientId } = await params;
    z.string().uuid().parse(clientId); const input = inputSchema.parse(await limitedJson(request, 4096));
    switch (input.operation) {
      case 'request': return Response.json(await requestSignature(context, { ...input, clientId }));
      case 'refresh': return Response.json(await refreshManagedSignature(context, clientId, input.id));
      case 'cancel': return Response.json(await cancelSignature(context, clientId, input.id));
      case 'recover': return Response.json(await recoverSignature(context, clientId, input.id, input.providerToken));
    }
  } catch (error) { return apiError(error); }
}
