"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import type { AiConnectionView } from "@/lib/ai-connections-core";
import {
  DEFAULT_REASONING_EFFORT, MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, PROFILE_DEFINITIONS, REASONING_EFFORTS,
  type ProfileOverrideView, type ProfileVariant, type ProfileVariantView, type ReasoningEffort,
} from "@/lib/ai-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// 44px controls on touch, default height from md up.
const touch = "h-11 md:h-9";
const INHERIT = "inherit";

/** What a step uses when it has no settings of its own: the task's model, shown so the choice is informed. */
export type InheritedModel = { connectionName: string; modelId: string; provider: string } | null;

type Draft = { connectionId: string; modelId: string; reasoningEffort: string; maxOutputTokens: string };
type VariantDraft = { connectionId: string; modelId: string; reasoningEffort: string };

const toDraft = (item: ProfileOverrideView): Draft => ({
  connectionId: item.connectionId ?? INHERIT, modelId: item.modelId ?? "",
  reasoningEffort: item.reasoningEffort ?? INHERIT, maxOutputTokens: item.maxOutputTokens ? String(item.maxOutputTokens) : "",
});
const toVariantDraft = (item: ProfileVariantView | null): VariantDraft =>
  ({ connectionId: item?.connectionId ?? INHERIT, modelId: item?.modelId ?? "", reasoningEffort: item?.reasoningEffort ?? INHERIT });
const variantBody = (draft: VariantDraft) => draft.connectionId === INHERIT || !draft.modelId.trim() ? null
  : { connectionId: draft.connectionId, modelId: draft.modelId.trim(), reasoningEffort: draft.reasoningEffort === INHERIT ? null : draft.reasoningEffort as ReasoningEffort };

const variantLabels: Record<ProfileVariant, { title: string; hint: string }> = {
  escalate: { title: "Modelo de escalonamento", hint: "Refaz o trecho quando a conferência do código reprova o resultado." },
  shadow: { title: "Modelo em sombra", hint: "Roda junto para comparação; só o uso é registrado, o resultado não entra na cronologia." },
};

/**
 * Per-step settings under the Lume's model. A step left alone keeps inheriting that model and the
 * default reasoning effort, so nothing changes until the administrator sets something here.
 */
export function AiProfileSettings({ profiles, connections, inherited }: {
  profiles: ProfileOverrideView[];
  connections: AiConnectionView[];
  inherited: Record<string, InheritedModel>;
}) {
  const [open, setOpen] = useState(profiles.some((item) => item.updatedAt));
  const active = connections.filter((connection) => connection.enabled);
  return <section className="mt-8 border-b pb-8" aria-labelledby="ai-profiles-title">
    <button type="button" id="ai-profiles-title" aria-expanded={open} aria-controls="ai-profiles-rows" onClick={() => setOpen((value) => !value)}
      className="flex min-h-11 w-fit items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8">
      <ChevronRight className={`size-4 transition-transform duration-200 ease-(--ease) ${open ? "rotate-90" : ""}`} aria-hidden="true" />Ajustes por etapa
    </button>
    <p className="mt-1 text-sm text-muted-foreground">Sem ajuste, cada etapa usa o modelo do Lume e o esforço de raciocínio {DEFAULT_REASONING_EFFORT}. Uma mudança vale para as execuções iniciadas depois dela.</p>
    {open && <div id="ai-profiles-rows" className="mt-4">
      {!active.length && <p className="py-4 text-sm text-subtle-foreground">Ative uma conexão para ajustar as etapas.</p>}
      {active.length > 0 && profiles.map((item) => <ProfileRow key={`${item.profile}:${item.updatedAt ?? "default"}`} item={item} connections={active} inherited={inherited[item.profile] ?? null} />)}
    </div>}
  </section>;
}

function ProfileRow({ item, connections, inherited }: { item: ProfileOverrideView; connections: AiConnectionView[]; inherited: InheritedModel }) {
  const router = useRouter();
  const id = useId();
  const definition = PROFILE_DEFINITIONS[item.profile];
  const [draft, setDraft] = useState(() => toDraft(item));
  const [variants, setVariants] = useState<Record<ProfileVariant, VariantDraft>>(() => ({ escalate: toVariantDraft(item.escalate), shadow: toVariantDraft(item.shadow) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const chosen = connections.find((connection) => connection.id === draft.connectionId);
  const provider = chosen?.provider ?? inherited?.provider;

  async function send(body: object, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/ai/profiles/${item.profile}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Não foi possível salvar a etapa.");
      setNotice(message);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a etapa.");
    } finally { setBusy(false); }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const own = draft.connectionId !== INHERIT && draft.modelId.trim();
    if (draft.connectionId !== INHERIT && !draft.modelId.trim()) { setError("Informe o modelo da conexão escolhida."); return; }
    void send({
      connectionId: own ? draft.connectionId : null, modelId: own ? draft.modelId.trim() : null,
      reasoningEffort: draft.reasoningEffort === INHERIT ? null : draft.reasoningEffort,
      maxOutputTokens: draft.maxOutputTokens ? Number(draft.maxOutputTokens) : null,
      ...Object.fromEntries(definition.variants.map((variant) => [variant, variantBody(variants[variant])])),
    }, "Etapa atualizada.");
  }

  const reset = () => void send({ connectionId: null, modelId: null, reasoningEffort: null, maxOutputTokens: null,
    ...Object.fromEntries(definition.variants.map((variant) => [variant, null])) }, "Etapa voltou ao padrão.");

  const current = item.connectionId
    ? `${connections.find((connection) => connection.id === item.connectionId)?.name ?? "Conexão desativada"} · ${item.modelId}`
    : inherited ? `Modelo do Lume · ${inherited.modelId}` : "Modelo do Lume";
  const effort = item.reasoningEffort ?? DEFAULT_REASONING_EFFORT;

  return <form onSubmit={save} aria-busy={busy} aria-labelledby={`${id}-title`} className="grid gap-4 border-t py-6">
    <div>
      <h4 id={`${id}-title`} className="font-medium">{definition.label}</h4>
      <p className="text-sm text-muted-foreground">{definition.description}</p>
      <p className="mt-1 label-mono text-subtle-foreground">{current} · esforço {effort} · até {(item.maxOutputTokens ?? definition.maxOutputTokens).toLocaleString("pt-BR")} tokens</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <ConnectionField id={`${id}-connection`} label="Conexão" value={draft.connectionId} connections={connections} disabled={busy}
        onChange={(value) => setDraft({ ...draft, connectionId: value, modelId: value === INHERIT ? "" : draft.modelId })} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-model`}>ID do modelo</Label>
        <Input id={`${id}-model`} className={touch} value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
          disabled={busy || draft.connectionId === INHERIT} maxLength={160} autoComplete="off" spellCheck={false} placeholder={draft.connectionId === INHERIT ? "Herdado" : "Ex.: gpt-6-luna"} />
      </div>
      <EffortField id={`${id}-effort`} value={draft.reasoningEffort} disabled={busy} provider={provider} onChange={(value) => setDraft({ ...draft, reasoningEffort: value })} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-tokens`}>Limite de saída (tokens)</Label>
        <Input id={`${id}-tokens`} className={touch} type="number" inputMode="numeric" min={MIN_OUTPUT_TOKENS} max={MAX_OUTPUT_TOKENS} step={1} value={draft.maxOutputTokens}
          onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value })} disabled={busy} placeholder={String(definition.maxOutputTokens)} />
      </div>
    </div>
    {definition.variants.map((variant) => {
      const value = variants[variant];
      const variantProvider = connections.find((connection) => connection.id === value.connectionId)?.provider;
      return <fieldset key={variant} className="grid gap-4 border-t pt-4" disabled={busy}>
        <legend className="sr-only">{variantLabels[variant].title}</legend>
        <p className="text-sm"><span className="font-medium">{variantLabels[variant].title}.</span> <span className="text-muted-foreground">{variantLabels[variant].hint}</span></p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ConnectionField id={`${id}-${variant}-connection`} label="Conexão" value={value.connectionId} connections={connections} inheritLabel="Nenhum" disabled={busy}
            onChange={(next) => setVariants({ ...variants, [variant]: { ...value, connectionId: next, modelId: next === INHERIT ? "" : value.modelId } })} />
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-${variant}-model`}>ID do modelo</Label>
            <Input id={`${id}-${variant}-model`} className={touch} value={value.modelId} disabled={busy || value.connectionId === INHERIT} maxLength={160} autoComplete="off" spellCheck={false}
              onChange={(event) => setVariants({ ...variants, [variant]: { ...value, modelId: event.target.value } })} placeholder={value.connectionId === INHERIT ? "Sem segundo modelo" : "Ex.: gpt-6-sol"} />
          </div>
          <EffortField id={`${id}-${variant}-effort`} value={value.reasoningEffort} disabled={busy || value.connectionId === INHERIT} provider={variantProvider}
            onChange={(next) => setVariants({ ...variants, [variant]: { ...value, reasoningEffort: next } })} />
        </div>
      </fieldset>;
    })}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" className={touch} disabled={busy}>{busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}Salvar etapa</Button>
      {item.updatedAt && <Button type="button" variant="ghost" className={touch} disabled={busy} onClick={reset}>Voltar ao padrão</Button>}
      {notice && <span role="status" className="text-sm text-muted-foreground">{notice}</span>}
    </div>
    {error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
  </form>;
}

function ConnectionField({ id, label, value, connections, onChange, disabled, inheritLabel = "Herdar do Lume" }: {
  id: string; label: string; value: string; connections: AiConnectionView[]; onChange: (value: string) => void; disabled: boolean; inheritLabel?: string;
}) {
  return <div className="grid gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {connections.map((connection) => <SelectItem key={connection.id} value={connection.id}>{connection.name}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}

/** Only OpenAI takes a reasoning effort today; for other providers the field says so instead of vanishing. */
function EffortField({ id, value, onChange, disabled, provider }: { id: string; value: string; onChange: (value: string) => void; disabled: boolean; provider?: string }) {
  const applies = !provider || provider === "openai";
  return <div className="grid gap-1.5">
    <Label htmlFor={id}>Esforço de raciocínio</Label>
    <Select value={value} disabled={disabled || !applies} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-describedby={applies ? undefined : `${id}-note`}><SelectValue /></SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={INHERIT}>Padrão ({DEFAULT_REASONING_EFFORT})</SelectItem>
        {REASONING_EFFORTS.map((effort) => <SelectItem key={effort} value={effort}>{effort}</SelectItem>)}
      </SelectContent>
    </Select>
    {!applies && <p id={`${id}-note`} className="text-xs text-subtle-foreground">Só vale para conexões OpenAI.</p>}
  </div>;
}
