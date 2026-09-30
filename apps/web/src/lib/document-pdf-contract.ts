export const MAX_DOCX_BYTES = 16_000_000;
export class DocumentPdfError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
