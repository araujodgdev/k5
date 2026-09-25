// Deterministic composition of chronology and draft artifacts. No database or server-only
// imports: every function here is pure and unit tested (tests/documents.test.ts).
import { legalMentionsWithoutSource, normalizeEvidence, quoteIsPresent, unauthorizedLegalPassages, type CitationCandidate, type SourceChunk } from './ai-policy';

export type ExtractedEvent = { date: string | null; description: string; quote: string };
export type Extraction = { events: ExtractedEvent[]; gaps: string[]; sourceId: string; sourceLabel: string;
  /** Model that produced the kept result; absent on checkpoints written before escalation existed. */
  producedBy?: string };
export type SourceRef = { id: string; documentId?: string; sourceLabel: string; excerpt: string;
  sourceType?: 'vault' | 'research'; researchReferenceId?: string; materialVersionId?: string; judgmentId?: string; researchChunkId?: string };
export type ChronologyEvent = ExtractedEvent & { index: number; sourceId: string; sourceLabel: string };
export const divergenceKinds = ['data', 'valor', 'envolvidos', 'outro'] as const;
export type Divergence = { kind: typeof divergenceKinds[number]; events: number[]; origin: 'regra' | 'revisão' };
export type DraftParagraph = { text: string; evidence: { sourceId: string; quote: string }[] };
export type DraftSection = { markdown: string; issues: string[]; refs: SourceRef[] };

const kindLabel: Record<Divergence['kind'], string> = { data: 'Datas divergentes', valor: 'Valores divergentes', envolvidos: 'Envolvidos divergentes', outro: 'Possível divergência' };

/** "contrato.pdf — página:3" -> "contrato.pdf — página 3". */
function readableLabel(label: string) {
  return label.replace(/(^|[\s—-])(página|parágrafo|mensagem|linha|aba):\s*/giu, '$1$2 ').replace(/\s+/g, ' ').trim();
}
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => { const t = oneLine(text); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
/** Escapes model/source text so it cannot inject markdown structure into the artifact. */
export function escapeMarkdown(text: string) {
  return oneLine(text).replace(/([\\*_`])/g, '\\$1').replace(/^(#+|>|[-+])(\s)/, '\\$1$2').replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
}

type DateInfo = { kind: 'full' | 'partial' | 'unknown'; key: string; label: string };
function dateInfo(date: string | null): DateInfo {
  const value = date?.trim() ?? '';
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (full) {
    const [y, m, d] = full.slice(1).map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d) return { kind: 'full', key: value, label: `${full[3]}/${full[2]}/${full[1]}` };
  }
  const partial = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(value);
  if (partial) return { kind: 'partial', key: value, label: partial[2] ? `${partial[2]}/${partial[1]}` : partial[1] };
  return { kind: 'unknown', key: '', label: 'Data a confirmar' };
}
const compatible = (a: DateInfo, b: DateInfo) => a.kind === 'unknown' || b.kind === 'unknown' || a.key.startsWith(b.key) || b.key.startsWith(a.key);

function tokens(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
/** Same normalized text, or ≥80% token overlap with identical numbers (so "parcela 1" ≠ "parcela 2"). */
function similarDescriptions(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const numbers = (t: string[]) => t.filter(x => /\d/.test(x)).sort().join(' ');
  if (ta.length < 3 || tb.length < 3 || numbers(ta) !== numbers(tb)) return false;
  const sa = new Set(ta), sb = new Set(tb);
  const shared = [...sa].filter(x => sb.has(x)).length;
  return shared / new Set([...sa, ...sb]).size >= 0.8;
}

/** Flattens extractions into the stable event index space used by composition and model review. */
export function chronologyEvents(extracted: Extraction[]): ChronologyEvent[] {
  const seen = new Set<string>();
  const events: ChronologyEvent[] = [];
  for (const r of extracted) for (const e of r.events) {
    const key = `${r.sourceId}\0${e.date ?? ''}\0${normalizeEvidence(e.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ ...e, index: events.length, sourceId: r.sourceId, sourceLabel: r.sourceLabel });
  }
  return events;
}

/** Deterministic divergence rule: same literal quote or near-identical description with incompatible dates. */
export function detectDateDivergences(events: ChronologyEvent[]) {
  const parent = events.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    const sameQuote = normalizeEvidence(a.quote) === normalizeEvidence(b.quote);
    if (sameQuote || (a.sourceId !== b.sourceId && similarDescriptions(a.description, b.description))) parent[find(j)] = find(i);
  }
  const groups = new Map<number, number[]>();
  events.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  const merged: number[][] = [], divergences: Divergence[] = [];
  for (const members of groups.values()) {
    const dates = members.map(i => dateInfo(events[i].date));
    const conflict = dates.some((a, i) => dates.some((b, j) => j > i && !compatible(a, b)));
    if (conflict) divergences.push({ kind: 'data', events: members, origin: 'regra' });
    else merged.push(members);
  }
  return { merged, divergences };
}

/** Accepts model-proposed divergences only as references to existing event indices; never new text. */
export function validateDivergences(raw: { kind: string; events: number[] }[], eventCount: number, existing: Divergence[] = []): Divergence[] {
  const seen = new Set(existing.map(d => [...d.events].sort((a, b) => a - b).join(',')));
  const result: Divergence[] = [];
  for (const item of raw) {
    if (!(divergenceKinds as readonly string[]).includes(item.kind)) continue;
    const events = [...new Set(item.events)].sort((a, b) => a - b);
    if (events.length < 2 || events.some(i => !Number.isInteger(i) || i < 0 || i >= eventCount)) continue;
    const key = events.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: item.kind as Divergence['kind'], events, origin: 'revisão' });
  }
  return result;
}

function collectRef(refs: Map<string, SourceRef>, sources: SourceChunk[], sourceId: string, sourceLabel: string, quote: string) {
  if (refs.has(sourceId)) return;
  const source = sources.find(s => s.id === sourceId);
  refs.set(sourceId, { id: sourceId, documentId: source?.documentId, sourceType: source?.sourceType,
    researchReferenceId: source?.researchReferenceId, materialVersionId: source?.materialVersionId,
    judgmentId: source?.judgmentId, researchChunkId: source?.researchChunkId,
    sourceLabel: readableLabel(sourceLabel), excerpt: clip(quote, 300) });
}

export function composeChronology(extracted: Extraction[], sources: SourceChunk[], reviewed: Divergence[] = [], notes: string[] = []) {
  const events = chronologyEvents(extracted);
  const { merged, divergences } = detectDateDivergences(events);
  const issues: string[] = [];
  const refs = new Map<string, SourceRef>();
  const description = (e: ChronologyEvent) => {
    const text = sources.find(s => s.id === e.sourceId)?.text ?? '';
    if (legalMentionsWithoutSource(e.description, text).length) {
      issues.push(`Descrição com referência jurídica sem origem omitida (${readableLabel(e.sourceLabel)}).`);
      return '[Descrição omitida: referência jurídica sem origem no trecho. Confira a citação literal.]';
    }
    return escapeMarkdown(e.description);
  };
  // Consolidated entries: non-conflicting groups merge; conflicting events stay separate at their own dates.
  const entries = [...merged, ...divergences.flatMap(d => d.events.map(i => [i]))].map(members => {
    const ordered = members.map(i => events[i]).sort((a, b) => dateInfo(b.date).key.length - dateInfo(a.date).key.length || a.index - b.index);
    return { date: dateInfo(ordered[0].date), first: ordered[0], events: ordered };
  }).sort((a, b) => (a.date.kind === 'unknown' ? 1 : 0) - (b.date.kind === 'unknown' ? 1 : 0) || a.date.key.localeCompare(b.date.key) || a.first.index - b.first.index);

  const blocks: string[] = [];
  let heading = '';
  for (const entry of entries) {
    const title = entry.date.kind === 'partial' ? `${entry.date.label} (data parcial)` : entry.date.label;
    if (title !== heading) { blocks.push(`## ${title}`); heading = title; }
    const evidence = [...new Map(entry.events.map(e => [`${e.sourceId}\0${normalizeEvidence(e.quote)}`, e])).values()];
    blocks.push(description(entry.first), ...evidence.map(e => {
      collectRef(refs, sources, e.sourceId, e.sourceLabel, e.quote);
      return `> ${escapeMarkdown(e.quote)}\n\nFonte: ${escapeMarkdown(readableLabel(e.sourceLabel))}`;
    }));
  }

  const all = [...divergences, ...validateDivergences(reviewed, events.length, divergences)];
  const cite = (e: ChronologyEvent) => `${dateInfo(e.date).kind === 'unknown' ? 'sem data' : dateInfo(e.date).label} em ${escapeMarkdown(readableLabel(e.sourceLabel))} (“${escapeMarkdown(clip(e.quote, 160))}”)`;
  const divergenceLines = all.map(d => {
    const items = d.events.map(i => events[i]);
    items.forEach(e => collectRef(refs, sources, e.sourceId, e.sourceLabel, e.quote));
    return `- ${kindLabel[d.kind]}${d.origin === 'revisão' ? ' (apontada na revisão automática)' : ''} para “${escapeMarkdown(clip(items[0].description, 120))}”: ${items.map(cite).join('; ')}.`;
  });
  if (all.length) issues.push(`${all.length} divergência(s) entre fontes para conferência.`);

  const gapLines = [
    `- Trechos analisados: ${extracted.length} de ${sources.length}.`,
    ...extracted.flatMap(r => r.gaps.map(g => unauthorizedLegalPassages(g, []).length
      ? `- ${escapeMarkdown(readableLabel(r.sourceLabel))}: lacuna com referência jurídica omitida; confira a fonte.`
      : `- ${escapeMarkdown(readableLabel(r.sourceLabel))}: ${escapeMarkdown(g)}`)),
    ...entries.filter(e => e.date.kind !== 'full').map(e => `- ${e.date.kind === 'partial' ? `Data parcial (${e.date.label})` : 'Sem data documentada'}: ${escapeMarkdown(clip(e.first.description, 160))} (${escapeMarkdown(readableLabel(e.first.sourceLabel))}).`),
    ...notes.map(n => `- ${escapeMarkdown(n)}`),
  ];
  const undated = entries.filter(e => e.date.kind !== 'full').length;
  if (undated) issues.push(`${undated} acontecimento(s) sem data completa.`);
  if (extracted.length < sources.length) issues.push('Cobertura incompleta: nem todos os trechos foram analisados.');
  issues.push(...extracted.flatMap(r => r.gaps.map(g => `${readableLabel(r.sourceLabel)}: ${oneLine(g)}`)), ...notes);

  const content = [
    '# Cronologia documental',
    'Minuta para revisão. Cada acontecimento traz o trecho literal e a fonte que o sustentam; divergências e lacunas estão ao final.',
    ...(blocks.length ? blocks : ['Nenhum acontecimento com citação literal verificável foi encontrado.']),
    '## Divergências',
    divergenceLines.length ? divergenceLines.join('\n') : 'Nenhuma divergência identificada automaticamente. Confira as datas antes do uso.',
    '## Lacunas e revisão',
    gapLines.join('\n'),
  ].join('\n\n');
  return { title: 'Cronologia documental', content, issues, refs: [...refs.values()], divergences: all };
}

/** Validates each drafted paragraph against verbatim evidence and renders readable source labels. */
export function assembleDraftSection(heading: string, index: number, result: { paragraphs: DraftParagraph[]; gaps: string[] }, sources: SourceChunk[]): DraftSection {
  const issues: string[] = [];
  const refs = new Map<string, SourceRef>();
  const safeHeading = unauthorizedLegalPassages(heading, []).length ? `Seção ${index + 1}` : oneLine(heading);
  const paragraphs = result.paragraphs.map(paragraph => {
    if (unauthorizedLegalPassages(paragraph.text, []).length) { issues.push(`Fundamentação removida da seção ${safeHeading}; selecione a fonte jurídica.`); return '[FUNDAMENTAÇÃO PENDENTE DE SELEÇÃO]'; }
    const valid = paragraph.evidence.length > 0 && paragraph.evidence.every(e => {
      const source = sources.find(s => s.id === e.sourceId);
      return !!source && source.sourceType !== 'research' && quoteIsPresent(e.quote, source.text);
    });
    if (!valid && !paragraph.text.includes('[PENDENTE')) { issues.push(`Parágrafo sem evidência verificável em ${safeHeading}.`); return '[PENDENTE DE INFORMAÇÃO: parágrafo sem evidência verificável]'; }
    if (!valid) return paragraph.text;
    const labels = [...new Set(paragraph.evidence.map(e => readableLabel(sources.find(s => s.id === e.sourceId)!.sourceLabel)))];
    for (const e of paragraph.evidence) collectRef(refs, sources, e.sourceId, sources.find(s => s.id === e.sourceId)!.sourceLabel, e.quote);
    return `${paragraph.text}\n\n${labels.length > 1 ? 'Fontes' : 'Fonte'}: ${labels.map(escapeMarkdown).join('; ')}`;
  });
  issues.push(...result.gaps);
  return { markdown: `## ${safeHeading}\n\n${paragraphs.join('\n\n')}`, issues, refs: [...refs.values()] };
}

export function composeDraft(outlineTitle: string, sections: DraftSection[], approved: CitationCandidate[]) {
  const title = unauthorizedLegalPassages(outlineTitle, []).length ? 'Minuta documental' : oneLine(outlineTitle) || 'Minuta documental';
  const refs = new Map<string, SourceRef>();
  for (const ref of sections.flatMap(s => s.refs)) if (!refs.has(ref.id)) refs.set(ref.id, ref);
  for (const c of approved) refs.set(c.id, { id: c.id, documentId: c.documentId, sourceType: c.sourceType,
    researchReferenceId: c.researchReferenceId, materialVersionId: c.materialVersionId,
    judgmentId: c.judgmentId, researchChunkId: c.researchChunkId,
    sourceLabel: readableLabel(c.sourceLabel), excerpt: clip(c.text, 300) });
  const legal = approved.length
    ? `## Fundamentação selecionada pelo advogado\n\n${approved.map(c => `${escapeMarkdown(c.text)}\n\nFonte fornecida: ${escapeMarkdown(readableLabel(c.sourceLabel))}. Sem verificação externa.`).join('\n\n')}`
    : '[FUNDAMENTAÇÃO JURÍDICA PENDENTE DE SELEÇÃO]';
  return { title, content: `# ${title}\n\n${[...sections.map(s => s.markdown), legal].join('\n\n')}`, issues: sections.flatMap(s => s.issues), refs: [...refs.values()] };
}

// --- Escalation of chronology extraction ---------------------------------------------------------
// Decided by checks in code, never by the model grading itself. A literal quote proves the passage
// exists, not that the event says what the passage says, so dates are checked against it too.

/** Share of events dropped for a missing literal quote above which the passage is redone. */
export const ESCALATION_DISCARD_RATIO = 0.2;
export type EscalationReason = 'discarded' | 'empty_with_dates' | 'date_not_in_source';

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
// A date is not the tail of a longer number, such as the J.TR.OOOO of a CNJ process number.
const DATE_IN_TEXT = new RegExp(String.raw`(?<!\d|\d[/.-])\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?!\d|[/.-]\d)|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:º|°|o)?\s+de\s+(?:${MONTHS.join('|')})\s+de\s+\d{4}\b`, 'i');

/** Whether the text shows a date written the way Brazilian documents write one. */
export function textHasDate(text: string) {
  return DATE_IN_TEXT.test(plain(text));
}

/** Whether an ISO date (YYYY-MM-DD) appears in the text in a common pt-BR or ISO form. */
export function dateAppearsIn(iso: string, text: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return true;
  const [, year, month, day] = match;
  const d = String(Number(day)), m = String(Number(month));
  const haystack = plain(text);
  const numeric = new RegExp(String.raw`(?<!\d)0?${d}\s*[/.-]\s*0?${m}\s*[/.-]\s*(?:${year}|${year.slice(2)})(?!\d)`);
  const written = new RegExp(String.raw`(?<!\d)0?${d}(?:º|°|o)?\s+de\s+${MONTHS[Number(month) - 1]}\s+de\s+${year}(?!\d)`);
  return haystack.includes(iso) || numeric.test(haystack) || written.test(haystack);
}

/** Why a passage's extraction should be redone by the escalation model, or null when it passes. */
export function needsEscalation(input: { returned: number; kept: ExtractedEvent[]; sourceText: string }): EscalationReason | null {
  const discarded = input.returned - input.kept.length;
  if (input.returned > 0 && discarded / input.returned > ESCALATION_DISCARD_RATIO) return 'discarded';
  if (!input.kept.length && textHasDate(input.sourceText)) return 'empty_with_dates';
  if (input.kept.some(event => event.date && !dateAppearsIn(event.date, event.quote) && !dateAppearsIn(event.date, input.sourceText))) return 'date_not_in_source';
  return null;
}
