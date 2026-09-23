"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, FileText, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TemplateCandidate, TemplateScope, TemplateView } from "@/lib/agent-profile";
import { AgentRules, type RulesState } from "@/components/agent-rules";
import { AgentKnowledge, type KnowledgeState } from "@/components/agent-knowledge";
import type { KnowledgeCandidate } from "@/lib/agent-knowledge";

type Templates = { office: TemplateView | null; personal: TemplateView | null; canEditOffice: boolean; canEditPersonal: boolean };

const statusLabel: Record<string, string> = { queued: "Na fila", processing: "Processando", ready: "Pronto", failed: "Falhou no processamento" };

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function AgentSettings({ initialTemplates, initialCandidates, initialRules, initialKnowledge, knowledgeCandidates }: {
  initialTemplates: Templates; initialCandidates: TemplateCandidate[]; initialRules: RulesState;
  initialKnowledge: KnowledgeState; knowledgeCandidates: KnowledgeCandidate[];
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [candidates, setCandidates] = useState(initialCandidates);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-10 md:py-10">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 size-11 md:size-9" aria-label="Voltar ao Lume"><Link href="/app/agents"><ArrowLeft /></Link></Button>
        <h1 className="page-title">Personalizar Lume</h1>
      </div>

      <AgentRules initial={initialRules} />

      <AgentKnowledge initial={initialKnowledge} initialCandidates={knowledgeCandidates} />

      <section aria-labelledby="template-heading" className="mt-10 border-t pt-8">
        <h2 id="template-heading" className="font-medium">Modelo de documento</h2>
        <p className="mt-1 text-sm text-muted-foreground">O Word com o timbrado do escritório. Documentos e minutas do Lume saem nele ao exportar, quando nenhum outro modelo foi escolhido.</p>
        <div className="mt-4 divide-y border-y">
          <TemplateRow scope="office" label="Do escritório" current={templates.office} editable={templates.canEditOffice}
            readOnlyNote="Definido pela administração do escritório." candidates={candidates}
            onChange={setTemplates} onUploaded={(document) => setCandidates((list) => [document, ...list])} />
          <TemplateRow scope="personal" label="Meu modelo" current={templates.personal} editable={templates.canEditPersonal}
            readOnlyNote="Seu papel permite apenas consultas." note="Quando definido, vale no lugar do modelo do escritório para os seus documentos."
            candidates={candidates} onChange={setTemplates} onUploaded={(document) => setCandidates((list) => [document, ...list])} />
        </div>
      </section>
    </div>
  );
}

function TemplateRow({ scope, label, note, readOnlyNote, current, editable, candidates, onChange, onUploaded }: {
  scope: TemplateScope;
  label: string;
  note?: string;
  readOnlyNote: string;
  current: TemplateView | null;
  editable: boolean;
  candidates: TemplateCandidate[];
  onChange: (templates: Templates) => void;
  onUploaded: (document: TemplateCandidate) => void;
}) {
  const [busy, setBusy] = useState<"" | "save" | "upload">("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const selectId = useId();

  async function choose(documentId: string | null) {
    setBusy("save");
    setError("");
    try {
      const response = await fetch("/api/agent/template", {
        method: "PUT", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ scope, documentId }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível salvar o modelo."));
      onChange(await response.json() as Templates);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o modelo.");
    } finally { setBusy(""); }
  }

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Envie o modelo em Word (.docx). PDF não preserva cabeçalho e rodapé editáveis.");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      // The file goes to the Cofre library like any other upload; the template only points at it.
      const form = new FormData();
      form.set("file", file);
      form.set("scope", "library");
      const response = await fetch("/api/vault/documents", { method: "POST", body: form, cache: "no-store" });
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível enviar o arquivo."));
      const { document } = await response.json() as { document: { id: string; name: string; status: string } };
      onUploaded({ id: document.id, name: document.name, status: document.status, caseName: null });
      await choose(document.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-3 py-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="mt-1 text-[13px] text-muted-foreground">{note}</p>}
      </div>
      <div className="min-w-0">
        {current ? (
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{current.name}</span>
            <span className="shrink-0 text-[13px] text-muted-foreground">· {statusLabel[current.status] ?? current.status}</span>
          </p>
        ) : <p className="text-sm text-subtle-foreground">{scope === "office" ? "Nenhum. Os documentos saem em Word sem timbrado." : "Nenhum. Vale o modelo do escritório."}</p>}

        {editable ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="sr-only">Escolher do Cofre</label>
            <select id={selectId} value="" disabled={Boolean(busy) || candidates.length === 0}
              onChange={(event) => { if (event.target.value) void choose(event.target.value); }}
              className="h-11 min-w-0 max-w-full flex-1 rounded-md border bg-background px-3 text-sm md:h-9 md:max-w-72">
              <option value="">{candidates.length ? "Escolher do Cofre" : "Nenhum .docx no Cofre"}</option>
              {candidates.filter((item) => item.id !== current?.documentId).map((item) => (
                <option key={item.id} value={item.id}>{item.caseName ? `${item.name} · ${item.caseName}` : item.name}</option>
              ))}
            </select>
            <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" tabIndex={-1}
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
            <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              {busy === "upload" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload aria-hidden="true" />}Enviar .docx
            </Button>
            {current && <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" disabled={Boolean(busy)} onClick={() => void choose(null)}>Remover</Button>}
            {busy === "save" && <span role="status" className="text-[13px] text-muted-foreground">Salvando…</span>}
          </div>
        ) : <p className="mt-2 text-[13px] text-muted-foreground">{readOnlyNote}</p>}

        {error && <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      </div>
    </div>
  );
}
