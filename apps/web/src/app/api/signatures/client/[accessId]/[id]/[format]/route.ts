import { z } from 'zod';
import { apiError } from '@/lib/workspace-api';
import { apiClientPortal, portalFileResponse } from '@/lib/client-portal/http';
import { downloadClientSignature } from '@/lib/signatures/service';
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string; id: string; format: string }> }) {
  try { const p = await params; return portalFileResponse(await downloadClientSignature(await apiClientPortal(request), z.string().uuid().parse(p.accessId), p.id, z.enum(['pdf','evidence']).parse(p.format))); }
  catch (error) { return apiError(error); }
}
