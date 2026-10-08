import { imageMatchesType } from './image-signature';

/** A declared MIME type or extension is not proof of a binary file's format. */
export function uploadMatchesType(header: Buffer, mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return imageMatchesType(header, mimeType);
  if (mimeType === 'application/pdf') return header.toString('latin1').includes('%PDF-');
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  // EML, CSV and TXT have no binary signature. Their content is parsed or displayed as text.
  return ['message/rfc822', 'text/csv', 'text/plain'].includes(mimeType);
}
