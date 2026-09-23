import { CapabilityError } from '@/lib/capabilities/errors';

/**
 * Plain text of a Google Docs body and the map from each text offset to its Docs index.
 * Docs indices count UTF-16 code units, like JavaScript strings, so a text run of length n covers
 * startIndex..startIndex+n-1. Structural markers (table, row and cell starts, section breaks) take
 * an index but no text; non-text inline elements (images, page breaks) are shown as U+FFFC so the
 * text keeps their position. A match is only editable when its indices are contiguous, which is
 * what keeps an edit from spanning a table cell boundary or an embedded object.
 */
type TextRun = { content?: string };
type ParagraphElement = { startIndex?: number; endIndex?: number; textRun?: TextRun };
type StructuralElement = {
  startIndex?: number; endIndex?: number;
  paragraph?: { elements?: ParagraphElement[] };
  table?: { tableRows?: { tableCells?: { content?: StructuralElement[] }[] }[] };
  tableOfContents?: { content?: StructuralElement[] };
};
type Tab = { tabProperties?: { tabId?: string; title?: string }; documentTab?: { body?: { content?: StructuralElement[] } }; childTabs?: Tab[] };
export type GoogleDocument = { documentId?: string; title?: string; revisionId?: string; body?: { content?: StructuralElement[] }; tabs?: Tab[] };

export type DocText = { text: string; indices: number[]; tabIds: (string | null)[] };

export function documentText(document: GoogleDocument): DocText {
  const parts: string[] = [];
  const indices: number[] = [];
  const tabIds: (string | null)[] = [];
  const walk = (elements: StructuralElement[] | undefined, tabId: string | null) => {
    for (const element of elements ?? []) {
      if (element.paragraph) {
        for (const item of element.paragraph.elements ?? []) {
          const start = item.startIndex ?? 0;
          if (item.textRun) {
            const content = item.textRun.content ?? '';
            parts.push(content);
            for (let offset = 0; offset < content.length; offset++) { indices.push(start + offset); tabIds.push(tabId); }
          } else if (item.endIndex !== undefined && item.endIndex > start) {
            parts.push('￼');
            indices.push(start);
            tabIds.push(tabId);
          }
        }
      } else if (element.table) {
        for (const row of element.table.tableRows ?? []) for (const cell of row.tableCells ?? []) walk(cell.content, tabId);
      } else if (element.tableOfContents) {
        walk(element.tableOfContents.content, tabId);
      }
    }
  };
  if (document.tabs?.length) {
    const walkTabs = (tabs: Tab[]) => {
      for (const tab of tabs) {
        if (parts.length) { parts.push('￼'); indices.push(-1); tabIds.push(null); }
        walk(tab.documentTab?.body?.content, tab.tabProperties?.tabId ?? null);
        if (tab.childTabs?.length) walkTabs(tab.childTabs);
      }
    };
    walkTabs(document.tabs);
  } else walk(document.body?.content, null);
  return { text: parts.join(''), indices, tabIds };
}

export type DocEdit = { find: string; replace: string };
export type ResolvedEdit = { startIndex: number; endIndex: number; find: string; replace: string; tabId: string | null };

function occurrences(text: string, find: string) {
  const found: number[] = [];
  for (let at = text.indexOf(find); at !== -1 && found.length < 2; at = text.indexOf(find, at + 1)) found.push(at);
  return found;
}

/**
 * Resolves each edit against the current text. `changed` says the document moved past the
 * revision the caller read: any edit that no longer resolves to exactly one place is then a
 * conflict that requires reading again.
 */
export function resolveEdits(doc: DocText, edits: DocEdit[], changed: boolean): ResolvedEdit[] {
  const reread = 'O documento mudou desde a leitura e esta alteração não pode ser recalculada com segurança. Leia o documento novamente e refaça a proposta.';
  const resolved = edits.map((edit, position) => {
    const label = `A edição ${position + 1}`;
    const found = occurrences(doc.text, edit.find);
    if (found.length === 0) {
      throw new CapabilityError(changed ? 'CONFLICT' : 'INVALID', changed ? reread : `${label}: o trecho a substituir não foi encontrado no documento.`);
    }
    if (found.length > 1) {
      throw new CapabilityError('CONFLICT', changed ? reread : `${label}: o trecho aparece mais de uma vez. Inclua mais texto ao redor para identificar um único trecho.`);
    }
    const start = found[0];
    const end = start + edit.find.length;
    const first = doc.indices[start];
    const last = doc.indices[end - 1];
    const tabId = doc.tabIds[start] ?? null;
    if (first === undefined || last === undefined || first < 0 || last - first !== edit.find.length - 1 ||
      edit.find.includes('￼') || doc.tabIds.slice(start, end).some(id => id !== tabId)) {
      throw new CapabilityError('INVALID', `${label}: o trecho atravessa uma tabela, imagem ou outro elemento que não é texto. Escolha um trecho de texto contínuo.`);
    }
    return { startIndex: first, endIndex: last + 1, find: edit.find, replace: edit.replace, tabId };
  });
  const ordered = [...resolved].sort((a, b) => (a.tabId ?? '').localeCompare(b.tabId ?? '') || a.startIndex - b.startIndex);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].tabId === ordered[index - 1].tabId && ordered[index].startIndex < ordered[index - 1].endIndex)
      throw new CapabilityError('INVALID', 'Duas edições alteram o mesmo trecho. Combine-as em uma só.');
  }
  return resolved;
}

/**
 * batchUpdate requests applied from the end of the document to the start, so each deletion and
 * insertion leaves the indices of the edits still to apply untouched.
 */
export function editRequests(resolved: ResolvedEdit[]) {
  const requests: Record<string, unknown>[] = [];
  for (const edit of [...resolved].sort((a, b) => b.startIndex - a.startIndex)) {
    requests.push({ deleteContentRange: { range: { startIndex: edit.startIndex, endIndex: edit.endIndex, ...(edit.tabId ? { tabId: edit.tabId } : {}) } } });
    if (edit.replace) requests.push({ insertText: { location: { index: edit.startIndex, ...(edit.tabId ? { tabId: edit.tabId } : {}) }, text: edit.replace } });
  }
  return requests;
}

/** Best effort after an unknown outcome: every replacement present and every replaced text gone. */
export function editsVisible(text: string, edits: DocEdit[]) {
  return edits.every(edit => (!edit.replace || text.includes(edit.replace)) && (!text.includes(edit.find) || edit.replace.includes(edit.find)));
}
