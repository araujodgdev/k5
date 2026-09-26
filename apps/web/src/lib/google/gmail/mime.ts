import { createHash } from 'node:crypto';
import { CapabilityError } from '@/lib/capabilities/errors';

export type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId?: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: GmailPart };
export type MailFile = { filename: string; mimeType: string; data: Buffer; digest: string; partId?: string };
export type Compose = { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string;
  messageId: string; replyHeader?: string; references?: string; threadId?: string; files: MailFile[]; allowNoRecipients?: boolean };

const clean = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();
export function safeHeader(value: string, max = 998) {
  if (value.length > max || /[\r\n\x00-\x1f\x7f]/.test(value)) throw new CapabilityError('INVALID', 'O texto contém caracteres inválidos para um cabeçalho de e-mail.');
  return value.trim();
}
export function safeAddress(value: string) {
  const address = safeHeader(value, 254);
  if (!/^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/.test(address)) throw new CapabilityError('INVALID', 'Endereço de e-mail inválido.');
  return address;
}
export function safeMessageId(value: string) {
  const id = safeHeader(value, 255);
  if (!/^<[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+>$/.test(id)) throw new CapabilityError('INVALID', 'A mensagem original não tem um identificador seguro para resposta.');
  return id;
}
function supportedCharset(value: string): string | null {
  const normalized = value.toLowerCase();
  const label = normalized === 'utf8' ? 'utf-8' : normalized === 'latin1' ? 'iso-8859-1' : normalized;
  return ['utf-8', 'iso-8859-1', 'windows-1252'].includes(label) ? label : null;
}
/** Gmail metadata can retain RFC 2047 encoded words. Decode only known charsets, preserving malformed words verbatim. */
export function decodeHeaderWords(value: string): string {
  const word = /=\?([^?\s]{1,40})\?([bBqQ])\?([^?]*)\?=/g;
  const decode = (charset: string, encoding: string, encodedText: string): string | null => {
    const label = supportedCharset(charset);
    if (!label) return null;
    let bytes: Buffer;
    if (encoding.toLowerCase() === 'b') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encodedText) || encodedText.length % 4 === 1) return null;
      bytes = Buffer.from(encodedText, 'base64');
    } else {
      const octets: number[] = [];
      for (let index = 0; index < encodedText.length; index++) {
        const character = encodedText[index];
        if (character === '_') octets.push(32);
        else if (character === '=') {
          const pair = encodedText.slice(index + 1, index + 3);
          if (!/^[0-9a-fA-F]{2}$/.test(pair)) return null;
          octets.push(Number.parseInt(pair, 16)); index += 2;
        } else if (character.charCodeAt(0) <= 127) octets.push(character.charCodeAt(0));
        else return null;
      }
      bytes = Buffer.from(octets);
    }
    try { return new TextDecoder(label, { fatal: true }).decode(bytes); }
    catch { return null; }
  };
  let result = '', cursor = 0, previousDecoded = false;
  for (const match of value.matchAll(word)) {
    const between = value.slice(cursor, match.index);
    const decoded = decode(match[1], match[2], match[3]);
    if (!(previousDecoded && decoded !== null && /^[ \t\r\n]+$/.test(between))) result += between;
    result += decoded ?? match[0];
    previousDecoded = decoded !== null;
    cursor = match.index + match[0].length;
  }
  return result + value.slice(cursor);
}
export const gmailHeader = (part: GmailPart | undefined, name: string) =>
  decodeHeaderWords(part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '');
export const walkParts = (part: GmailPart | undefined): GmailPart[] => part ? [part, ...(part.parts ?? []).flatMap(walkParts)] : [];
export function decodeBase64Url(value: string, max = 26_000_000): Buffer {
  if (value.length > Math.ceil(max * 4 / 3) + 8 || !/^[A-Za-z0-9_\-]*={0,2}$/.test(value)) throw new CapabilityError('INVALID', 'Conteúdo de e-mail inválido ou muito grande.');
  const data = Buffer.from(value, 'base64url');
  if (data.length > max) throw new CapabilityError('INVALID', 'O conteúdo excede o limite permitido.');
  return data;
}
function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    const e = entity.toLowerCase();
    if (e.startsWith('#')) { const code = Number.parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[e] ?? '';
  });
}
/** HTML never reaches the caller. This conservative text conversion removes active and hidden content. */
export function htmlAsText(html: string): string {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg|iframe|object|template|head|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n')).slice(0, 200_000).trim();
}
function partText(part: GmailPart): string {
  const contentType = part.headers?.find(header => header.name.toLowerCase() === 'content-type')?.value ?? '';
  const declared = contentType.match(/(?:^|;)\s*charset\s*=\s*(?:"([^";]{1,40})"|'([^';]{1,40})'|([^;\s]{1,40}))/i);
  const charset = supportedCharset(declared?.[1] ?? declared?.[2] ?? declared?.[3] ?? '') ?? 'utf-8';
  return new TextDecoder(charset).decode(decodeBase64Url(part.body!.data!, 2_000_000));
}
/**
 * Senders that generate the text part from their HTML leave Outlook conditional comments and
 * `<url>` markers behind; they are noise to a reader and to the model.
 */
export function cleanPlainText(text: string): string {
  return text.replace(/<!--\[if [^\]]*\]>(?:<!-->)?/gi, '').replace(/(?:<!--)?<!\[endif\]-->/gi, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function messageText(message: GmailMessage) {
  const parts = walkParts(message.payload);
  const plain = parts.find(p => p.mimeType?.toLowerCase() === 'text/plain' && p.body?.data && !p.filename);
  if (plain?.body?.data) return cleanPlainText(partText(plain).slice(0, 200_000));
  const html = parts.find(p => p.mimeType?.toLowerCase() === 'text/html' && p.body?.data && !p.filename);
  return html?.body?.data ? htmlAsText(partText(html)) : '';
}
/**
 * The message's own HTML, for the reader only. The browser shows it in a sandboxed frame with no
 * scripts and remote content blocked (`src/components/google/email-frame.tsx`); it is never given
 * to the model or the agent.
 */
export function messageHtml(message: GmailMessage, max = 1_500_000): string | null {
  const html = walkParts(message.payload).find(p => p.mimeType?.toLowerCase() === 'text/html' && p.body?.data && !p.filename);
  if (!html?.body?.data) return null;
  try {
    const text = partText(html);
    return text.length <= max ? text : null;
  } catch { return null; }
}
export function attachmentParts(message: GmailMessage) {
  return walkParts(message.payload).filter(p => p.filename && p.body && (p.body.attachmentId || p.body.data)).map(p => ({
    partId: p.partId ?? '', filename: clean(p.filename ?? '').slice(0, 255), mimeType: clean(p.mimeType ?? 'application/octet-stream').slice(0, 150),
    size: Number(p.body?.size ?? 0), attachmentId: p.body?.attachmentId, data: p.body?.data,
  })).filter(p => p.partId && p.filename);
}
function encoded(value: string) {
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 42 && chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk || !words.length) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  return words.join('\r\n ');
}
const b64lines = (data: Buffer) => data.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
export function mimeMessage(input: Compose): { raw: string; sha256: string } {
  const from = safeAddress(input.from);
  const to = input.to.map(safeAddress), cc = input.cc.map(safeAddress), bcc = input.bcc.map(safeAddress);
  if (!input.allowNoRecipients && !to.length && !cc.length && !bcc.length) throw new CapabilityError('INVALID', 'Informe pelo menos um destinatário.');
  if (new Set([...to, ...cc, ...bcc].map(x => x.toLowerCase())).size !== to.length + cc.length + bcc.length) throw new CapabilityError('INVALID', 'Remova destinatários repetidos.');
  const subject = safeHeader(input.subject);
  const id = safeMessageId(input.messageId);
  if (input.body.length > 200_000) throw new CapabilityError('INVALID', 'O corpo do e-mail excede o limite.');
  const headers = [`From: ${from}`, ...(to.length ? [`To: ${to.join(', ')}`] : []), ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), ...(bcc.length ? [`Bcc: ${bcc.join(', ')}`] : []),
    `Subject: ${encoded(subject)}`, `Message-ID: ${id}`, 'MIME-Version: 1.0'];
  if (input.replyHeader) headers.push(`In-Reply-To: ${safeMessageId(input.replyHeader)}`);
  if (input.references) {
    const refs = input.references.split(/\s+/).filter(Boolean).flatMap(reference => {
      try { return [safeMessageId(reference)]; } catch { return []; }
    }).slice(-20);
    while (refs.join(' ').length > 850) refs.shift();
    if (refs.length) headers.push(`References: ${refs.join(' ')}`);
  }
  let content: string;
  if (!input.files.length) content = [...headers, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(input.body, 'utf8')), ''].join('\r\n');
  else {
    const boundary = `lume-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
    const sections = [`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(input.body, 'utf8'))}\r\n`];
    for (const file of input.files) {
      const name = safeHeader(file.filename, 255);
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream';
      const parameter = encodeURIComponent(name);
      if (parameter.length > 900) throw new CapabilityError('INVALID', 'O nome do anexo é muito longo.');
      sections.push(`--${boundary}\r\nContent-Type: ${type}\r\nContent-Disposition: attachment; filename*=UTF-8''${parameter}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(file.data)}\r\n`);
    }
    content = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...sections, `--${boundary}--`, ''].join('\r\n');
  }
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.byteLength > 35_000_000) throw new CapabilityError('INVALID', 'A mensagem excede o limite de tamanho do Gmail.');
  return { raw: bytes.toString('base64url'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
