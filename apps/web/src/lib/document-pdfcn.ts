import { DocumentPdfError } from './document-pdf-contract';

export const MAX_PDFCN_CONTENT = 500_000;
export async function exportPdfcn(input: { title: string; content: string }) {
  if (input.content.length > MAX_PDFCN_CONTENT || input.title.length > 500) throw new DocumentPdfError(413, 'O documento excede o limite de exportação PDF.');
  try {
    if (process.env.K5_RUNTIME === 'cloudflare') {
      const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
      const binding = env.PROCESSORS;
      if (!binding || typeof binding !== 'object' || !('getByName' in binding) || typeof binding.getByName !== 'function') throw new Error('Processador indisponível.');
      const processor: unknown = binding.getByName('documents');
      if (!processor || typeof processor !== 'object' || !('renderPdfcn' in processor) || typeof processor.renderPdfcn !== 'function') throw new Error('Geração PDF indisponível.');
      const bytes: unknown = await processor.renderPdfcn(input);
      if (!(bytes instanceof Uint8Array)) throw new Error('PDF inválido.');
      return bytes;
    }
    const { renderPdfcnDocument } = await import('./document-pdfcn-node');
    return await renderPdfcnDocument(input);
  } catch { throw new DocumentPdfError(503, 'Não foi possível gerar o PDF. Tente novamente ou exporte o DOCX.'); }
}
