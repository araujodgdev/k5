import { z } from 'zod';
import { database } from '@/lib/database';
import { apiError, ApiError, apiPersonalWorkspace, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { conversationArtifacts } from '@/lib/conversation-artifacts';
import { workspaceContext } from '@/lib/application/context';
import { runCapability } from '@/lib/agent-tools';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request, context: Context) {
  try {
    const { user, office } = await apiWorkspace(request);
    const result = await conversationArtifacts({ officeId: office.officeId, userId: user.id }, (await context.params).id);
    if (!result) throw new ApiError(404, 'Conversa não encontrada.');
    return Response.json(result, { headers: noStore });
  } catch (error) { return apiError(error); }
}

const destination = { scope: z.enum(['library', 'case']), caseId: z.string().min(1).max(200).optional(), folderId: z.string().min(1).max(200).nullish() };
const saveRequest = z.discriminatedUnion('source', [
  z.object({ source: z.literal('document'), id: z.string().min(1).max(200), version: z.number().int().positive(), format: z.enum(['pdf', 'docx']), ...destination }),
  z.object({ source: z.literal('attachment'), id: z.string().min(1).max(200), ...destination }),
]);

/**
 * Saves a document or an attachment of this conversation to the Vault, through the same
 * capabilities the Lume uses, so the person and the agent get the same copy for the same request.
 */
export async function POST(request: Request, context: Context) {
  try {
    const workspace = await apiPersonalWorkspace(request, true);
    const conversationId = (await context.params).id;
    const owner = { officeId: workspace.office.officeId, userId: workspace.user.id };
    if (!await database.prepare('SELECT 1 FROM ai_conversation WHERE id=? AND office_id=? AND user_id=?').get(conversationId, owner.officeId, owner.userId))
      throw new ApiError(404, 'Conversa não encontrada.');
    const parsed = saveRequest.safeParse(await limitedJson(request));
    if (!parsed.success) throw new ApiError(400, 'Escolha o arquivo e o destino no Cofre.');
    const body = parsed.data;
    const scoped = { ...workspaceContext(workspace), conversationId, invocation: 'webmcp' as const, signal: request.signal };
    const target = { scope: body.scope, caseId: body.caseId, folderId: body.folderId ?? null };
    if (body.source === 'document') {
      if (!await database.prepare('SELECT 1 FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? AND conversation_id=?').get(body.id, owner.officeId, owner.userId, conversationId))
        throw new ApiError(404, 'Documento não encontrado nesta conversa.');
      return Response.json(await runCapability(scoped, 'k5_vault_save_artifact', { artifactId: body.id, version: body.version, format: body.format, ...target }), { headers: noStore });
    }
    return Response.json(await runCapability(scoped, 'k5_vault_import_chat_attachment', { attachmentId: body.id, ...target }), { headers: noStore });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
