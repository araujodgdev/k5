import { Extension } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { changedBlocks } from "./change-blocks";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Marks the blocks the Lume changed, for a few seconds after its edit loads. Decorations only:
 * nothing is written into the document, so the marks never reach the Markdown or the Word file.
 */
export const changeHighlightKey = new PluginKey<DecorationSet>("changeHighlight");

export const ChangeHighlight = Extension.create({
  name: "changeHighlight",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: changeHighlightKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => {
          const next = tr.getMeta(changeHighlightKey) as DecorationSet | undefined;
          return next ?? set.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: (state) => changeHighlightKey.getState(state) },
    })];
  },
});

export function highlightDecorations(doc: ProseMirrorNode, previous: readonly string[]) {
  return DecorationSet.create(doc, changedBlocks(doc, previous).map(({ from, to }) => Decoration.node(from, to, { class: "document-changed" })));
}
