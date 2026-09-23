// Finding citation candidates and the sources that could back them. Pure code, tuned for recall:
// it over-finds on purpose, and Jev decides which candidates are citations at all
// (docs.typesafe.ai, pre-parsed value extraction and citation check cookbooks).

export type CitationAnchor = 'article' | 'norm' | 'precedent' | 'case' | 'cnj';
export type CitationSpan = { id: string; text: string; start: number; end: number; anchor: CitationAnchor; paragraph: string };
export type CitationSource = {
  id: string; kind: 'web_jurisprudence' | 'web' | 'vault';
  title: string; url?: string | null; court?: string | null; caseNumber?: string | null; text: string;
};

const NUMBER = String.raw`(?:n[º°o.]*\s*)?\d[\d.]*(?:\s*[ºª°])?`;
const COURT = String.raw`(?:STF|STJ|TST|TSE|STM|TNU|CJF|FONAJE|TJ[A-Z]{2}|TJDFT|TRF\s?-?\s?\d|TRT\s?-?\s?\d{1,2})`;
const LAW = String.raw`(?:Lei(?:\s+Complementar)?|LC|Decreto(?:-Lei)?|Medida\s+Provis[oó]ria|MP|Resolu[çc][ãa]o|Instru[çc][ãa]o\s+Normativa|Emenda\s+Constitucional|EC)`;
const CODE = String.raw`(?:Constitui[çc][ãa]o(?:\s+Federal)?|CF(?:\/88)?|CRFB(?:\/88)?|CPC|CPP|CLT|CDC|CTN|ECA|LINDB|C[oó]digo\s+(?:Civil|Penal|de\s+Processo\s+Civil|de\s+Processo\s+Penal|de\s+Defesa\s+do\s+Consumidor|Tribut[aá]rio\s+Nacional)|CC(?:\/02)?)`;

const patterns: Array<[CitationAnchor, RegExp]> = [
  // "art. 319, IV, do CPC", "arts. 186 e 927 do Código Civil", "artigo 5º, inciso X, da Constituição"
  ['article', new RegExp(String.raw`\barts?\.?\s*\d[\d.]*(?:\s*[ºª°])?(?:[^.;:\n()]{0,90}?\b(?:${CODE}|${LAW}\s*${NUMBER}(?:\/\d{2,4})?))?`, 'gi')],
  ['article', new RegExp(String.raw`\bartigos?\s+\d[\d.]*(?:\s*[ºª°])?(?:[^.;:\n()]{0,90}?\b(?:${CODE}|${LAW}\s*${NUMBER}(?:\/\d{2,4})?))?`, 'gi')],
  // "Lei 8.078/1990", "Lei Complementar nº 123/2006", "Decreto-Lei 5.452/43"
  ['norm', new RegExp(String.raw`\b${LAW}\s*${NUMBER}(?:\/\d{2,4})?`, 'gi')],
  // "Súmula 54 do STJ", "Súmula Vinculante 13", "Tema 1.046 do STF", "Enunciado 12 do FONAJE", "OJ 394 da SDI-1"
  ['precedent', new RegExp(String.raw`\b(?:S[úu]mulas?(?:\s+Vinculantes?)?|Temas?(?:\s+Repetitivos?)?|Enunciados?|OJ|Orienta[çc][ãa]o\s+Jurisprudencial|Informativo)\s*${NUMBER}(?:\s*(?:,\s*)?(?:do|da)\s*(?:${COURT}|SDI-?\d|SBDI-?\d))?`, 'gi')],
  // "REsp 1.234.567/SP", "AgInt no AREsp 2.000.000", "HC 123.456", "ADI 4.277", "RE 574.706"
  ['case', new RegExp(String.raw`\b(?:REsp|AREsp|EREsp|RE|ARE|AgInt|AgRg|EDcl|HC|RHC|MS|RMS|ADI|ADC|ADPF|ADO|Rcl|AIRR|RR|Recurso\s+(?:Especial|Extraordin[aá]rio)|Apela[çc][ãa]o(?:\s+C[ií]vel)?|Agravo\s+(?:de\s+)?(?:Instrumento|Interno))(?:\s+(?:no|na|nos|em)\s+[A-Za-z]{2,6})?\s*${NUMBER}(?:[\d.\-]*)(?:\/(?:[A-Z]{2}|\d{2,4}))?`, 'g')],
  // CNJ unified numbering: 0000000-00.0000.0.00.0000
  ['cnj', /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g],
];

function paragraphAt(text: string, index: number) {
  const start = text.lastIndexOf('\n\n', index) + 1;
  const end = text.indexOf('\n\n', index);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

/** Candidate spans in document order; overlapping matches collapse into the longest one. */
export function findCitationSpans(text: string): CitationSpan[] {
  const found: Omit<CitationSpan, 'id' | 'paragraph'>[] = [];
  for (const [anchor, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      // A sentence's full stop is not part of "Lei 8.245".
      const value = match[0].replace(/[\s,;.:]+$/, '');
      if (value.length < 4) continue;
      found.push({ text: value, start: match.index, end: match.index + value.length, anchor });
    }
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const merged: typeof found = [];
  for (const span of found) {
    const last = merged.at(-1);
    if (last && span.start < last.end) {
      if (span.end > last.end) merged[merged.length - 1] = { ...last, text: text.slice(last.start, span.end), end: span.end };
      continue;
    }
    merged.push(span);
  }
  return merged.map((span, index) => ({ ...span, id: `c${index}`, paragraph: paragraphAt(text, span.start).slice(0, 1500) }));
}

const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
/** The numbers a citation hangs on, without thousands separators: "REsp 1.234.567/SP" -> ["1234567"]. */
export function citationNumbers(span: string) {
  return [...span.matchAll(/\d[\d.]*/g)].map(match => match[0].replace(/\./g, '')).filter(number => number.length >= 1);
}
const CODE_TOKENS = ['cpc', 'cpp', 'clt', 'cdc', 'ctn', 'eca', 'lindb', 'constituicao', 'cf', 'crfb', 'codigo civil', 'codigo penal', 'stf', 'stj', 'tst', 'tse'];

/**
 * Sources that could be the one cited: the citation's main number appears in the source as a whole
 * number, and a code or court the citation names appears too. Further numbers (a year, a second
 * article) only rank; "Lei 8.078/90" and "Lei 8.078/1990" are the same law. Best first, at most 3.
 */
export function candidateSources(span: string, sources: CitationSource[]) {
  // A CNJ number is one identifier; its first block alone would match unrelated numbers.
  const cnj = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.exec(span)?.[0];
  if (cnj) return sources.filter(source => [source.title, source.caseNumber, source.text].some(value => value?.includes(cnj))).slice(0, 3);
  const numbers = citationNumbers(span);
  if (!numbers.length) return [];
  const folded = fold(span);
  const names = CODE_TOKENS.filter(token => new RegExp(`\\b${token}\\b`).test(folded));
  const whole = (number: string, digits: string) => new RegExp(`(?<!\\d)${number}(?!\\d)`).test(digits);
  return sources.flatMap(source => {
    const haystack = fold([source.title, source.court, source.caseNumber, source.text].filter(Boolean).join(' '));
    const digits = haystack.replace(/(\d)\.(?=\d{3}\b)/g, '$1');
    if (!whole(numbers[0], digits)) return [];
    const hits = numbers.filter(number => whole(number, digits)).length;
    const nameHits = names.filter(name => new RegExp(`\\b${name}\\b`).test(haystack)).length;
    if (names.length && !nameHits) return [];
    return [{ source, rank: hits * 2 + nameHits }];
  }).sort((a, b) => b.rank - a.rank).slice(0, 3).map(item => item.source);
}
