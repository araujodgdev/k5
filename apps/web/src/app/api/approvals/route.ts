import { apiWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { createApprovalProposal } from '@/lib/application/approvals-service';
import { database } from '@/lib/database';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspace = await apiWorkspace(request);
    const rows = await database.prepare(
      "SELECT * FROM capability_approval WHERE office_id=? AND user_id=? AND status='pending' AND expires_at > ? ORDER BY created_at DESC"
    ).all((workspace.office).officeId, workspace.user.id, Date.now());
    return Response.json({ approvals: rows });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const body = z.object({
      capabilityName: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      targetResourceId: z.string().optional().nullable(),
      targetVersion: z.number().optional().nullable(),
      ttlMs: z.number().optional(),
    }).parse(await limitedJson(request));

    const proposal = await createApprovalProposal(
      workspaceContext(workspace),
      body.capabilityName,
      body.input,
      body.targetResourceId,
      body.targetVersion,
      body.ttlMs
    );
    return Response.json({ proposal }, { status: 201 });
  } catch (error) { return apiError(error); }
}
