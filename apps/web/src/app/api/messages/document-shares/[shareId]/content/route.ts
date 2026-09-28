import { extname } from 'node:path';
import { apiError } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { readDocumentShare } from '@/lib/personal-chat/shares';
import { validateOfficeZip } from '@/lib/file-preview-validation';

export const runtime = 'nodejs';

function quotedFilename(name: string) {
  return `filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n]/g, ''))}`;
}

function starts(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function previewMime(bytes: Buffer, mimeType: string, name: string) {
  const extension = extname(name).toLowerCase();
  if (extension === '.docx') {
    validateOfficeZip(bytes, extension);
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? mimeType : null;
  }
  if (mimeType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return mimeType;
  if (mimeType === 'image/png' && starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return mimeType;
  if (mimeType === 'image/jpeg' && starts(bytes, [0xff, 0xd8, 0xff])) return mimeType;
  if (mimeType === 'image/gif' && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return mimeType;
  if (mimeType === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return mimeType;
  if (mimeType.startsWith('text/')) return 'text/plain; charset=utf-8';
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const file = await readDocumentShare(await apiPerson(request), (await params).shareId);
    const download = new URL(request.url).searchParams.get('download') === '1';
    let mime = file.mimeType;
    let inline = false;
    if (!download) {
      const safe = previewMime(file.buffer, file.mimeType, file.name);
      if (safe) {
        mime = safe;
        inline = true;
      } else {
        mime = 'application/octet-stream';
      }
    }
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; ${quotedFilename(file.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Length': String(file.buffer.byteLength),
      },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    return response;
  }
}
