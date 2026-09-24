import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function createOcrWorker() {
  const { createWorker } = await import('tesseract.js');
  const bundled = process.env.TESSERACT_CACHE_PATH;
  const cachePath = bundled ?? resolve(process.cwd(), '.data', 'tesseract');
  if (!bundled) await mkdir(cachePath, { recursive: true });
  return createWorker(['por', 'eng'], undefined, {
    cachePath,
    ...(bundled ? { cacheMethod: 'readOnly' as const } : {}),
  });
}

/**
 * Pixel budget for one page sent to OCR: an A4 sheet at about 300 DPI. Phone scanners write pages
 * several times larger than A4, and rendering them at full size only slows recognition down.
 */
export const MAX_OCR_PIXELS = 9_000_000;

/** The render scale for OCR: 1.5x for ordinary pages, reduced to fit the budget for oversized ones. */
export function ocrViewport<V extends { width: number; height: number }>(page: { getViewport(options: { scale: number }): V }): V {
  const base = page.getViewport({ scale: 1 });
  const area = base.width * base.height;
  return page.getViewport({ scale: area > 0 ? Math.min(1.5, Math.sqrt(MAX_OCR_PIXELS / area)) : 1.5 });
}
