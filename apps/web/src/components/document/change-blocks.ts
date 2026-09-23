// Which blocks of a document changed between two versions. Pure, so it is tested without a browser.
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The text of every paragraph-like block, the unit a change is shown at. */
export function blockTexts(doc: ProseMirrorNode) {
  const texts: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const text = normalize(node.textContent);
    if (text) texts.push(text);
    return false;
  });
  return texts;
}

/** Positions of the blocks whose text did not exist before: new or reworded paragraphs, cells, items. */
export function changedBlocks(doc: ProseMirrorNode, previous: readonly string[]) {
  const before = new Set(previous);
  const ranges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = normalize(node.textContent);
    if (text && !before.has(text)) ranges.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return ranges;
}
