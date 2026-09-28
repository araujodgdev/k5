'use client';

import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type MessageAttachmentProps = {
  filename: string;
  mimeType: string | null;
  url: string;
  downloadUrl?: string;
};

const wordMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function MessageAttachment({ filename, mimeType, url, downloadUrl = url }: MessageAttachmentProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const type = mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  const image = imageTypes.has(type);
  const audio = type.startsWith('audio/');
  const video = type.startsWith('video/');
  const document = type === 'application/pdf' || type === wordMime || type === 'text/plain';

  return <div className="mt-3 min-w-0 space-y-2 text-sm">
    <p className="break-words font-medium [overflow-wrap:anywhere]">{filename}</p>
    {!failed && image && <button type="button" className="block max-w-full outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={`Ampliar ${filename}`} onClick={() => setOpen(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={filename} loading="lazy" className="max-h-64 max-w-full object-contain" onError={() => setFailed(true)} />
    </button>}
    {!failed && audio && <audio controls preload="none" src={url} aria-label={filename} className="max-w-full" onError={() => setFailed(true)} />}
    {!failed && video && <video controls preload="metadata" src={url} aria-label={filename} className="max-h-72 max-w-full" onError={() => setFailed(true)} />}
    {failed && <p role="status" className="text-muted-foreground">Não foi possível carregar este anexo. O acesso pode ter sido removido.</p>}
    <div className="flex flex-wrap gap-2">
      {document && <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => setOpen(true)}><FileText aria-hidden="true" />Pré-visualizar</Button>}
      <Button variant="ghost" className="min-h-11 md:min-h-9" asChild><a href={downloadUrl} download={filename}><Download aria-hidden="true" />Baixar</a></Button>
    </div>
    {!image && !audio && !video && !document && <p className="text-xs text-muted-foreground">Pré-visualização indisponível para este formato.</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[90dvh] min-h-64 flex-col sm:max-w-4xl">
        <DialogTitle className="break-words pr-8">{filename}</DialogTitle>
        <DialogDescription className="sr-only">Pré-visualização do arquivo compartilhado na conversa.</DialogDescription>
        {open && <AttachmentPreview key={url} filename={filename} type={type} url={url} />}
      </DialogContent>
    </Dialog>
  </div>;
}

type Preview = { kind: 'loading' } | { kind: 'error' } | { kind: 'text'; text: string } | { kind: 'word'; html: string } | { kind: 'blob'; url: string };

function AttachmentPreview({ filename, type, url }: { filename: string; type: string; url: string }) {
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('attachment_unavailable');
        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type) throw new Error('preview_unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (type === 'text/plain') {
          const text = await blob.slice(0, 300_000).text();
          if (!controller.signal.aborted) setPreview({ kind: 'text', text });
        } else if (type === wordMime) {
          const { renderAsync } = await import('docx-preview');
          const container = document.createElement('div');
          await renderAsync(blob, container, container, { useBase64URL: true, renderAltChunks: false, renderComments: false, renderFootnotes: false, renderEndnotes: false });
          if (!controller.signal.aborted) setPreview({ kind: 'word', html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${container.innerHTML}</body></html>` });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: 'blob', url: objectUrl });
        }
      } catch {
        if (!controller.signal.aborted) setPreview({ kind: 'error' });
      }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [type, url]);

  if (preview.kind === 'loading') return <p role="status" className="py-8 text-muted-foreground">Carregando pré-visualização…</p>;
  if (preview.kind === 'error') return <p role="alert" className="py-8 text-destructive">Não foi possível abrir o arquivo. Confira seu acesso e tente novamente.</p>;
  if (preview.kind === 'text') return <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words text-sm">{preview.text}</pre>;
  if (preview.kind === 'word') return <iframe sandbox="" srcDoc={preview.html} title={filename} className="h-[70dvh] w-full border-0 bg-white" />;
  if (type === 'application/pdf') return <iframe src={preview.url} title={filename} className="h-[70dvh] w-full border-0" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={preview.url} alt={filename} className="min-h-0 max-w-full object-contain" />;
}
