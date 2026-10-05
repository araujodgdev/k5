import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { marked, type Token, type Tokens } from 'marked';
import { DocumentPdfError } from '@/lib/document-pdf-contract';

type Block = { text: string; heading: boolean };
function blocks(tokens: Token[]): Block[] {
  return tokens.flatMap((token): Block[] => {
    if (token.type === 'space' || token.type === 'def' || token.type === 'hr') return [];
    if (token.type === 'list') return token.items.flatMap((item: Tokens.ListItem, i: number) => blocks(item.tokens).map((block, j) => ({ ...block, text: j === 0 ? `${i + 1}. ${block.text}` : block.text })));
    if (token.type === 'blockquote') return blocks(token.tokens ?? []);
    if (token.type === 'table') return token.rows.map((row: Tokens.TableCell[]) => ({ heading: false, text: row.map((cell, index) => `${token.header[index].text}: ${cell.text}`).join('\n') }));
    return [{ text: 'text' in token ? String(token.text) : token.raw, heading: token.type === 'heading' }];
  });
}
function supported(text: string, font: PDFFont) {
  return [...text.replace(/\u2212/g, '-').replace(/[\u0000-\u0008\u000b-\u001f]/g, '')].map(char => {
    if (char === '\n') return char;
    try { font.encodeText(char); return char; } catch { return '?'; }
  }).join('');
}

/** Reports use standard PDF fonts and fixed layout, with no external conversion service. */
export async function renderLegalPdf(title: string, markdown: string) {
  if (markdown.length > 500_000) throw new DocumentPdfError(413, 'A memória é extensa demais para PDF. Exporte a planilha CSV ou divida o período.');
  const document = await PDFDocument.create();
  document.setTitle(title); document.setAuthor('Lume');
  const normal = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28, height = 841.89, margin = 48, lineWidth = width - 2 * margin;
  let page = document.addPage([width, height]); let y = height - margin;
  const nextPage = () => { page = document.addPage([width, height]); y = height - margin; };
  const line = (text: string, font: PDFFont, size: number) => {
    if (y < 60) nextPage();
    page.drawText(text, { x: margin, y, size, font, color: rgb(0.12, 0.13, 0.14) });
    y -= size * 1.5;
  };
  for (const block of blocks(marked.lexer(markdown))) {
    const font = block.heading ? bold : normal; const size = block.heading ? 14 : 10;
    if (block.heading && y < 110) nextPage();
    for (const paragraph of supported(block.text, font).split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= lineWidth) { current = candidate; continue; }
        if (current) { line(current, font, size); current = ''; }
        for (const char of word) {
          if (font.widthOfTextAtSize(current + char, size) > lineWidth) { line(current, font, size); current = ''; }
          current += char;
        }
      }
      if (current) line(current, font, size);
    }
    y -= block.heading ? 8 : 10;
  }
  const pages = document.getPages();
  for (const [index, sheet] of pages.entries()) {
    sheet.drawLine({ start: { x: margin, y: 42 }, end: { x: width - margin, y: 42 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    sheet.drawText(`Lume  |  ${index + 1} / ${pages.length}`, { x: margin, y: 27, font: normal, size: 8, color: rgb(0.4, 0.4, 0.4) });
  }
  return document.save();
}
