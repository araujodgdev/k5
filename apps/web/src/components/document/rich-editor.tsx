"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Bold, Heading2, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RichEditorHandle = {
  /** Replaces the text without counting as an edit, e.g. after the Lume changed the document. */
  setMarkdown: (markdown: string) => void;
  focus: () => void;
};

/**
 * Word-like editing over the Markdown the document is stored in. Only what the DOCX export
 * reproduces is offered (headings, bold, italic, lists, quotes), so the page and the Word file agree.
 */
export const RichEditor = forwardRef<RichEditorHandle, {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onSave?: () => void;
  style?: CSSProperties;
  label: string;
}>(function RichEditor({ initialMarkdown, onChange, onSave, style, label }, ref) {
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
  }), [editor]);

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      heading: current.isActive("heading", { level: 2 }), bold: current.isActive("bold"), italic: current.isActive("italic"),
      bullet: current.isActive("bulletList"), ordered: current.isActive("orderedList"), quote: current.isActive("blockquote"),
      undo: current.can().undo(), redo: current.can().redo(),
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
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Tool label="Desfazer" disabled={!active?.undo} onClick={() => chain().undo().run()}><Undo2 /></Tool>
        <Tool label="Refazer" disabled={!active?.redo} onClick={() => chain().redo().run()}><Redo2 /></Tool>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">
        <div className="document-prose mx-auto w-full max-w-full" style={style}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});

function Tool({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className={cn("size-11 md:size-8", pressed && "bg-accent text-foreground")}
      aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
