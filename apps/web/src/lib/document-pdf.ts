import { DocumentPdfError, MAX_DOCX_BYTES } from './document-pdf-contract';

type PdfProcessor = { convertPdf(input: Uint8Array): Promise<Uint8Array> };
function processors(value: unknown): value is { getByName(name: string): PdfProcessor } {
  return typeof value === 'object' && value !== null && 'getByName' in value && typeof value.getByName === 'function';
}

export async function exportPdf(docx: Uint8Array): Promise<Uint8Array> {
  if (docx.byteLength > MAX_DOCX_BYTES) throw new DocumentPdfError(413, 'O documento excede o limite de exportação PDF.');
  if (process.env.K5_RUNTIME === 'cloudflare') {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    if (!processors(env.PROCESSORS)) throw new DocumentPdfError(503, 'A exportação PDF está temporariamente indisponível.');
    try { return await env.PROCESSORS.getByName('documents').convertPdf(docx); }
    catch { throw new DocumentPdfError(503, 'Não foi possível gerar o PDF. Tente novamente ou exporte o DOCX.'); }
  }
  const { convertDocxToPdf } = await import('./document-pdf-node');
  try { return await convertDocxToPdf(docx); }
  catch { throw new DocumentPdfError(503, 'Não foi possível gerar o PDF. Tente novamente ou exporte o DOCX.'); }
}
