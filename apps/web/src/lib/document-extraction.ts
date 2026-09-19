import "server-only";

import { database } from "@/lib/database";

export type ExtractedSection = { reference: string; content: string };

const decoder = new TextDecoder("utf-8", { fatal: false });

export async function extractDocumentSections(data: Buffer, mimeType: string, name: string, documentId: string): Promise<ExtractedSection[]> {
  switch (mimeType) {
    case "application/pdf": return extractPdf(data, documentId);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return extractDocx(data);
    case "message/rfc822": return extractEmail(data);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return extractXlsx(data);
    case "text/csv": return extractDelimited(decoder.decode(data), "linha");
    case "text/plain": return extractText(decoder.decode(data));
    case "image/png": case "image/jpeg": case "image/webp": return extractImage(data, name);
    default: throw new Error(`O formato de ${name} não é compatível.`);
  }
}

async function extractPdf(data: Buffer, documentId: string): Promise<ExtractedSection[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
    getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<{ numPages: number; getPage: (number: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }> }> };
  };
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), disableWorker: true }).promise;
  const sections: ExtractedSection[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const text = (await page.getTextContent()).items.map((item) => item.str ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (text) sections.push({ reference: `página:${pageNumber}`, content: text });
  }
  if (sections.length) return sections;
  return extractPdfOcr(data, documentId, pdf);
}

async function extractPdfOcr(data: Buffer, documentId: string, pdf?: { numPages: number; getPage: (number: number) => Promise<unknown> }): Promise<ExtractedSection[]> {
  const endpoint = process.env.VAULT_OCR_URL;
  if (!endpoint) return extractPdfLocally(data, documentId, pdf);
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

async function extractPdfLocally(data: Buffer, documentId: string, existingPdf?: { numPages: number; getPage: (number: number) => Promise<unknown> }): Promise<ExtractedSection[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
    getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<{ numPages: number; getPage: (number: number) => Promise<unknown> }> };
  };
  const pdf = existingPdf ?? await pdfjs.getDocument({ data: new Uint8Array(data), disableWorker: true }).promise;
  const { createCanvas } = await import("@napi-rs/canvas") as unknown as { createCanvas: (width: number, height: number) => { getContext: (contextId: "2d") => unknown; toBuffer: (format: "image/png") => Buffer } };
  const { createWorker } = await import("tesseract.js") as unknown as { createWorker: (languages?: string | string[], oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }> };
  const completed = new Map((database.prepare("SELECT stable_reference AS reference, content FROM vault_document_checkpoint WHERE document_id = ? AND kind = 'ocr'").all(documentId) as Array<{ reference: string; content: string }>).map((row) => [row.reference, row.content]));
  const sections: ExtractedSection[] = [];
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const reference = `página:${pageNumber}`;
      const saved = completed.get(reference);
      if (saved) { sections.push({ reference, content: saved }); continue; }
      worker ??= await createWorker(["por", "eng"]);
      const page = await pdf.getPage(pageNumber) as { getViewport: (options: { scale: number }) => { width: number; height: number }; render: (options: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> } };
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const text = (await worker.recognize(canvas.toBuffer("image/png"))).data.text.replace(/\s+/g, " ").trim();
      if (text) {
        database.prepare("INSERT OR REPLACE INTO vault_document_checkpoint (document_id, kind, stable_reference, content) VALUES (?, 'ocr', ?, ?)").run(documentId, reference, text);
        sections.push({ reference, content: text });
      }
    }
  } finally { await worker?.terminate(); }
  if (!sections.length) throw new Error("O OCR local não encontrou texto utilizável no PDF.");
  return sections;
}

/**
 * An image is treated as a single scanned page. Recognising it here is what lets an image answer
 * a search at all — a model with vision sees the picture, but the index only holds text.
 */
async function extractImage(data: Buffer, name: string): Promise<ExtractedSection[]> {
  const { createWorker } = await import("tesseract.js") as unknown as { createWorker: (languages?: string | string[], oem?: number, options?: Record<string, unknown>) => Promise<{ recognize: (image: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }> };
  const worker = await createWorker(["por", "eng"]);
  try {
    const text = (await worker.recognize(data)).data.text.replace(/\s+/g, " ").trim();
    // An image with no legible text is still a valid document: the caption keeps it addressable,
    // and a vision model reads the picture directly.
    return [{ reference: "imagem:1", content: text || `Imagem sem texto reconhecível: ${name}.` }];
  } finally { await worker.terminate(); }
}

async function extractDocx(data: Buffer): Promise<ExtractedSection[]> {
  const mammoth = await import("mammoth") as unknown as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
  const text = (await mammoth.extractRawText({ buffer: data })).value;
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
