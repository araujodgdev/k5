import "server-only";

import { database } from "@/lib/database";
import { docxImages } from "@/lib/docx-images";

export type ExtractedSection = { reference: string; content: string };

/** A PDF without a text layer where no OCR is available: a known limitation, not a failure. */
export class OcrRequiredError extends Error {
  constructor() {
    super('Este PDF precisa de OCR. Adicione-o ao Cofre para processar e depois selecione-o em Fontes.');
    this.name = 'OcrRequiredError';
  }
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * `ocrImages` reads the pictures inside a Word file by OCR. The Cofre asks for it, because its
 * index only holds text; the chat does not, because it sends the pictures to the model itself.
 */
export async function extractDocumentSections(data: Buffer, mimeType: string, name: string, documentId: string, options: { ocrImages?: boolean } = {}): Promise<ExtractedSection[]> {
  switch (mimeType) {
    case "application/pdf": return extractPdf(data, documentId);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return extractDocx(data, documentId, options.ocrImages === true);
    case "message/rfc822": return extractEmail(data);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return extractXlsx(data);
    case "text/csv": return extractDelimited(decoder.decode(data), "linha");
    case "text/plain": return extractText(decoder.decode(data));
    case "image/png": case "image/jpeg": case "image/webp": return extractImage(data, name);
    default: throw new Error(`O formato de ${name} não é compatível.`);
  }
}

/**
 * Workers use unpdf for text-only attachments. Node processors use one PDF.js version for
 * both text and scanned pages; mixing unpdf's worker with pdfjs-dist breaks native OCR.
 */
async function extractPdf(data: Buffer, documentId: string): Promise<ExtractedSection[]> {
  // unpdf bundles a different PDF.js worker. Loading it in the OCR process poisons PDF.js's
  // shared fake-worker global and makes rendering fail with an API/worker version mismatch.
  if (process.env.K5_RUNTIME !== 'cloudflare') return extractPdfLocally(data, documentId);
  const { extractText: extractPdfText } = await import("unpdf");
  // A fresh copy per call: PDF.js takes ownership of the buffer it is handed, and the OCR
  // fallback below still needs the original bytes.
  const { text } = await extractPdfText(new Uint8Array(data), { mergePages: false });
  const sections: ExtractedSection[] = [];
  for (let pageNumber = 1; pageNumber <= text.length; pageNumber++) {
    const content = text[pageNumber - 1].replace(/\s+/g, " ").trim();
    if (content) sections.push({ reference: `página:${pageNumber}`, content });
  }
  if (sections.length) return sections;
  if (process.env.VAULT_OCR_URL) return extractPdfOcr(data, documentId);
  throw new OcrRequiredError();
}

async function extractPdfOcr(data: Buffer, documentId: string): Promise<ExtractedSection[]> {
  const endpoint = process.env.VAULT_OCR_URL;
  if (!endpoint) return extractPdfLocally(data, documentId);
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("VAULT_OCR_URL não é uma URL válida."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("VAULT_OCR_URL deve usar HTTP ou HTTPS.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const headers: Record<string, string> = { "content-type": "application/pdf", "x-k5-document-id": documentId };
    if (process.env.VAULT_OCR_TOKEN) headers.authorization = `Bearer ${process.env.VAULT_OCR_TOKEN}`;
    const response = await fetch(url, { method: "POST", headers, body: new Uint8Array(data), signal: controller.signal });
    if (!response.ok) throw new Error(`O serviço de OCR respondeu com erro (${response.status}).`);
    const payload = await response.json() as { pages?: Array<{ page?: unknown; text?: unknown }> };
    const sections = (payload.pages ?? []).flatMap((page, index) => {
      const text = typeof page.text === "string" ? page.text.trim() : "";
      const number = typeof page.page === "number" && Number.isInteger(page.page) && page.page > 0 ? page.page : index + 1;
      return text ? [{ reference: `página:${number}`, content: text }] : [];
    });
    if (!sections.length) throw new Error("O OCR não devolveu texto utilizável.");
    return sections;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("O serviço de OCR excedeu o tempo limite.");
    throw error;
  } finally { clearTimeout(timer); }
}

async function extractPdfLocally(data: Buffer, documentId: string): Promise<ExtractedSection[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const { createOcrWorker } = await import('./ocr-worker');
  const sections: ExtractedSection[] = [];
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined;
  try {
    const pdf = await task.promise;
    const { createCanvas } = await import("@napi-rs/canvas");
    const completed = new Map((await database.prepare("SELECT stable_reference AS reference, content FROM vault_document_checkpoint WHERE document_id = ? AND kind = 'ocr'").all(documentId) as Array<{ reference: string; content: string }>).map((row) => [row.reference, row.content]));
    if (pdf.numPages > 300) throw new Error('PDF acima do limite de 300 páginas.');
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const reference = `página:${pageNumber}`;
      const saved = completed.get(reference);
      if (saved) { sections.push({ reference, content: saved }); continue; }
      const page = await pdf.getPage(pageNumber);
      const layer = await page.getTextContent();
      const plain = layer.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
      if (plain) { sections.push({ reference, content: plain }); page.cleanup(); continue; }
      worker ??= await createOcrWorker();
      const viewport = page.getViewport({ scale: 1.5 });
      if (viewport.width * viewport.height > 16_000_000) throw new Error('Página acima do limite de renderização OCR.');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport } as never).promise;
      const text = (await worker.recognize(canvas.toBuffer("image/png"))).data.text.replace(/\s+/g, " ").trim();
      page.cleanup();
      if (text) {
        await database.prepare("INSERT INTO vault_document_checkpoint (document_id, kind, stable_reference, content) VALUES (?, 'ocr', ?, ?) ON CONFLICT(document_id,kind,stable_reference) DO UPDATE SET content=excluded.content").run(documentId, reference, text);
        sections.push({ reference, content: text });
      }
    }
  } finally { await worker?.terminate(); await task.destroy(); }
  if (!sections.length) throw new Error("O OCR local não encontrou texto utilizável no PDF.");
  return sections;
}

/**
 * An image is treated as a single scanned page. Recognising it here is what lets an image answer
 * a search at all — a model with vision sees the picture, but the index only holds text.
 */
async function extractImage(data: Buffer, name: string): Promise<ExtractedSection[]> {
  const { createOcrWorker } = await import('./ocr-worker');
  const worker = await createOcrWorker();
  try {
    const text = (await worker.recognize(data)).data.text.replace(/\s+/g, " ").trim();
    // An image with no legible text is still a valid document: the caption keeps it addressable,
    // and a vision model reads the picture directly.
    return [{ reference: "imagem:1", content: text || `Imagem sem texto reconhecível: ${name}.` }];
  } finally { await worker.terminate(); }
}

async function extractDocx(data: Buffer, documentId: string, ocrImages: boolean): Promise<ExtractedSection[]> {
  const mammoth = await import("mammoth") as unknown as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
  const text = (await mammoth.extractRawText({ buffer: data })).value;
  const sections = paragraphSections(text);
  // Workers have no local OCR; there the pictures stay unread, as before.
  if (!ocrImages || process.env.K5_RUNTIME === 'cloudflare') return sections;
  return [...sections, ...await recognizeDocxImages(data, documentId)];
}

/**
 * Screenshots pasted into a Word guide carry the words people search for. Each picture becomes an
 * `imagem:N` section after the text, and its result is checkpointed like a scanned PDF page, so a
 * retried or reindexed document is not recognised twice.
 */
async function recognizeDocxImages(data: Buffer, documentId: string): Promise<ExtractedSection[]> {
  const { images } = docxImages(data);
  if (!images.length) return [];
  const completed = new Map((await database.prepare("SELECT stable_reference AS reference, content FROM vault_document_checkpoint WHERE document_id = ? AND kind = 'ocr'").all(documentId) as Array<{ reference: string; content: string }>).map((row) => [row.reference, row.content]));
  const { createOcrWorker } = await import('./ocr-worker');
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined;
  const sections: ExtractedSection[] = [];
  try {
    for (const [index, image] of images.entries()) {
      const reference = `imagem:${index + 1}`;
      const saved = completed.get(reference);
      if (saved) { sections.push({ reference, content: saved }); continue; }
      worker ??= await createOcrWorker();
      // A picture the engine cannot decode (an odd GIF, a damaged file) is skipped, not fatal:
      // the rest of the document is still worth indexing.
      const recognized = await worker.recognize(image.data).then((result) => result.data.text, () => "");
      const content = recognized.replace(/\s+/g, " ").trim();
      if (!content) continue;
      await database.prepare("INSERT INTO vault_document_checkpoint (document_id, kind, stable_reference, content) VALUES (?, 'ocr', ?, ?) ON CONFLICT(document_id,kind,stable_reference) DO UPDATE SET content=excluded.content").run(documentId, reference, content);
      sections.push({ reference, content });
    }
  } finally { await worker?.terminate(); }
  return sections;
}

function paragraphSections(text: string): ExtractedSection[] {
  return text.split(/\r?\n\s*\r?\n|\r?\n/).map((content, index) => ({ reference: `parágrafo:${index + 1}`, content: content.trim() })).filter((section) => section.content);
}

async function extractEmail(data: Buffer): Promise<ExtractedSection[]> {
  const { simpleParser } = await import("mailparser") as unknown as { simpleParser: (source: Buffer) => Promise<{ text?: string; html?: string; subject?: string; from?: { text?: string }; to?: { text?: string }; date?: Date }> };
  const mail = await simpleParser(data);
  const metadata = [mail.subject && `Assunto: ${mail.subject}`, mail.from?.text && `De: ${mail.from.text}`, mail.to?.text && `Para: ${mail.to.text}`, mail.date && `Data: ${mail.date.toISOString()}`].filter(Boolean).join("\n");
  const body = (mail.text ?? mail.html?.replace(/<[^>]+>/g, " ") ?? "").replace(/\s+/g, " ").trim();
  if (!metadata && !body) throw new Error("O e-mail não contém texto extraível.");
  return [{ reference: "mensagem:1", content: [metadata, body].filter(Boolean).join("\n\n") }];
}

async function extractXlsx(data: Buffer): Promise<ExtractedSection[]> {
  const ExcelJS = await import("exceljs") as unknown as { Workbook: new () => { xlsx: { load: (data: Buffer) => Promise<void> }; worksheets: Array<{ name: string; eachRow: (options: { includeEmpty: boolean }, callback: (row: { eachCell: (options: { includeEmpty: boolean }, callback: (cell: { value: unknown; text: string; address: string }) => void) => void }, rowNumber: number) => void) => void }> } };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sections: ExtractedSection[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[] = [];
    let firstAddress = "A1";
    let lastAddress = "A1";
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Formula cells are never evaluated or treated as instructions. Cached results are ignored too.
        if (typeof cell.value === "object" && cell.value !== null && "formula" in cell.value) return;
        if (!cells.length && !rows.length) firstAddress = cell.address;
        lastAddress = cell.address;
        const value = cell.text.replace(/\s+/g, " ").trim();
        if (value) cells.push(`${cell.address}: ${value}`);
      });
      if (cells.length) rows.push(cells.join(" | "));
    });
    if (rows.length) sections.push({ reference: `aba:${sheet.name}!${firstAddress}:${lastAddress}`, content: rows.join("\n") });
  }
  if (!sections.length) throw new Error("A planilha não contém células de texto ou valor extraíveis.");
  return sections;
}

function extractDelimited(text: string, referencePrefix: string) {
  return text.split(/\r?\n/).map((content, index) => ({ reference: `${referencePrefix}:${index + 1}`, content: content.trim() })).filter((section) => section.content);
}

function extractText(text: string) {
  return text.split(/\r?\n\s*\r?\n/).map((content, index) => ({ reference: `parágrafo:${index + 1}`, content: content.trim() })).filter((section) => section.content);
}
