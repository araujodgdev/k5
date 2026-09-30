import { z } from 'zod';
import { apiError, apiWorkspace } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { downloadManagedSignature } from '@/lib/signatures/service';
import { portalFileResponse } from '@/lib/client-portal/http';
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string; id: string; format: string }> }) {
  try { const p = await params; return portalFileResponse(await downloadManagedSignature(workspaceContext(await apiWorkspace(request)), z.string().uuid().parse(p.clientId), p.id, z.enum(['pdf','evidence']).parse(p.format))); }
  catch (error) { return apiError(error); }
}
