"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { NotificationView } from "@/lib/notifications/contracts";
import { cn } from "@/lib/utils";

type Page = { notifications: NotificationView[]; nextCursor: string | null };
type Tab = "new" | "archived";

function readError(response: Response, fallback: string) {
  return response.json().then((value: { error?: string }) => value.error || fallback).catch(() => fallback);
}
const timeLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** The bell beside Instalar. The unread count rides on it as a brand dot and in its label. */
export const NotificationTrigger = forwardRef<HTMLButtonElement, { unread: number; onOpen: (opener: HTMLElement) => void; className?: string }>(
  function NotificationTrigger({ unread, onOpen, className }, ref) {
    const label = unread > 0 ? `Notificações, ${unread} não ${unread === 1 ? "lida" : "lidas"}` : "Notificações";
    return <Button ref={ref} variant="ghost" size="icon" onClick={event => onOpen(event.currentTarget)} aria-label={label} title={label}
      className={cn("relative size-11 text-muted-foreground hover:text-foreground md:size-9", className)}>
      <Bell aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" className="absolute top-2 right-2 size-1.5 rounded-full bg-brand" />}
    </Button>;
  });

/**
 * Notifications as a panel beside the menu: what is new, and what was already read or archived.
 * Reading or archiving moves an item out of "Novas"; preferences live elsewhere.
 */
export function NotificationPanel({ open, onOpenChange, onCloseFocus }: { open: boolean; onOpenChange: (open: boolean) => void; onCloseFocus: () => void }) {
  const [tab, setTab] = useState<Tab>("new");
  const [items, setItems] = useState<NotificationView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const channel = useRef<BroadcastChannel | null>(null);

  const load = useCallback(async (view: Tab, cursor?: string) => {
    if (!navigator.onLine) { setError("Sem conexão. As notificações serão atualizadas quando você voltar."); return; }
    setError("");
    if (cursor) setLoadingMore(true); else setLoading(true);
    const params = new URLSearchParams(view === "new" ? { unreadOnly: "true", limit: "25" } : { archived: "true", limit: "25" });
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Não foi possível carregar as notificações."));
      const page = await response.json() as Page;
      setItems(current => cursor ? [...current, ...page.notifications] : page.notifications);
      setNextCursor(page.nextCursor);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Não foi possível carregar as notificações.");
    } finally { setLoading(false); setLoadingMore(false); }
  }, []);

  // Opening the panel starts on "Novas" with a fresh list.
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) { setTab("new"); setItems([]); setNextCursor(null); setLoading(true); }
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(tab), 0);
    const refresh = () => void load(tab);
    const onWorkerMessage = (event: MessageEvent) => { if (event.data?.type === "K5_NOTIFICATION") refresh(); };
    channel.current = "BroadcastChannel" in window ? new BroadcastChannel("k5-notifications") : null;
    channel.current?.addEventListener("message", refresh);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    return () => {
      window.clearTimeout(timer);
      channel.current?.close(); channel.current = null;
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    };
  }, [open, tab, load]);

  function changeTab(next: Tab) {
    if (next === tab) return;
    setTab(next); setItems([]); setNextCursor(null); setLoading(true);
  }

  async function write(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST", headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readError(response, "Não foi possível salvar a alteração."));
    // Other tabs and the menu's unread count follow.
    channel.current?.postMessage({ type: "changed" });
  }

  async function archive(item: NotificationView) {
    setBusy(item.id); setError("");
    try { await write(`/api/notifications/${encodeURIComponent(item.id)}/archive`); setItems(current => current.filter(({ id }) => id !== item.id)); }
    catch (value) { setError(value instanceof Error ? value.message : "Não foi possível arquivar."); }
    finally { setBusy(null); }
  }

  async function archiveAll() {
    const first = items[0];
    if (!first) return;
    setBusy("all"); setError("");
    try { await write("/api/notifications/read-all", { createdAt: first.createdAt, id: first.id }); await load("new"); }
    catch (value) { setError(value instanceof Error ? value.message : "Não foi possível arquivar as notificações."); }
    finally { setBusy(null); }
  }

  const tabStyle = (active: boolean) => cn("min-h-11 border-b-2 px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-10",
    active ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground");

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent overlayClassName="bg-overlay/20"
      className="notification-panel top-auto right-2 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+.5rem)] left-2 flex max-h-[calc(100dvh-6rem)] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 p-0 sm:max-w-none md:right-auto md:max-h-[min(36rem,calc(100dvh-1.5rem))] md:w-[26rem] data-open:slide-in-from-bottom-3 data-open:zoom-in-100 data-closed:zoom-out-100"
      onCloseAutoFocus={event => { event.preventDefault(); onCloseFocus(); }}>
      <div className="px-5 pt-5 pr-12"><DialogTitle className="font-sans text-base font-medium">Notificações</DialogTitle></div>
      <div className="flex items-center gap-5 border-b px-5">
        <button type="button" aria-pressed={tab === "new"} onClick={() => changeTab("new")} className={tabStyle(tab === "new")}>Novas</button>
        <button type="button" aria-pressed={tab === "archived"} onClick={() => changeTab("archived")} className={tabStyle(tab === "archived")}>Arquivadas</button>
        {tab === "new" && items.length > 1 && <Button variant="ghost" size="sm" className="ml-auto min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void archiveAll()}>{busy === "all" ? "Arquivando…" : "Arquivar todas"}</Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        {error && <p role="alert" className="py-4 text-sm text-destructive">{error}</p>}
        {loading ? <p role="status" className="py-8 text-sm text-subtle-foreground">Carregando notificações…</p>
          : items.length === 0 ? !error && <p className="py-10 text-center text-sm text-subtle-foreground">{tab === "new" ? "Nada novo por aqui." : "Nenhuma notificação arquivada."}</p>
          : <div>{items.map(item => <article key={item.id} className="flex items-start gap-2 border-b py-3 last:border-b-0">
            <a href={item.href} onClick={() => onOpenChange(false)} className="min-w-0 flex-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <h3 className={tab === "new" ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{item.title}</h3>
              {item.summary && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{item.summary}</p>}
              <p className="label-mono mt-1 text-subtle-foreground">{timeLabel.format(new Date(item.createdAt))}</p>
            </a>
            {tab === "new" && <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground md:size-8" disabled={busy !== null} onClick={() => void archive(item)} aria-label={`Arquivar ${item.title}`} title="Arquivar">
              {busy === item.id ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Archive aria-hidden="true" />}
            </Button>}
          </article>)}</div>}
        {nextCursor && !loading && <div className="py-3"><Button variant="outline" className="w-full" disabled={loadingMore} onClick={() => void load(tab, nextCursor)}>{loadingMore ? "Carregando…" : "Carregar mais"}</Button></div>}
      </div>
    </DialogContent>
  </Dialog>;
}
