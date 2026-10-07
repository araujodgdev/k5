import type { VaultDocument } from "@/lib/vault";

const zone = "America/Sao_Paulo";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const shortDay = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, day: "2-digit", month: "2-digit" });
const shortTime = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const sizeNumber = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Database instants arrive as ISO strings; older rows were stored as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function instant(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "dd/mm" in the office's time zone, the mono date at the end of a row. */
export function dayMonth(value: string) {
  const date = instant(value);
  return date ? shortDay.format(date) : "";
}

/** A civil date ("2026-10-09") as "09/10", without a time zone shifting the day. */
export function civilDayMonth(value: string) {
  const [, month, day] = value.split("-");
  return day && month ? `${day}/${month}` : value;
}

export function dayMonthTime(value: string) {
  const date = instant(value);
  return date ? `${shortDay.format(date)} ${shortTime.format(date)}` : "";
}

/** How long ago, in the board's words: "há 5 min", "há 2 h", "ontem", "em 12/09". */
export function ago(value: string, now = Date.now()) {
  const date = instant(value);
  if (!date) return "";
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const day = dayKey.format(date);
  if (day === dayKey.format(now)) return `há ${Math.floor(minutes / 60)} h`;
  if (day === dayKey.format(now - 86_400_000)) return "ontem";
  return `em ${shortDay.format(date)}`;
}

export function brl(cents: number) {
  return money.format(cents / 100);
}

export function fileCount(count: number) {
  return count === 1 ? "1 arquivo" : `${count} arquivos`;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${sizeNumber.format(bytes / (1024 * 1024))} MB`;
}

const kinds: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "TXT",
  "text/csv": "CSV",
  "message/rfc822": "E-mail",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

export const isImage = (document: Pick<VaultDocument, "mimeType">) => document.mimeType.startsWith("image/");

export function fileKind(document: Pick<VaultDocument, "mimeType" | "name">) {
  if (isImage(document)) return "Imagem";
  const extension = document.name.includes(".") ? document.name.split(".").pop()?.toUpperCase() : undefined;
  return kinds[document.mimeType] ?? extension ?? "Arquivo";
}

/** The file's second line: what it is and its size once ready, its processing state before that. */
export function documentMeta(document: VaultDocument) {
  if (document.status === "queued") return "Na fila";
  if (document.status === "processing") return `Processando ${document.progress}%`;
  if (document.status === "failed") return document.errorMessage ? `Falhou: ${document.errorMessage}` : "Falhou";
  return `${fileKind(document)} · ${fileSize(document.byteSize)}`;
}
