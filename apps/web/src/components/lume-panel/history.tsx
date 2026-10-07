"use client";

import { Trash2 } from "lucide-react";
import { formatConversationTime } from "@/lib/conversation-time";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Conversation = { id: string; title: string; updatedAt: string };

/** The person's conversations, newest first. Choosing one opens it; the bin deletes it. */
export function ConversationList({ conversations, selectedId, loading, onSelect, onDelete, className }: {
  conversations: Conversation[];
  selectedId: string | null;
  loading?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  if (loading && !conversations.length) {
    return <div className={cn("grid gap-1 p-2", className)} aria-hidden="true">
      {[0, 1, 2].map((key) => <Skeleton key={key} className="h-12 w-full rounded-md" />)}
    </div>;
  }
  if (!conversations.length) return <p className={cn("px-2 py-6 text-sm text-muted-foreground", className)}>Seu histórico aparecerá aqui.</p>;
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {conversations.map((conversation) => {
        const title = conversation.title || "Nova conversa";
        const current = selectedId === conversation.id;
        return (
          <li key={conversation.id} className="group/row relative">
            <button type="button" onClick={() => onSelect(conversation.id)} aria-current={current ? "true" : undefined}
              className={cn("flex min-h-11 w-full items-center gap-3 rounded-md py-2 pr-11 pl-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-12",
                current && "bg-selected hover:bg-selected")}>
              <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
              {/* Relative labels can cross a minute boundary while the HTML is in transit. */}
              <span suppressHydrationWarning className="shrink-0 font-mono text-[12.5px] text-muted-foreground">{formatConversationTime(conversation.updatedAt)}</span>
            </button>
            <button type="button" onClick={() => onDelete(conversation.id)} aria-label={`Excluir ${title}`}
              className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground opacity-0 outline-none transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 max-md:size-11 max-md:opacity-100">
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
