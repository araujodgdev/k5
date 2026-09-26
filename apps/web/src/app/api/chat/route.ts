import type { UIMessage } from 'ai';
import { chatRequestSchema } from '@/lib/chat-contract';
import { captureOperationalError } from '@/lib/observability/report';
import { database } from '@/lib/database';
import { apiWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { conversation, mergeHistory, saveMessages } from '@/lib/ai-store';
import { selectedResearchSources } from '@/lib/ai-sources';
import { workspaceContext } from '@/lib/application/context';
import { modelModalities } from '@/lib/ai-modalities';
import { resolveChatAttachments, claimChatAttachments, publicChatAttachment } from '@/lib/chat-attachments';
import { attachmentPart } from '@/lib/chat-attachment-contract';
import { resolveModelConfig } from '@/lib/ai-connections';
import { transcribeAudio, transcribesAudio } from '@/lib/audio-transcription';
import { chatRunResponse, followChatRun, startChatRun } from '@/lib/chat-run';

export const runtime = 'nodejs';

/** Longer than the agent's own 180 s budget plus the citation review, so the lock outlives the turn. */
const TURN_LOCK_MS = 300_000;

/**
 * Accepts a message, stores it and starts the turn; the answer streams back from the run, which
 * keeps going if this request goes away (see chat-run.ts). Reopening the page follows the same run
 * through /api/chat/[id]/stream.
 */
export async function POST(request: Request) {
  try {
    const workspace = await apiWorkspace(request, true);
    const { user, office } = workspace;
    const parsed = chatRequestSchema.safeParse(await limitedJson(request));
    if (!parsed.success) {
      captureOperationalError(parsed.error, 'chat.request.invalid');
      throw new ApiError(400, 'Confira os dados enviados.');
    }
    const body = parsed.data;
    const id = body.conversationId ?? body.id;
    if (!id) throw new ApiError(400, 'Selecione uma conversa.');
    const owner = { officeId: (office).officeId, userId: user.id };
    const stored = await conversation(database, owner, id);
    if (!stored) throw new ApiError(404, 'Conversa não encontrada.');
    const chatAttachments = await resolveChatAttachments(owner,id,body.message.id,body.attachmentIds);
    if (body.message.role !== 'user') throw new ApiError(400, 'Envie uma mensagem.');
    const text = body.message.parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('\n').trim();
    if (!text || text.length > 20000) throw new ApiError(400, 'Escreva uma mensagem de até 20 mil caracteres.');
    if (body.researchReferenceIds.length && !body.caseId) throw new ApiError(400, 'Selecione o caso das referências.');
    const context = workspaceContext(workspace);
    // Refuses references outside the selected case before anything is stored.
    if (body.researchReferenceIds.length) await selectedResearchSources(context, body.caseId!, body.researchReferenceIds);
    const config = await resolveModelConfig('chat');

    const locked = await database.prepare('UPDATE ai_conversation SET busy_until=? WHERE id=? AND office_id=? AND user_id=? AND busy_until<?').run(Date.now() + TURN_LOCK_MS, id, (office).officeId, user.id, Date.now());
    if (!locked.changes) throw new ApiError(409, 'Aguarde a resposta atual.');
    try {
      if (chatAttachments.some(item=>item.media_type.startsWith('image/')) && !modelModalities(config.provider,config.modelId).image) throw new ApiError(400,'O modelo configurado não lê imagens. Peça ao administrador para usar um modelo com visão.');
      await claimChatAttachments(owner,id,body.message.id,chatAttachments);
      // A voice note for an OpenAI model becomes text before anything is stored, so the history,
      // the model and the person all see the same words.
      const spoken = transcribesAudio(config.provider)
        ? (await Promise.all(body.attachments.filter(item => item.mediaType.startsWith('audio/')).map(item => transcribeAudio(config.apiKey, item, request.signal)
          .catch(error => { captureOperationalError(error, 'chat.audio.transcription'); throw new ApiError(502, 'Não foi possível transcrever o áudio. Tente de novo ou escreva a mensagem.'); })))).filter(Boolean)
        : [];
      const input: UIMessage = { id: body.message.id, role: 'user', parts: [{ type: 'text', text: [text, ...spoken.map(item => `[Áudio] ${item}`)].join('\n\n') },...chatAttachments.map(item=>attachmentPart(publicChatAttachment(item)))] };
      await saveMessages(database, owner, id, mergeHistory(stored.messages, input));
      await startChatRun({
        workspace: { userId: context.userId, officeId: context.officeId, role: context.role, sessionId: context.sessionId },
        conversationId: id,
        request: { documentIds: body.documentIds, caseId: body.caseId, researchReferenceIds: body.researchReferenceIds, attachments: body.attachments,
          timeZone: body.timeZone, openDocumentId: body.openDocumentId, selection: body.selection },
      });
    } catch (error) {
      await database.prepare('UPDATE ai_conversation SET busy_until=0 WHERE id=? AND office_id=?').run(id, (office).officeId);
      throw error;
    }
    const stream = await followChatRun(id);
    if (!stream) throw new ApiError(502, 'Não foi possível acompanhar a resposta. Reabra a conversa.');
    return chatRunResponse(stream);
  } catch (e) { return apiError(e); }
}
