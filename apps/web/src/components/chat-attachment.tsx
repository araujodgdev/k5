"use client";
import { FileText, X } from 'lucide-react';
import type { ChatAttachment } from '@/lib/chat-attachment-contract';

export function ChatAttachmentView({data,onRemove}:{data:ChatAttachment;onRemove?:()=>void}) {
  const href=`/api/chat/attachments/${encodeURIComponent(data.id)}`;
  return <div className="relative min-w-0 max-w-full rounded-xl border bg-background p-2 text-foreground">
    <a href={href} target="_blank" rel="noreferrer" className="flex min-h-11 max-w-full items-center gap-2 rounded-md pr-6 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Abrir anexo ${data.name}`}>
      {data.mediaType.startsWith('image/') ? <img src={href} alt={data.name} className="h-24 w-28 shrink-0 rounded-md object-cover" /> /* eslint-disable-line @next/next/no-img-element */
        : <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="min-w-0 text-xs"><span className="block max-w-40 truncate">{data.name}</span><span className="text-muted-foreground">{Math.max(1,Math.round(data.byteSize/1024))} KB</span></span>
    </a>
    {onRemove&&<button type="button" onClick={onRemove} className="absolute right-0 top-0 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remover anexo ${data.name}`}><X className="size-4" /></button>}
  </div>;
}
