import { MAX_UPLOAD_BYTES } from '@/lib/application/uploads-service';

/**
 * Which Drive files can become a Cofre copy, and how. Google-native files are exported (Docs as
 * DOCX, Sheets as XLSX, Slides as PDF); everything else is downloaded as-is only when the Cofre
 * already accepts that format (see ALLOWED_EXTENSIONS in uploads-service.ts).
 */
export const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const GOOGLE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Same ceiling as a manual upload to the Cofre. */
export const MAX_IMPORT_BYTES = MAX_UPLOAD_BYTES;
/**
 * Google's files.export endpoint refuses content above 10 MB (403 exportSizeLimitExceeded).
 * The size of a native file is unknown before exporting, so the refusal is turned into a clear
 * message instead of being checked in advance.
 */
export const GOOGLE_EXPORT_LIMIT_BYTES = 10 * 1024 * 1024;

export type ImportFormat = { label: string; extension: string; mimeType: string; exportMimeType: string | null };

const exported: Record<string, ImportFormat> = {
  [GOOGLE_DOC_MIME]: { label: 'DOCX', extension: '.docx', mimeType: DOCX, exportMimeType: DOCX },
  'application/vnd.google-apps.spreadsheet': { label: 'XLSX', extension: '.xlsx', mimeType: XLSX, exportMimeType: XLSX },
  'application/vnd.google-apps.presentation': { label: 'PDF', extension: '.pdf', mimeType: 'application/pdf', exportMimeType: 'application/pdf' },
};
const binary: Record<string, ImportFormat> = {
  'application/pdf': { label: 'PDF', extension: '.pdf', mimeType: 'application/pdf', exportMimeType: null },
  [DOCX]: { label: 'DOCX', extension: '.docx', mimeType: DOCX, exportMimeType: null },
  [XLSX]: { label: 'XLSX', extension: '.xlsx', mimeType: XLSX, exportMimeType: null },
  'text/csv': { label: 'CSV', extension: '.csv', mimeType: 'text/csv', exportMimeType: null },
  'text/plain': { label: 'TXT', extension: '.txt', mimeType: 'text/plain', exportMimeType: null },
  'message/rfc822': { label: 'EML', extension: '.eml', mimeType: 'message/rfc822', exportMimeType: null },
  'image/png': { label: 'PNG', extension: '.png', mimeType: 'image/png', exportMimeType: null },
  'image/jpeg': { label: 'JPG', extension: '.jpg', mimeType: 'image/jpeg', exportMimeType: null },
  'image/webp': { label: 'WEBP', extension: '.webp', mimeType: 'image/webp', exportMimeType: null },
};

export function importFormatFor(mimeType: string): ImportFormat | null {
  return exported[mimeType] ?? binary[mimeType] ?? null;
}

export const isGoogleNative = (mimeType: string) => mimeType.startsWith(GOOGLE_NATIVE_PREFIX);

export function fileKind(mimeType: string): 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'other' {
  if (mimeType === GOOGLE_DOC_MIME || mimeType === DOCX || mimeType === 'application/msword') return 'document';
  if (mimeType === 'application/vnd.google-apps.spreadsheet' || mimeType === XLSX || mimeType === 'text/csv') return 'spreadsheet';
  if (mimeType === 'application/vnd.google-apps.presentation' || mimeType === PPTX) return 'presentation';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

/** Name of the Cofre copy: the Drive name with the extension of the imported format. */
export function importFileName(sourceName: string, format: ImportFormat) {
  const base = sourceName.trim() || 'arquivo';
  const lower = base.toLowerCase();
  const hasExtension = lower.endsWith(format.extension) || (format.extension === '.jpg' && lower.endsWith('.jpeg'));
  const name = hasExtension ? base : `${base}${format.extension}`;
  // vault_document.original_name holds at most 255 characters; keep the extension when cutting.
  if (name.length <= 255) return name;
  const extension = hasExtension ? name.slice(name.lastIndexOf('.')) : format.extension;
  return `${name.slice(0, 255 - extension.length)}${extension}`;
}
