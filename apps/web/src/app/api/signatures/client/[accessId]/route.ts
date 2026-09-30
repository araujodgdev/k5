import { z } from 'zod';
import { apiError, limitedJson } from '@/lib/workspace-api';
import { apiClientPortal } from '@/lib/client-portal/http';
import { clientSignatures, refreshClientSignature } from '@/lib/signatures/service';
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string }> }) {
  try { const { accessId } = await params; return Response.json(await clientSignatures(await apiClientPortal(request), z.string().uuid().parse(accessId)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ accessId: string }> }) {
  try { const context = await apiClientPortal(request, true), { accessId } = await params;
    const input = z.object({ id: z.string().uuid() }).parse(await limitedJson(request, 4096));
    return Response.json(await refreshClientSignature(context, z.string().uuid().parse(accessId), input.id));
  } catch (error) { return apiError(error); }
}
