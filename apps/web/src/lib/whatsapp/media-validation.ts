import 'server-only';
import { extname } from 'node:path';
import { validateOfficeZip } from '@/lib/file-preview-validation';
import { CapabilityError } from '@/lib/capabilities/errors';

export const MAX_WHATSAPP_MEDIA_BYTES = 25_000_000;
type Format = { mime: string; kind: 'image' | 'video' | 'audio' | 'file'; max: number };
const image = (mime: string): Format => ({ mime, kind: 'image', max: 5_000_000 });
const audio = (mime: string): Format => ({ mime, kind: 'audio', max: 16_000_000 });
const document = (mime: string): Format => ({ mime, kind: 'file', max: MAX_WHATSAPP_MEDIA_BYTES });
const formats: Record<string, Format> = {
  '.jpg': image('image/jpeg'), '.jpeg': image('image/jpeg'), '.png': image('image/png'),
  '.mp4': { mime: 'video/mp4', kind: 'video', max: 16_000_000 },
  '.mp3': audio('audio/mpeg'), '.ogg': audio('audio/ogg'), '.amr': audio('audio/amr'), '.aac': audio('audio/aac'),
  '.pdf': document('application/pdf'), '.txt': document('text/plain'), '.doc': document('application/msword'),
  '.xls': document('application/vnd.ms-excel'), '.ppt': document('application/vnd.ms-powerpoint'),
  '.docx': document('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  '.xlsx': document('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  '.pptx': document('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
};
const invalid = () => new CapabilityError('INVALID', 'O conteúdo do arquivo não corresponde a um formato permitido para WhatsApp.');

export function whatsappFileName(name: string | null, mime?: string | null) {
  const fallback = Object.entries(formats).find(([, value]) => value.mime === mime)?.[0];
  const filename = (name ?? `arquivo${fallback ?? ''}`).split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().slice(0, 180) ?? '';
  const extension = extname(filename).toLowerCase();
  const format = formats[extension];
  if (!filename || filename === extension || !format) throw invalid();
  return { filename, extension, ...format };
}

export function validateWhatsAppFile(bytes: Buffer, name: string | null, declaredMime?: string | null) {
  const file = whatsappFileName(name, declaredMime?.split(';')[0]?.trim().toLowerCase());
  if (!bytes.length || bytes.length > file.max) throw new CapabilityError('INVALID', `O limite deste formato é ${file.max / 1_000_000} MB.`);
  const supplied = declaredMime?.split(';')[0]?.trim().toLowerCase();
  if (supplied && supplied !== 'application/octet-stream' && supplied !== file.mime
    && !(file.mime === 'image/jpeg' && supplied === 'image/jpg') && !(file.mime === 'audio/mpeg' && supplied === 'audio/mp3')) throw invalid();
  const ascii = (start: number, length: number) => bytes.subarray(start, start + length).toString('ascii');
  let matches = false;
  switch (file.extension) {
    case '.jpg': case '.jpeg': matches = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; break;
    case '.png': matches = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); break;
    case '.pdf': matches = ascii(0, 5) === '%PDF-'; break;
    case '.mp4': matches = ascii(4, 4) === 'ftyp' && bytes.length > 16; break;
    case '.mp3': matches = ascii(0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0; break;
    case '.aac': matches = bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0; break;
    case '.amr': matches = ascii(0, 6) === '#!AMR\n' || ascii(0, 9) === '#!AMR-WB\n'; break;
    case '.ogg': matches = ascii(0, 4) === 'OggS' && bytes.subarray(0, 512).includes(Buffer.from('OpusHead')); break;
    case '.doc': case '.xls': case '.ppt': matches = bytes.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])); break;
    case '.txt': {
      try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); matches = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text); }
      catch { matches = false; }
      break;
    }
    case '.docx': case '.xlsx': case '.pptx':
      try { validateOfficeZip(bytes, file.extension); matches = true; } catch { matches = false; }
      break;
  }
  if (!matches) throw invalid();
  return file;
}

export async function readWhatsAppBytes(body: ReadableStream<Uint8Array> | null, limit = MAX_WHATSAPP_MEDIA_BYTES) {
  if (!body) throw invalid();
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > limit) { void reader.cancel().catch(() => undefined); throw new CapabilityError('INVALID', 'O arquivo excede o tamanho permitido.'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
