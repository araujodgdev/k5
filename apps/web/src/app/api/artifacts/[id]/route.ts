import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { ownedArtifact, publicArtifact, updateArtifact } from '@/lib/ai-store';
import { z } from 'zod';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { office, user } = await apiWorkspace(request);
    const artifact = await ownedArtifact(database, { officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!artifact) throw new ApiError(404, 'Documento não encontrado.');
    return Response.json({ artifact: publicArtifact(artifact) });
  } catch (e) { return apiError(e); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { office, user } = await apiWorkspace(request, true);
    const body = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(1).max(2_000_000), version: z.number().int().positive(), snapshot: z.boolean().default(true) }).parse(await limitedJson(request, 2_100_000));
    const owner = { officeId: (office).officeId, userId: user.id };
    const id = (await context.params).id;
    if (!await ownedArtifact(database, owner, id)) throw new ApiError(404, 'Documento não encontrado.');
    const updated = await updateArtifact(database, owner, id, body.title, body.content, body.version, { snapshot: body.snapshot });
    if (!updated) throw new ApiError(409, 'O documento mudou em outra aba. Recarregue antes de salvar.');
    return Response.json({ artifact: publicArtifact(updated) });
  } catch (e) { return apiError(e); }
}
