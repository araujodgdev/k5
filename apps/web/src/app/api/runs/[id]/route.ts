import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { ownedRun, publicRun } from '@/lib/ai-store';
import { z } from 'zod';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request);
    const run = ownedRun(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!run) throw new ApiError(404, 'Tarefa não encontrada.');
    return Response.json({ run: publicRun(run) });
  } catch (e) { return apiError(e); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request, true);
    const { action } = z.object({ action: z.enum(['retry', 'cancel']) }).parse(await limitedJson(request));
    const run = ownedRun(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!run) throw new ApiError(404, 'Tarefa não encontrada.');
    if (action === 'retry' && run.status === 'failed') database.prepare("UPDATE ai_run SET status='queued',error=NULL,attempts=0,lease_until=0 WHERE id=?").run(run.id);
    else if (action === 'cancel' && ['queued','running'].includes(run.status)) database.prepare("UPDATE ai_run SET status='cancelled',lease_until=0 WHERE id=?").run(run.id);
    else throw new ApiError(409, 'Esta ação não está disponível para a tarefa.');
    return Response.json({ run: publicRun(ownedRun(database, { officeId: office.officeId, userId: user.id }, run.id)!) });
  } catch (e) { return apiError(e); }
}
