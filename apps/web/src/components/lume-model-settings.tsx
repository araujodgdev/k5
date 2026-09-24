"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai-defaults";
import type { AiConnectionView, AiProvider } from "@/lib/ai-connections-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LumeModelSelection = { connectionId: string; modelId: string } | null;

/** The model the Lume answers with, in every office: one connection and one model ID. */
export function LumeModelSettings({ connections, catalog, initialSelection }: {
  connections: AiConnectionView[];
  catalog: Record<AiProvider, string[]>;
  initialSelection: LumeModelSelection;
}) {
  const router = useRouter();
  const active = connections.filter((connection) => connection.enabled);
  const first = active[0];
  const [connectionId, setConnectionId] = useState(initialSelection?.connectionId ?? first?.id ?? "");
  const [modelId, setModelId] = useState(initialSelection?.modelId ?? (first ? DEFAULT_CHAT_MODEL[first.provider] : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = active.find((connection) => connection.id === connectionId);
  const suggestions = selected ? catalog[selected.provider] : [];
  const listedValue = suggestions.includes(modelId) ? modelId : "custom";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !modelId.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/ai/connections/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ models: {
          chat: modelId.trim(), extraction: modelId.trim(), drafting: modelId.trim(),
        } }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível salvar o modelo.");
      setModelId(modelId.trim());
      setNotice("Modelo do Lume atualizado.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="border-b pb-8" aria-labelledby="lume-model-title">
    <h3 id="lume-model-title" className="font-medium">Modelo do Lume</h3>
    <p className="mt-1 text-sm text-muted-foreground">Usado nas conversas, cronologias e minutas de todos os escritórios.</p>
    {!first ? <p className="mt-5 text-sm text-subtle-foreground">Cadastre e ative uma conexão para escolher o modelo.</p> : (
      <form onSubmit={save} aria-busy={busy} className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="lume-connection">Conexão</Label>
          <Select value={connectionId} disabled={busy} onValueChange={(value) => {
            const connection = active.find((item) => item.id === value);
            setConnectionId(value);
            setModelId(connection?.models.chat ?? (connection ? DEFAULT_CHAT_MODEL[connection.provider] : ""));
            setError(""); setNotice("");
          }}><SelectTrigger id="lume-connection" className="w-full"><SelectValue /></SelectTrigger><SelectContent position="popper">{active.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lume-model-list">Escolher da lista</Label>
          <Select value={listedValue} disabled={busy} onValueChange={(value) => setModelId(value === "custom" ? "" : value)}>
            <SelectTrigger id="lume-model-list" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              {suggestions.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
              <SelectItem value="custom">ID digitado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="lume-model-id">ID do modelo</Label>
          <Input id="lume-model-id" className="h-11 md:h-9" value={modelId} onChange={(event) => setModelId(event.target.value)} maxLength={160} required disabled={busy} autoComplete="off" spellCheck={false} placeholder="Ex.: gpt-6-sol" />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" className="h-11 md:h-9" disabled={busy || !selected || !modelId.trim()}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar modelo</Button>
          {notice && <span role="status" className="text-sm text-muted-foreground">{notice}</span>}
        </div>
        {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive sm:col-span-2"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
      </form>
    )}
  </section>;
}
