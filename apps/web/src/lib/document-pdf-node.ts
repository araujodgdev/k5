import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { DocumentPdfError, MAX_DOCX_BYTES } from './document-pdf-contract';

const execute = promisify(execFile);
let active = 0;

export async function convertDocxToPdf(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength > MAX_DOCX_BYTES) throw new DocumentPdfError(413, 'O documento excede o limite de exportação PDF.');
  if (active >= 2) throw new DocumentPdfError(503, 'Há outras exportações em andamento. Tente novamente em instantes.');
  active++;
  let directory: string | undefined;
  try {
    const zip = new PizZip(input);
    if (!zip.file('word/document.xml')) throw new DocumentPdfError(400, 'Documento Word inválido.');
    // Conversion must never resolve remote template relationships or execute embedded macros.
    for (const name of Object.keys(zip.files)) {
      if (/vbaProject|embeddings\//i.test(name)) zip.remove(name);
      else if (name.endsWith('.rels')) {
        const xml = zip.file(name)?.asText();
        if (xml) zip.file(name, xml.replace(/<Relationship\b[^>]*(?:TargetMode="External"|Type="[^"]*(?:vbaProject|oleObject)[^"]*")[^>]*\/?>(?:[\s\S]*?<\/Relationship>)?/g, ''));
      }
    }
    directory = await mkdtemp(join(tmpdir(), 'lume-pdf-'));
    const file = join(directory, 'document.docx');
    await writeFile(file, zip.generate({ type: 'nodebuffer' }), { mode: 0o600 });
    const executable = process.env.LIBREOFFICE_PATH || (process.platform === 'win32' ? 'C:/Program Files/LibreOffice/program/soffice.exe' : 'soffice');
    await execute(executable, [
      `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
      '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', directory, file,
    ], { timeout: 90_000, maxBuffer: 64_000, windowsHide: true });
    const pdf = await readFile(join(directory, 'document.pdf'));
    if (pdf.byteLength > 40_000_000 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid conversion output');
    const parsed = await PDFDocument.load(pdf);
    if (!parsed.getPageCount()) throw new Error('Empty conversion output');
    return new Uint8Array(pdf);
  } catch (error) {
    if (error instanceof DocumentPdfError) throw error;
    throw new DocumentPdfError(503, 'Não foi possível gerar o PDF. Tente novamente ou exporte o DOCX.');
  } finally {
    active--;
    if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('lume-pdf-')) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
