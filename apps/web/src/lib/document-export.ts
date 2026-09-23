import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from 'docx';
import { marked, type Token, type Tokens } from 'marked';
import PizZip from 'pizzip';

export type Run = { text: string; bold?: boolean; italic?: boolean; break?: boolean };
export type Block =
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[]; quote?: boolean; indent?: number }
  | { kind: 'item'; ordered: boolean; marker: string; start: number; list: number; level: number; runs: Run[] }
  | { kind: 'table'; header: Run[][]; rows: Run[][][] };

// Only characters allowed in XML 1.0 survive; everything else (control chars, lone surrogates) is dropped.
const sanitize = (text: string) => text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
export function xmlEscape(text: string) { return sanitize(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function textRuns(text: string, style: Omit<Run, 'text'>): Run[] {
  return text.split('\n').flatMap((line, i) => [...(i ? [{ text: '', break: true }] : []), ...(line ? [{ ...style, text: line }] : [])]);
}
function inline(tokens: Token[] | undefined, style: Omit<Run, 'text'> = {}): Run[] {
  return (tokens ?? []).flatMap((token): Run[] => {
    switch (token.type) {
      case 'strong': return inline(token.tokens, { ...style, bold: true });
      case 'em': return inline(token.tokens, { ...style, italic: true });
      case 'br': return [{ text: '', break: true }];
      case 'link': case 'del': return inline(token.tokens, style);
      case 'image': return textRuns((token as Tokens.Image).text, style);
      case 'text': return token.tokens?.length ? inline(token.tokens, style) : textRuns(token.text, style);
      default: return textRuns('text' in token && typeof token.text === 'string' ? token.text : token.raw, style);
    }
  });
}

/** Markdown subset produced by the editor (headings, bold, italic, lists, quotes) as Word-neutral blocks. */
export function markdownBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let lists = 0;
  const walk = (tokens: Token[], quote: boolean, level: number) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'space': case 'def': case 'hr': break;
        case 'heading': blocks.push({ kind: 'heading', level: Math.min(token.depth, 3), runs: inline(token.tokens) }); break;
        case 'paragraph': case 'text': blocks.push({ kind: 'paragraph', runs: token.tokens?.length ? inline(token.tokens) : textRuns(token.text, {}), quote, indent: level }); break;
        case 'blockquote': walk(token.tokens ?? [], true, level); break;
        case 'list': {
          const list = token as Tokens.List, id = lists++;
          const start = typeof list.start === 'number' ? list.start : 1;
          list.items.forEach((item, index) => {
            const [first, ...rest] = item.tokens;
            const firstInline = first && (first.type === 'text' || first.type === 'paragraph');
            blocks.push({ kind: 'item', ordered: list.ordered, marker: list.ordered ? `${start + index}.` : '•', start, list: id, level, runs: firstInline ? (first.tokens?.length ? inline(first.tokens) : textRuns(first.text, {})) : [] });
            walk(firstInline ? rest : item.tokens, quote, level + 1);
          });
          break;
        }
        case 'table': {
          const table = token as Tokens.Table;
          blocks.push({ kind: 'table', header: table.header.map(cell => inline(cell.tokens)), rows: table.rows.map(row => row.map(cell => inline(cell.tokens))) });
          break;
        }
        default: blocks.push({ kind: 'paragraph', runs: textRuns('text' in token && typeof token.text === 'string' ? token.text : token.raw, {}), quote, indent: level });
      }
    }
  };
  walk(marked.lexer(content.replace(/\r\n?/g, '\n')), false, 0);
  return blocks;
}

// ---- docx library path -------------------------------------------------------------------------

function docxRuns(runs: Run[], bold = false): ParagraphChild[] {
  return runs.map(run => run.break ? new TextRun({ break: 1 }) : new TextRun({ text: sanitize(run.text), bold: bold || run.bold, italics: run.italic }));
}
async function plainDocument(blocks: Block[]) {
  const starts = [...new Set(blocks.flatMap(b => b.kind === 'item' && b.ordered ? [b.start] : []))];
  const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], start = 1) => [0, 1, 2].map(level => ({
    level, format, start, alignment: AlignmentType.LEFT, text: format === LevelFormat.BULLET ? '•' : `%${level + 1}.`,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const children = blocks.map(block => {
    if (block.kind === 'table') {
      const columns = Math.max(block.header.length, ...block.rows.map(row => row.length), 1);
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [block.header, ...block.rows].map((row, index) => new TableRow({
          tableHeader: index === 0,
          children: Array.from({ length: columns }, (_, column) => new TableCell({ children: [new Paragraph({ spacing: { after: 0 }, children: docxRuns(row[column] ?? [], index === 0) })] })),
        })),
      });
    }
    if (block.kind === 'heading') return new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1], keepNext: true, children: docxRuns(block.runs) });
    if (block.kind === 'item') return new Paragraph({ numbering: { reference: block.ordered ? `k5-number-${block.start}` : 'k5-bullet', level: Math.min(block.level, 2), instance: block.list }, children: docxRuns(block.runs) });
    return new Paragraph({ indent: block.quote || block.indent ? { left: 720 * ((block.indent ?? 0) + (block.quote ? 1 : 0)) } : undefined, children: docxRuns(block.quote ? block.runs.map(r => ({ ...r, italic: true })) : block.runs) });
  });
  return Packer.toBuffer(new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { after: 160 } } } } },
    numbering: { config: [{ reference: 'k5-bullet', levels: levels(LevelFormat.BULLET) }, ...starts.map(start => ({ reference: `k5-number-${start}`, levels: levels(LevelFormat.DECIMAL, start) }))] },
    sections: [{ children: children.length ? children : [new Paragraph({})] }],
  }));
}

// ---- template injection path -------------------------------------------------------------------

const mostCommon = (values: string[]) => [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
const element = (xml: string, name: string) => new RegExp(`<w:${name}\\b[^>]*/>`).exec(xml)?.[0] ?? '';

/** Derives body paragraph/run formatting and heading styles from the template, without copying its text. */
function templateFormatting(documentXml: string, stylesXml: string) {
  const body = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? '';
  const paragraphs = body.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  const texted = paragraphs.filter(p => /<w:t(?:\s[^>]*)?>[^<]/.test(p));
  const pPr = mostCommon(texted.map(p => (p.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? '').replace(/<w:(rPr|pPrChange|sectPr|numPr)\b[\s\S]*?<\/w:\1>/g, '')));
  const rPr = mostCommon(texted.flatMap(p => (p.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? []).filter(r => r.includes('<w:t')).map(r => r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '')));
  const headingStyle = (level: number) => {
    const style = (stylesXml.match(/<w:style\b[^>]*w:type="paragraph"[^>]*>[\s\S]*?<\/w:style>/g) ?? []).find(s => new RegExp(`<w:name w:val="heading ${level}"`, 'i').test(s));
    return style?.match(/w:styleId="([^"]+)"/)?.[1];
  };
  return {
    pStyle: element(pPr, 'pStyle'), spacing: element(pPr, 'spacing'), ind: element(pPr, 'ind'), jc: element(pPr, 'jc'),
    rFonts: element(rPr, 'rFonts'), sz: element(rPr, 'sz'), szCs: element(rPr, 'szCs'),
    headings: [1, 2, 3].map(headingStyle),
  };
}
type Formatting = ReturnType<typeof templateFormatting>;

function xmlRuns(runs: Run[], f: Formatting, bold = false) {
  return runs.map(run => run.break ? '<w:r><w:br/></w:r>'
    : `<w:r><w:rPr>${f.rFonts}${bold || run.bold ? '<w:b/><w:bCs/>' : ''}${run.italic ? '<w:i/><w:iCs/>' : ''}${f.sz}${f.szCs}</w:rPr><w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`).join('');
}
/** A bordered, full-width table in the template's body font; the first row repeats on each page. */
function xmlTable(block: Extract<Block, { kind: 'table' }>, f: Formatting) {
  const columns = Math.max(block.header.length, ...block.rows.map(row => row.length), 1);
  const width = Math.floor(9000 / columns);
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('');
  const cell = (runs: Run[], header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr>${f.pStyle}<w:spacing w:before="0" w:after="0"/></w:pPr>${xmlRuns(runs, f, header)}</w:p></w:tc>`;
  const row = (cells: Run[][], header: boolean) =>
    `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: columns }, (_, index) => cell(cells[index] ?? [], header)).join('')}</w:tr>`;
  // tblPr children in schema order: tblW, tblBorders, tblLayout, tblCellMar.
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="autofit"/>`
    + `<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>${row(block.header, true)}${block.rows.map(cells => row(cells, false)).join('')}</w:tbl>`;
}

// Styled headings keep the template heading font/size. pPr children are emitted in schema order: pStyle, keepNext, spacing, ind, jc.
function xmlBlock(block: Block, f: Formatting) {
  if (block.kind === 'table') return xmlTable(block, f);
  if (block.kind === 'heading') {
    const style = f.headings[block.level - 1];
    return style
      ? `<w:p><w:pPr><w:pStyle w:val="${xmlEscape(style)}"/><w:keepNext/></w:pPr>${xmlRuns(block.runs, { ...f, rFonts: '', sz: '', szCs: '' })}</w:p>`
      : `<w:p><w:pPr>${f.pStyle}<w:keepNext/>${f.spacing}</w:pPr>${xmlRuns(block.runs, f, true)}</w:p>`;
  }
  if (block.kind === 'item') {
    const left = 720 * (block.level + 1);
    return `<w:p><w:pPr>${f.pStyle}${f.spacing}<w:ind w:left="${left}" w:hanging="360"/>${f.jc}</w:pPr><w:r><w:rPr>${f.rFonts}${f.sz}${f.szCs}</w:rPr><w:t xml:space="preserve">${xmlEscape(block.marker)}</w:t><w:tab/></w:r>${xmlRuns(block.runs, f)}</w:p>`;
  }
  const indent = (block.indent ?? 0) + (block.quote ? 1 : 0);
  return `<w:p><w:pPr>${f.pStyle}${f.spacing}${indent ? `<w:ind w:left="${720 * indent}"/>` : f.ind}${f.jc}</w:pPr>${xmlRuns(block.quote ? block.runs.map(r => ({ ...r, italic: true })) : block.runs, f)}</w:p>`;
}

function injectIntoTemplate(blocks: Block[], template: Buffer) {
  const zip = new PizZip(template);
  const original = zip.file('word/document.xml')?.asText();
  if (!original || !/<w:body>[\s\S]*<\/w:body>/.test(original)) throw new Error('Modelo Word inválido.');
  const formatting = templateFormatting(original, zip.file('word/styles.xml')?.asText() ?? '');
  // Keep header/footer parts, relationships, styles and final section geometry.
  // Do not retain any factual body paragraphs from the previous matter.
  const section = original.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)?.at(-1) ?? '';
  // Word expects a paragraph between a closing table and the section properties.
  const body = (blocks.map(block => xmlBlock(block, formatting)).join('') + (blocks.at(-1)?.kind === 'table' ? '<w:p/>' : '')) || '<w:p/>';
  zip.file('word/document.xml', original.replace(/<w:body>[\s\S]*<\/w:body>/, () => `<w:body>${body}${section}</w:body>`));
  // Strip old comment/footnote bodies (keeping required separators) and metadata, which may contain prior-case facts.
  for (const name of Object.keys(zip.files)) if (/^word\/(comments|footnotes|endnotes)[^/]*\.xml$/.test(name)) {
    const xml = zip.file(name)?.asText();
    if (xml) zip.file(name, xml
      .replace(/<w:comment\b[^>]*>[\s\S]*?<\/w:comment>/g, '')
      .replace(/<w:(footnote|endnote)\b(?![^>]*w:type="(?:separator|continuationSeparator|continuationNotice)")[^>]*>[\s\S]*?<\/w:\1>/g, ''));
  }
  // Replace instead of removing so relationships and content types stay valid.
  if (zip.file('docProps/core.xml')) zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>');
  const custom = zip.file('docProps/custom.xml')?.asText();
  if (custom) zip.file('docProps/custom.xml', custom.replace(/<property\b[^>]*>[\s\S]*?<\/property>/g, ''));
  const app = zip.file('docProps/app.xml')?.asText();
  if (app) zip.file('docProps/app.xml', app.replace(/<(Company|Manager)>[\s\S]*?<\/\1>/g, '<$1></$1>'));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function exportDocument(content: string, template?: Buffer) {
  const blocks = markdownBlocks(content);
  return template ? injectIntoTemplate(blocks, template) : plainDocument(blocks);
}

// ---- editor typography ---------------------------------------------------------------------------

export type Typography = {
  fontFamily: string | null; fontSizePt: number | null; textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number | null; firstLineIndentCm: number | null;
  pageWidthCm: number | null; marginLeftCm: number | null; marginRightCm: number | null;
};

const attr = (xml: string, name: string) => new RegExp(`w:${name}="([^"]*)"`).exec(xml)?.[1];
const twipsToCm = (value: string | undefined) => value && /^-?\d+$/.test(value) ? Math.round(Number(value) / 567 * 100) / 100 : null;

/**
 * What the editor needs to look like the exported Word file: the body paragraph's font, size,
 * alignment, line spacing and first-line indent, and the page's usable width. Read from the same
 * paragraphs the export copies formatting from, so the two agree.
 */
export function templateTypography(documentXml: string): Typography {
  const f = templateFormatting(documentXml, '');
  const sizeHalfPoints = Number(attr(f.sz, 'val'));
  const fontSizePt = Number.isFinite(sizeHalfPoints) && sizeHalfPoints > 0 ? sizeHalfPoints / 2 : null;
  const jc = attr(f.jc, 'val');
  const textAlign = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
  const line = Number(attr(f.spacing, 'line'));
  const rule = attr(f.spacing, 'lineRule') ?? 'auto';
  const lineHeight = !Number.isFinite(line) || line <= 0 ? null
    : rule === 'auto' ? Math.round(line / 240 * 100) / 100
    : fontSizePt ? Math.round(line / 20 / fontSizePt * 100) / 100 : null;
  const section = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)?.at(-1) ?? '';
  const margins = element(section, 'pgMar');
  return {
    fontFamily: attr(f.rFonts, 'ascii') ?? attr(f.rFonts, 'hAnsi') ?? null,
    fontSizePt, textAlign, lineHeight,
    firstLineIndentCm: twipsToCm(attr(f.ind, 'firstLine')),
    pageWidthCm: twipsToCm(attr(element(section, 'pgSz'), 'w')),
    marginLeftCm: twipsToCm(attr(margins, 'left')), marginRightCm: twipsToCm(attr(margins, 'right')),
  };
}

export function docxTypography(template: Buffer): Typography | null {
  const documentXml = new PizZip(template).file('word/document.xml')?.asText();
  return documentXml ? templateTypography(documentXml) : null;
}
