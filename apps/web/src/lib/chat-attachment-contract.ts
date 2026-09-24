export type ChatAttachment = { id: string; name: string; mediaType: string; byteSize: number; url: string };
export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
/** Images travel to the provider as they are, and providers refuse large ones; documents are read as text. */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
/**
 * Characters of extracted text one file may bring, about 80 thousand tokens: a long manual or a
 * whole petition. Past this the Cofre, which reads by excerpts, is the right place.
 */
export const MAX_CHAT_FILE_TEXT = 300_000;
/** Characters of attachment text in one prompt, newest first; older files give way beyond it. */
export const MAX_CHAT_PROMPT_TEXT = 400_000;

export function attachmentPart(attachment: ChatAttachment) {
  return { type: 'data-attachment' as const, id: attachment.id, data: attachment };
}
