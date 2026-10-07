"use client";

import { useRef, useState, useSyncExternalStore, type ComponentType, type SVGProps } from "react";
import { AuiIf, ComposerPrimitive, useAui } from "@assistant-ui/react";
import { ArrowUp, Camera, FileText, Image as ImageIcon, LoaderCircle, Mic, Plus, Square, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatCamera } from "@/components/chat-camera";
import { ChatAttachmentView } from "@/components/chat-attachment";
import { useVoiceRecorder, VoiceLevel } from "@/components/voice-recorder";
import { DOCUMENT_ACCEPT, IMAGE_ACCEPT, type Modalities } from "@/lib/ai-modalities";
import type { ChatAttachment } from "@/lib/chat-attachment-contract";
import { cn } from "@/lib/utils";

export type ComposerToolsProps = {
  modalities: Modalities;
  /** Files still on their way to the server. */
  uploading: number;
  onPickFiles: (files: File[]) => void;
  onError: (message: string) => void;
  pendingFiles: ChatAttachment[];
  onRemoveFile: (id: string) => void;
  contextReady: boolean;
  contextLabel: string;
  runningTarget: string | null;
};

export type ComposerChip = { label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

type Voice = ReturnType<typeof useVoiceRecorder>;

const PHONE = "(max-width: 767px)";
const subscribePhone = (onChange: () => void) => {
  const media = window.matchMedia(PHONE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const control = "grid size-[30px] shrink-0 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-auto disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent max-md:size-10";
const round = "grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-[.88] focus-visible:ring-3 focus-visible:ring-ring/50 max-md:size-10";
const menuItem = "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:text-subtle-foreground disabled:hover:bg-transparent md:min-h-9";

/** A control that stays visible when the model cannot do the thing, and says why. */
function HintedControl({ hint, children }: { hint?: string; children: React.ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{children}</span></TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function AttachMenu({ modalities, uploading, onPickFiles, voice }: ComposerToolsProps & { voice: Voice }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState(DOCUMENT_ACCEPT);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const imageHint = modalities.image ? undefined : "O Lume não lê imagens nesta configuração.";

  function pick(kind: "document" | "image") {
    setAccept(kind === "image" ? IMAGE_ACCEPT : DOCUMENT_ACCEPT);
    setMenuOpen(false);
    // The accept attribute has to be applied before the dialog opens.
    window.setTimeout(() => fileInput.current?.click(), 0);
  }

  return <>
    <input ref={fileInput} type="file" aria-label="Arquivo para anexar" accept={accept} className="sr-only" multiple
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        if (files.length) onPickFiles(files);
      }} />
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={control} aria-label="Anexar arquivos" disabled={voice.state !== "idle"}>
          {uploading > 0 ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Plus className="size-4" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-1">
        <HintedControl hint={imageHint}>
          <button type="button" onClick={() => { setMenuOpen(false); setCameraOpen(true); }} disabled={!modalities.image} className={menuItem}><Camera className="size-4 text-muted-foreground" aria-hidden="true" />Tirar foto</button>
        </HintedControl>
        <button type="button" onClick={() => pick("document")} className={menuItem}><FileText className="size-4 text-muted-foreground" aria-hidden="true" />Documento ou planilha</button>
        <HintedControl hint={imageHint}>
          <button type="button" onClick={() => pick("image")} disabled={!modalities.image} className={menuItem}><ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />Escolher imagem</button>
        </HintedControl>
      </PopoverContent>
    </Popover>
    {cameraOpen && <ChatCamera onClose={() => setCameraOpen(false)} onPhoto={(file) => onPickFiles([file])} />}
  </>;
}

/** What the canvas shows, so the person knows what "isto" means to the Lume. */
function ContextChip({ chip }: { chip: ComposerChip }) {
  const Icon = chip.icon;
  return (
    <span title="O Lume vê o que está aberto no canvas" className="inline-flex h-[26px] max-w-[250px] min-w-0 items-center gap-1.5 rounded-sm bg-muted px-[9px] text-[12.5px] text-muted-foreground max-md:h-7 max-md:max-w-[190px] max-md:rounded-md">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate"><span className="sr-only">O Lume vê: </span>{chip.label}</span>
    </span>
  );
}

/**
 * The Lume's composer: the text, attachments, what the Lume sees, the microphone and send. A spoken
 * message joins whatever was typed and goes out as the person's own words.
 */
export function Composer({ tools, chip }: { tools: ComposerToolsProps; chip?: ComposerChip | null }) {
  const aui = useAui();
  const voice = useVoiceRecorder({
    onError: tools.onError,
    onText: (spoken) => {
      const composer = aui.composer();
      const typed = composer.getState().text.trim();
      composer.setText(typed ? `${typed}\n\n${spoken}` : spoken);
      // While a reply or an upload is still running, it waits in the composer instead.
      if (!aui.thread().getState().isRunning && !tools.uploading && tools.contextReady) composer.send();
    },
  });
  const audioHint = tools.modalities.audio ? undefined : "O Lume não aceita áudio nesta configuração.";
  // A phone gives the conversation the height: the composer starts at one line there.
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-1.5 rounded-[14px] border border-border-strong bg-card pt-2.5 pr-2.5 pb-2 pl-3.5 transition-colors focus-within:border-ring max-md:rounded-[18px]">
      {tools.pendingFiles.length > 0 && <div className="flex flex-wrap gap-2 pt-1" aria-label="Anexos da próxima mensagem">{tools.pendingFiles.map((file) => <ChatAttachmentView key={file.id} data={file} onRemove={() => tools.onRemoveFile(file.id)} />)}</div>}
      {tools.uploading > 0 && <p role="status" className="text-xs text-muted-foreground">{tools.uploading === 1 ? "Preparando anexo…" : `Preparando ${tools.uploading} anexos…`}</p>}
      {voice.state === "transcribing" && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />Transcrevendo áudio…</p>}
      {tools.runningTarget && <p role="status" className="text-xs text-muted-foreground">Pedido em andamento · {tools.runningTarget}</p>}
      <ComposerPrimitive.Input minRows={phone ? 1 : 2} maxRows={10} placeholder="Pergunte ao Lume" aria-label="Pergunte ao Lume"
        onKeyDownCapture={event => { if (event.key === 'Enter' && !event.shiftKey && !tools.contextReady) { event.preventDefault(); event.stopPropagation(); } }}
        className="max-h-[25dvh] w-full resize-none bg-transparent py-0.5 text-[14.5px] leading-normal text-foreground outline-none placeholder:text-subtle-foreground max-md:text-base" />
      <div className="flex items-center gap-1">
        <AttachMenu {...tools} voice={voice} />
        {voice.state === "recording" ? <VoiceLevel analyser={voice.analyser} seconds={voice.seconds} /> : <span aria-label="Contexto da próxima mensagem" className="min-w-0" title={tools.contextLabel}>{tools.contextReady && chip ? <ContextChip chip={chip} /> : <span className="text-xs text-muted-foreground">Carregando contexto do canvas…</span>}</span>}
        <span className="flex-1" />
        {voice.state === "recording" ? (
          <button type="button" onClick={voice.cancel} aria-label="Descartar gravação" title="Descartar gravação" className={control}><Trash2 className="size-4" /></button>
        ) : (
          <HintedControl hint={audioHint}>
            <button type="button" onClick={() => void voice.start()} disabled={!tools.modalities.audio || voice.state !== "idle"} aria-label="Gravar áudio" title="Gravar áudio" className={control}><Mic className="size-4" /></button>
          </HintedControl>
        )}
        {voice.state === "recording" ? (
          <button type="button" onClick={voice.finish} className={round} aria-label="Parar gravação e enviar" title="Parar gravação e enviar"><Square className="size-3.5 fill-current" /></button>
        ) : voice.state === "transcribing" ? (
          <span className={cn(round, "opacity-40")} aria-hidden="true"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /></span>
        ) : <>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel className={round} aria-label="Parar resposta"><Square className="size-3.5 fill-current" /></ComposerPrimitive.Cancel>
          </AuiIf>
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <ComposerPrimitive.Send disabled={tools.uploading > 0 || !tools.contextReady} className={cn(round, "disabled:cursor-default", (tools.uploading > 0 || !tools.contextReady) && "opacity-40")} aria-label="Enviar mensagem"><ArrowUp className="size-4" /></ComposerPrimitive.Send>
          </AuiIf>
        </>}
      </div>
    </ComposerPrimitive.Root>
  );
}
