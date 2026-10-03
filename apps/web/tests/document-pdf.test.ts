import assert from 'node:assert/strict';
import test from 'node:test';
import { exportDocument } from '../src/lib/document-export';
import { exportPdf } from '../src/lib/document-pdf';
import { DocumentPdfError, MAX_DOCX_BYTES } from '../src/lib/document-pdf-contract';

test('PDF export rejects excessive input and reports an unavailable converter', async () => {
  await assert.rejects(exportPdf(new Uint8Array(MAX_DOCX_BYTES + 1)), error => error instanceof DocumentPdfError && error.status === 413);
  const previous = process.env.LIBREOFFICE_PATH;
  process.env.LIBREOFFICE_PATH = 'missing-lume-converter';
  try { await assert.rejects(exportPdf(await exportDocument('Contrato')), error => error instanceof DocumentPdfError && error.status === 503); }
  finally { if (previous === undefined) delete process.env.LIBREOFFICE_PATH; else process.env.LIBREOFFICE_PATH = previous; }
});
