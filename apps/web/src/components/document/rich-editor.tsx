"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { ArrowUp, Bold, Heading2, Italic, List, ListOrdered, LoaderCircle, Quote, Redo2, Table, Undo2 } from "lucide-react";
import { LumeMark } from "@/components/lume-mark";
import { ChangeHighlight, changeHighlightKey, highlightDecorations } from "./change-highlight";
import { blockTexts, changedBlocks } from "./change-blocks";
import { DecorationSet } from "@tiptap/pm/view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RichEditorHandle = {
  /** Replaces the text without counting as an edit, e.g. after the Lume changed the document. */
  setMarkdown: (markdown: string) => void;
  focus: () => void;
  /** The text of each block, to compare with the next version when the Lume changes it. */
  blockTexts: () => string[];
};

const HIGHLIGHT_MS = 6000;

/**
 * Word-like editing over the Markdown the document is stored in. Only what the DOCX export
 * reproduces is offered (headings, bold, italic, lists, quotes, tables), so the page and the Word
 * file agree.
 */
export const RichEditor = forwardRef<RichEditorHandle, {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onSave?: () => void;
  style?: CSSProperties;
  label: string;
  /** Sends the selected text and what to change about it to the Lume; absent hides the option. */
  onAsk?: (request: { excerpt: string; instruction: string }) => Promise<void>;
  /** Block texts of the version before this one; blocks not among them are marked for a moment. */
  highlightAgainst?: string[] | null;
}>(function RichEditor({ initialMarkdown, onChange, onSave, style, label, onAsk, highlightAgainst }, ref) {
  // The editor keeps the callbacks it was created with; these refs hand it the current ones.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onChangeRef.current = onChange; onSaveRef.current = onSave; });
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false, codeBlock: false, strike: false, underline: false, link: false, horizontalRule: false,
      }),
      // Cells hold one paragraph of inline text: that is what a Markdown table can store.
      TableKit.configure({ table: { resizable: false } }),
      ChangeHighlight,
      Markdown,
    ],
    content: initialMarkdown,
    contentType: "markdown",
    editorProps: {
      attributes: { "aria-label": label, "aria-multiline": "true", role: "textbox", spellcheck: "true", lang: "pt-BR" },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); onSaveRef.current?.(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getMarkdown()),
  });

  useImperativeHandle(ref, () => ({
    setMarkdown: (markdown) => { editor?.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false }); },
    focus: () => { editor?.commands.focus(); },
    blockTexts: () => editor ? blockTexts(editor.state.doc) : [],
  }), [editor]);

  // Mark what changed, bring the first change into view, then let the marks go.
  useEffect(() => {
    if (!editor || !highlightAgainst) return;
    const { doc } = editor.state;
    const first = changedBlocks(doc, highlightAgainst)[0];
    if (!first) return;
    editor.view.dispatch(editor.state.tr.setMeta(changeHighlightKey, highlightDecorations(doc, highlightAgainst)));
    const node = editor.view.nodeDOM(first.from);
    if (node instanceof HTMLElement) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    const timer = setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(changeHighlightKey, DecorationSet.empty));
    }, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [editor, highlightAgainst]);

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      heading: current.isActive("heading", { level: 2 }), bold: current.isActive("bold"), italic: current.isActive("italic"),
      bullet: current.isActive("bulletList"), ordered: current.isActive("orderedList"), quote: current.isActive("blockquote"),
      undo: current.can().undo(), redo: current.can().redo(), table: current.isActive("table"),
    } : null,
  });

  if (!editor) return <div className="min-h-[60dvh]" aria-busy="true" />;
  const chain = () => editor.chain().focus();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b bg-background px-3 py-1.5 md:px-6" role="toolbar" aria-label="Formatação">
        <Tool label="Título de seção" pressed={active?.heading} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 /></Tool>
        <Tool label="Negrito" pressed={active?.bold} onClick={() => chain().toggleBold().run()}><Bold /></Tool>
        <Tool label="Itálico" pressed={active?.italic} onClick={() => chain().toggleItalic().run()}><Italic /></Tool>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Tool label="Lista" pressed={active?.bullet} onClick={() => chain().toggleBulletList().run()}><List /></Tool>
        <Tool label="Lista numerada" pressed={active?.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></Tool>
        <Tool label="Citação" pressed={active?.quote} onClick={() => chain().toggleBlockquote().run()}><Quote /></Tool>
        <Tool label="Inserir tabela" disabled={active?.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></Tool>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Tool label="Desfazer" disabled={!active?.undo} onClick={() => chain().undo().run()}><Undo2 /></Tool>
        <Tool label="Refazer" disabled={!active?.redo} onClick={() => chain().redo().run()}><Redo2 /></Tool>
        {active?.table && (
          <div className="flex flex-wrap items-center gap-0.5 md:ml-2 md:border-l md:pl-2" role="group" aria-label="Tabela">
            <TableAction onClick={() => chain().addRowAfter().run()}>+ linha</TableAction>
            <TableAction onClick={() => chain().addColumnAfter().run()}>+ coluna</TableAction>
            <TableAction onClick={() => chain().deleteRow().run()}>− linha</TableAction>
            <TableAction onClick={() => chain().deleteColumn().run()}>− coluna</TableAction>
            <TableAction onClick={() => chain().deleteTable().run()}>Excluir tabela</TableAction>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">
        <div className="document-prose mx-auto w-full max-w-full" style={style}>
          <EditorContent editor={editor} />
          {onAsk && <AskMenu editor={editor} onAsk={onAsk} />}
        </div>
      </div>
    </div>
  );
});

function TableAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-[13px] md:min-h-8" onClick={onClick}>{children}</Button>;
}

function Tool({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className={cn("size-11 md:size-8", pressed && "bg-accent text-foreground")}
      aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * A selection gets one action: ask the Lume to change just that. The request goes to the
 * conversation with the excerpt, and the Lume answers by editing the document.
 */
function AskMenu({ editor, onAsk }: { editor: Editor; onAsk: (request: { excerpt: string; instruction: string }) => Promise<void> }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function start() {
    const { from, to } = editor.state.selection;
    setAsking(editor.state.doc.textBetween(from, to, "\n").trim().slice(0, 4000));
    setInstruction("");
    setError("");
  }
  function reset() { setAsking(null); setInstruction(""); setError(""); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!asking || !instruction.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onAsk({ excerpt: asking, instruction: instruction.trim() });
      reset();
      editor.commands.setTextSelection(editor.state.selection.to);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o pedido.");
    } finally { setBusy(false); }
  }

  return (
    <BubbleMenu editor={editor} options={{ placement: "bottom-start", offset: 8 }}
      shouldShow={({ state }) => asking !== null || (!state.selection.empty && state.doc.textBetween(state.selection.from, state.selection.to).trim().length > 0)}
      className="z-20 rounded-md border bg-popover text-popover-foreground shadow-[var(--shadow-float)]">
      {asking === null ? (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onMouseDown={(event) => event.preventDefault()} onClick={start}>
          <LumeMark className="size-4 text-brand" aria-hidden="true" />Pedir ao Lume
        </Button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="grid w-[min(22rem,calc(100vw-2rem))] gap-1.5 p-2">
          <label className="sr-only" htmlFor="document-ask">O que mudar no trecho selecionado</label>
          <div className="flex items-center gap-1">
            <input id="document-ask" autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2000} disabled={busy}
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); reset(); editor.commands.focus(); } }}
              placeholder="O que mudar neste trecho?" className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-9" />
            <Button type="submit" size="icon" className="size-11 md:size-9" disabled={busy || !instruction.trim()} aria-label="Enviar ao Lume">
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            </Button>
          </div>
          {error && <p role="alert" className="px-1 text-xs text-destructive">{error}</p>}
        </form>
      )}
    </BubbleMenu>
  );
}
