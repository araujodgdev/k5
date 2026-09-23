import { ConnectorError, type ConnectorErrorCode } from '../contracts';

/**
 * SOAP by hand over the existing transport (A3). The transport already enforces the allowlist,
 * HTTPS, redirects, byte cap and MIME; what SOAP adds is an envelope and a way to read XML safely.
 *
 * The reader below has no DTD support at all: a payload that declares one is refused before a
 * single tag is read, and only the five predefined entities and numeric references are decoded.
 * There is no code path in which an external entity could be resolved or an entity expanded.
 */

export type XmlNode = {
  /** Local name, namespace prefix removed. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Direct text content, concatenated, untrimmed. */
  text: string;
};

export const XML_LIMITS = { maxDepth: 64, maxNodes: 50_000, maxAttributeLength: 8_192 };

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const refuse = (message: string) => new ConnectorError('schema_changed', message);

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) throw refuse('Referência numérica inválida no XML.');
      return String.fromCodePoint(code);
    }
    const known = PREDEFINED[ref];
    if (known === undefined) throw refuse(`Entidade não suportada no XML: ${ref}.`);
    return known;
  });
}

const localName = (qualified: string) => qualified.slice(qualified.indexOf(':') + 1);

/** A `>` inside a quoted attribute value is valid XML (`descricao="Remessa > Contadoria"`). */
function tagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i += 1) {
    const char = xml[i];
    if (quote) { if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  throw refuse('Tag XML sem fim.');
}

// ponytail: namespaces are matched by local name only, which is enough for MNI's fixed schema.
// Check namespace URIs if two sources ever collide on a local name.
export function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw refuse('XML com DTD ou entidade declarada foi recusado.');

  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let index = 0;

  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    const textEnd = open === -1 ? xml.length : open;
    if (textEnd > index) stack[stack.length - 1].text += decode(xml.slice(index, textEnd));
    if (open === -1) break;

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end === -1) throw refuse('Comentário XML sem fim.');
      index = end + 3;
    } else if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end === -1) throw refuse('CDATA sem fim.');
      stack[stack.length - 1].text += xml.slice(open + 9, end);
      index = end + 3;
    } else if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end === -1) throw refuse('Instrução de processamento sem fim.');
      index = end + 2;
    } else if (xml.startsWith('<!', open)) {
      throw refuse('Declaração XML não suportada.');
    } else {
      const end = tagEnd(xml, open + 1);
      const tag = xml.slice(open + 1, end);
      index = end + 1;

      if (tag.startsWith('/')) {
        const name = localName(tag.slice(1).trim());
        const current = stack.pop();
        if (!current || current === root || current.name !== name) throw refuse('XML malformado: tag de fechamento inesperada.');
        continue;
      }

      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const nameMatch = /^([\w.:-]+)/.exec(body);
      if (!nameMatch) throw refuse('XML malformado: tag sem nome.');

      const attrs: Record<string, string> = {};
      const rest = body.slice(nameMatch[1].length);
      for (const match of rest.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const raw = match[2] ?? match[3] ?? '';
        if (raw.length > XML_LIMITS.maxAttributeLength) throw refuse('Atributo XML acima do limite.');
        if (match[1] === 'xmlns' || match[1].startsWith('xmlns:')) continue;
        attrs[localName(match[1])] = decode(raw);
      }

      nodes += 1;
      if (nodes > XML_LIMITS.maxNodes) throw refuse('XML acima do limite de elementos.');
      const node: XmlNode = { name: localName(nameMatch[1]), attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) {
        stack.push(node);
        if (stack.length - 1 > XML_LIMITS.maxDepth) throw refuse('XML acima do limite de profundidade.');
      }
    }
  }

  if (stack.length !== 1) throw refuse('XML malformado: tags não fechadas.');
  const [document] = root.children;
  if (!document || root.children.length !== 1) throw refuse('XML sem elemento raiz único.');
  return document;
}

export const child = (node: XmlNode | undefined, name: string) => node?.children.find((entry) => entry.name === name);
export const childrenNamed = (node: XmlNode | undefined, name: string) => node?.children.filter((entry) => entry.name === name) ?? [];
export const textOf = (node: XmlNode | undefined) => node?.text.trim() || null;

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * SOAP 1.1 envelope. Deterministic byte for byte: element order follows `body`, one element per
 * line, so a request can be compared with a stored fixture.
 */
export function buildEnvelope(
  operation: string,
  body: Array<[name: string, value: string]>,
  namespaces: { service: string; types: string },
): string {
  const fields = body.map(([name, value]) => `<tip:${name}>${escapeXml(value)}</tip:${name}>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="${escapeXml(namespaces.service)}" xmlns:tip="${escapeXml(namespaces.types)}">`,
    '<soapenv:Header/>',
    '<soapenv:Body>',
    `<ser:${operation}>`,
    ...fields,
    `</ser:${operation}>`,
    '</soapenv:Body>',
    '</soapenv:Envelope>',
    '',
  ].join('\n');
}

/**
 * Maps a message a court wrote in prose to a structured failure. Deliberately narrow: anything
 * not recognised is `source_unavailable`, which retries, never a silent success.
 */
export function classifySourceMessage(message: string, fallback: ConnectorErrorCode = 'source_unavailable'): ConnectorErrorCode {
  const text = message.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/sigil|segredo de justica/.test(text)) return 'forbidden';
  if (/autentica|autoriza|credencia|senha|login|unauthori|acesso negado/.test(text)) return 'unauthorized';
  if (/nao encontrad|inexistente|not found|nao localizad/.test(text)) return 'not_found_in_source';
  return fallback;
}

/** SOAP 1.1 (`faultstring`) and 1.2 (`Reason/Text`). Null when the body carries no fault. */
export function faultToConnectorError(xml: string | XmlNode): ConnectorError | null {
  const envelope = typeof xml === 'string' ? parseXml(xml) : xml;
  const fault = child(child(envelope, 'Body'), 'Fault');
  if (!fault) return null;
  const message = textOf(child(fault, 'faultstring')) ?? textOf(child(child(fault, 'Reason'), 'Text')) ?? 'Falha SOAP sem descrição.';
  const faultCode = textOf(child(fault, 'faultcode')) ?? textOf(child(child(fault, 'Code'), 'Value')) ?? '';
  // A client fault the source blames on our request is a contract problem, not a transient one.
  const fallback = /client|sender/i.test(faultCode) ? 'schema_changed' : 'source_unavailable';
  return new ConnectorError(classifySourceMessage(message, fallback), `A fonte recusou a consulta: ${message.slice(0, 300)}`);
}

/** The first element inside `Body`, after refusing DTDs and raising any fault. */
export function readEnvelope(xml: string): XmlNode {
  const envelope = parseXml(xml);
  if (envelope.name !== 'Envelope') throw refuse('A resposta não é um envelope SOAP.');
  const fault = faultToConnectorError(envelope);
  if (fault) throw fault;
  const content = child(envelope, 'Body')?.children[0];
  if (!content) throw refuse('Envelope SOAP sem conteúdo.');
  return content;
}
