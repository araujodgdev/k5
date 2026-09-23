/**
 * Turns a real response into a fixture that can live in the repository: personal identifiers and
 * credentials go, structure and field names stay (A1). Pure and deterministic, so the same payload
 * always yields the same fixture.
 *
 * ponytail: pattern-based. Party names and free-text addresses are not recognised; review a
 * recorded fixture before committing it. Add a name list only if a source proves it necessary.
 */

/** Keys whose value is a secret whatever it looks like. Matched on the key, case-insensitively. */
const CREDENTIAL_KEY = /senha|password|token|secret|authorization|idconsultante|api[-_]?key/i;
const OAB_KEY = /oab/i;
/** Personal document fields, whatever the value looks like (an unformatted or partial number). */
const DOCUMENT_KEY = /cpf|cnpj|^documento$|numerodocumento/i;

// Digit lookarounds keep a 20-digit CNJ number, which is public, from matching as CPF or phone.
const PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, '[cnpj]'],
  [/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, '[cpf]'],
  [/\bOAB\b[^\d\n]{0,8}\d[\d.]{0,8}[A-Z]?/gi, '[oab]'],
  [/(?<!\d)(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}(?!\d)/g, '[telefone]'],
];

export function sanitizeText(value: string): string {
  return PATTERNS.reduce((text, [pattern, token]) => text.replace(pattern, token), value);
}

function sanitizeValue(value: unknown, key: string | null): unknown {
  if (key && CREDENTIAL_KEY.test(key)) return '[removido]';
  const primitive = typeof value === 'string' || typeof value === 'number';
  if (primitive && key && DOCUMENT_KEY.test(key)) return '[documento]';
  if (primitive && key && OAB_KEY.test(key)) return '[oab]';
  if (typeof value === 'string') return sanitizeText(value);
  // A CPF published as a JSON number is still a CPF. Only a number that matches becomes a token,
  // so counts, pages and ids keep their type.
  if (typeof value === 'number') {
    const text = String(value);
    const clean = sanitizeText(text);
    return clean === text ? value : clean;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, null));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeValue(v, k)]));
  }
  return value;
}

export function sanitizeForFixture(payload: string, contentType: string): string {
  if (contentType.toLowerCase().includes('json')) {
    try {
      return `${JSON.stringify(sanitizeValue(JSON.parse(payload), null), null, 2)}\n`;
    } catch {
      // Not valid JSON after all: fall through and treat it as text, which still strips identifiers.
    }
  }
  // XML and anything else: credential elements lose their content, then the text patterns run.
  return sanitizeText(stripCredentialElements(payload));
}

/** Empties XML elements that carry a credential. Also used on evidence, which is otherwise kept byte-faithful. */
export function stripCredentialElements(xml: string): string {
  return xml.replace(
    /<((?:[\w-]+:)?(\w*(?:senha|password|token|idConsultante)\w*))(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    (_match, tag: string, _local: string, attrs = '') => `<${tag}${attrs}>[removido]</${tag}>`,
  );
}
