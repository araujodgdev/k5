import 'server-only';
import PizZip from 'pizzip';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Formats the model providers accept as image input. Word also stores EMF, WMF and TIFF; those are counted, not sent. */
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** Screenshots pasted into a guide: enough for a long one, bounded so a catalogue cannot flood the prompt. */
export const MAX_DOCX_IMAGES = 24;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type DocxImage = { mediaType: string; data: Buffer };

/**
 * The pictures of a Word document, in reading order: the order their references appear in the body,
 * each image once. `skipped` counts pictures a model cannot take (unsupported format, too large, or
 * past the cap), so the prompt can say they exist.
 */
export function docxImages(bytes: Buffer): { images: DocxImage[]; skipped: number } {
  let zip: PizZip;
  try { zip = new PizZip(bytes); } catch { return { images: [], skipped: 0 }; }
  const body = zip.file('word/document.xml')?.asText();
  const relations = zip.file('word/_rels/document.xml.rels')?.asText();
  if (!body || !relations) return { images: [], skipped: 0 };

  const targets = new Map<string, string>();
  for (const [, attributes] of relations.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(attributes)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attributes)?.[1];
    if (id && target && /\/image"/.test(attributes) && !/TargetMode="External"/.test(attributes)) targets.set(id, target);
  }

  const images: DocxImage[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const [, id] of body.matchAll(/\br:(?:embed|id)="([^"]+)"/g)) {
    const target = targets.get(id);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    // Targets are relative to word/; a leading slash is package-absolute.
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    const mediaType = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    const data = zip.file(path)?.asNodeBuffer();
    if (!mediaType || !data?.length || data.length > MAX_IMAGE_BYTES || images.length >= MAX_DOCX_IMAGES) { skipped++; continue; }
    images.push({ mediaType, data });
  }
  return { images, skipped };
}
