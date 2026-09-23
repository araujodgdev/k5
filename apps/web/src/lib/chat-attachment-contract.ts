export type ChatAttachment = { id: string; name: string; mediaType: string; byteSize: number; url: string };
export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

export function attachmentPart(attachment: ChatAttachment) {
  return { type: 'data-attachment' as const, id: attachment.id, data: attachment };
}
