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
