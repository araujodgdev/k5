import assert from 'node:assert/strict';
import test from 'node:test';
import { Document, Header, Footer, Paragraph, Packer } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import { exportDocument } from '../src/lib/document-export';
import { exportPdf } from '../src/lib/document-pdf';
import { DocumentPdfError, MAX_DOCX_BYTES } from '../src/lib/document-pdf-contract';

test('PDF exports the revised text, tables, letterhead and pagination from the DOCX', async () => {
  const template = await Packer.toBuffer(new Document({ sections: [{
    headers: { default: new Header({ children: [new Paragraph('ESCRITÓRIO ALFA')] }) },
    footers: { default: new Footer({ children: [new Paragraph('CONTATO DO ESCRITÓRIO')] }) },
    children: [new Paragraph('DADOS SIGILOSOS DO CASO ANTERIOR')],
  }] }));
  const body = '# Contrato de honorários\n\nCliente José, obrigação revisada: R$ 1.250,00.\n\n| Parcela | Valor |\n| --- | --- |\n| Primeira | R$ 1.250,00 |\n\n' + Array.from({ length: 100 }, (_, i) => `Cláusula ${i + 1}. Texto contratual em português, com revisão do advogado.`).join('\n\n');
  const output = await exportPdf(await exportDocument(body, template));
  const pdf = await PDFDocument.load(output);
  assert.ok(pdf.getPageCount() > 1);
  const { text } = await extractText(output, { mergePages: true });
  assert.match(text, /ESCRITÓRIO ALFA/);
  assert.match(text, /CONTATO DO ESCRITÓRIO/);
  assert.match(text, /José/);
  assert.match(text, /1\.250,00/);
  assert.match(text, /Primeira/);
  assert.match(text, /Cláusula 100/);
  assert.doesNotMatch(text, /DADOS SIGILOSOS DO CASO ANTERIOR/);
});

test('PDF export rejects excessive input and reports an unavailable converter', async () => {
  await assert.rejects(exportPdf(new Uint8Array(MAX_DOCX_BYTES + 1)), error => error instanceof DocumentPdfError && error.status === 413);
  const previous = process.env.LIBREOFFICE_PATH;
  process.env.LIBREOFFICE_PATH = 'missing-lume-converter';
  try { await assert.rejects(exportPdf(await exportDocument('Contrato')), error => error instanceof DocumentPdfError && error.status === 503); }
  finally { if (previous === undefined) delete process.env.LIBREOFFICE_PATH; else process.env.LIBREOFFICE_PATH = previous; }
});
