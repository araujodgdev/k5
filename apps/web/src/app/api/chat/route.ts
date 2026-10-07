import type { UIMessage } from 'ai';
import { chatRequestSchema } from '@/lib/chat-contract';
import { captureOperationalError } from '@/lib/observability/report';
import { database, withTransaction } from '@/lib/database';
import { apiWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { conversation, mergeHistory } from '@/lib/ai-store';
import { admitTurn, releaseTurn, TurnFenced, writeTurnHistory } from '@/lib/chat-lease';
import { workspaceContext } from '@/lib/application/context';
import { authorizeMessageScope } from '@/lib/chat-scope-server';
import { requestedMessageScope } from '@/lib/chat-scope';
import { chatHearsAudio, modelModalities } from '@/lib/ai-modalities';
import { resolveChatAttachments, claimChatAttachments, publicChatAttachment, createChatAttachment } from '@/lib/chat-attachments';
import { attachmentPart } from '@/lib/chat-attachment-contract';
import { planTaskModel } from '@/lib/ai-connections';
import { transcribeVoiceNote, TranscriptionError } from '@/lib/audio-transcription';
import { chatRunResponse, followChatRun, startChatRun } from '@/lib/chat-run';
import { assertCredits } from '@/lib/billing/credits';
import { recordPersonRequest } from '@/lib/documents/shared-writing';

export const runtime = 'nodejs';

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
    const original = stored.messages.find(message => message.id === body.message.id && message.role === 'user');
    const attachmentIds = original ? original.parts.flatMap(part => part.type === 'data-attachment' && part.data && typeof part.data === 'object' && 'id' in part.data ? [String(part.data.id)] : []) : body.attachmentIds;
    const chatAttachments = await resolveChatAttachments(owner,id,body.message.id,attachmentIds);
    if (body.message.role !== 'user') throw new ApiError(400, 'Envie uma mensagem.');
    const text = (original ?? body.message).parts.flatMap(part => part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('\n').trim();
    if (!text || text.length > 20000) throw new ApiError(400, 'Escreva uma mensagem de até 20 mil caracteres.');
    const context = { ...workspaceContext(workspace), invocation: 'agent' as const };
    let requestedScope;
    try { requestedScope = requestedMessageScope(stored.messages, body.message.id, body.trigger, body); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Confira o contexto do pedido.'); }
    const scope = await authorizeMessageScope(context, requestedScope);
    const config = await planTaskModel('agent.chat');
    if (config.status !== 'ready') throw new ApiError(503, 'O Lume está indisponível no momento. Peça ao administrador para conferir a configuração de IA.');
    // Checked before the message is stored, so a refused turn leaves no unanswered message behind.
    await assertCredits(owner.officeId, owner.userId);

    const lease = await withTransaction(tx => admitTurn(tx, owner, id));
    try {
      if (chatAttachments.some(item=>item.media_type.startsWith('image/')) && !modelModalities(config.provider,config.modelId).image) throw new ApiError(400,'O modelo configurado não lê imagens. Peça ao administrador para usar um modelo com visão.');
      await claimChatAttachments(owner,id,body.message.id,chatAttachments);
      // Audio the conversation cannot hear becomes text before anything is stored, so the history,
      // the model and the person all see the same words.
      let unsupportedAudio = false;
      const spoken = (await Promise.all((original ? [] : body.attachments).filter(item => item.mediaType.startsWith('audio/')).map(item =>
          transcribeVoiceNote(owner, { mediaType: item.mediaType, bytes: Buffer.from(item.data, 'base64') }, request.signal).catch(error => {
            if (chatHearsAudio(config.provider, config.modelId) && error instanceof TranscriptionError && (error.reason === 'unsupported' || error.reason === 'unavailable')) { unsupportedAudio = true; return ''; }
            if (error instanceof TranscriptionError && error.reason === 'unsupported') throw new ApiError(400, 'O Lume não aceita áudio nesta configuração.');
            // A configuration problem: retrying cannot help and it is not an operational failure.
            if (error instanceof TranscriptionError && error.reason === 'unavailable') throw new ApiError(503, 'A transcrição está indisponível no momento. Escreva a mensagem ou tente mais tarde.');
            if (error instanceof ApiError) throw error;
            captureOperationalError(error, 'chat.audio.transcription');
            throw new ApiError(502, 'Não foi possível transcrever o áudio. Tente de novo ou escreva a mensagem.');
          })))).filter(Boolean);
      if (!original) for (const item of body.attachments.filter(item => item.mediaType.startsWith('image/'))) {
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[item.mediaType];
        if (!extension) throw new ApiError(400, 'Formato de imagem não suportado.');
        const attachment = await createChatAttachment(owner, id, new File([Buffer.from(item.data, 'base64')], `Imagem.${extension}`, { type: item.mediaType }));
        chatAttachments.push(...await resolveChatAttachments(owner, id, body.message.id, [attachment.id]));
      }
      await claimChatAttachments(owner, id, body.message.id, chatAttachments);
      const normalizedText = [text, ...spoken.map(item => `[Áudio] ${item}`)].join('\n\n');
      const priorSubmission = original?.metadata && typeof original.metadata === 'object' && 'submissionId' in original.metadata ? String(original.metadata.submissionId) : undefined;
      const submissionId = original && !priorSubmission ? undefined : await recordPersonRequest(context, id, body.message.id, normalizedText, scope, chatAttachments, { unsupportedAudio, continuationId: body.sharedProposalId });
      const priorGeneration = original?.metadata && typeof original.metadata === 'object' && 'generationId' in original.metadata ? String(original.metadata.generationId) : undefined;
      const generationId = body.trigger === 'regenerate-message' ? lease.token : priorGeneration ?? body.message.id;
      const input: UIMessage = { id: body.message.id, role: 'user', metadata: { lumeScope: scope, submissionId, generationId }, parts: [{ type: 'text', text: [text, ...spoken.map(item => `[Áudio] ${item}`)].join('\n\n') },...chatAttachments.map(item=>attachmentPart(publicChatAttachment(item)))] };
      const current = await conversation(database, owner, id);
      if (!current || !await writeTurnHistory(owner, id, lease, mergeHistory(current.messages, input))) throw new TurnFenced();
      await startChatRun({
        workspace: { userId: context.userId, officeId: context.officeId, sessionId: context.sessionId },
        conversationId: id,
        lease,
        request: { documentIds: scope.documentIds, caseId: scope.caseId, researchReferenceIds: scope.researchReferenceIds,
          canvas: body.canvas, canvasHref: scope.canvasHref, document: scope.document, selection: scope.selection,
          attachments: original ? [] : body.attachments.filter(item => !item.mediaType.startsWith('image/')), timeZone: body.timeZone },
      });
    } catch (error) {
      await releaseTurn(owner, id, lease);
      throw error;
    }
    const stream = await followChatRun(id);
    if (!stream) throw new ApiError(502, 'Não foi possível acompanhar a resposta. Reabra a conversa.');
    return chatRunResponse(stream);
  } catch (e) { return apiError(e); }
}
