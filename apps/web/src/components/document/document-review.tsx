"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { DocumentVerification } from "@/components/document-verification";
import { Button } from "@/components/ui/button";
import { citationKindLabel, citationStatusLabel, sourceHref, toReview } from "@/lib/citations/labels";
import type { CitationItem, CitationReview } from "@/lib/citations/verdict";

export type StoredCitations = { review: (CitationReview & { artifactVersion: number }) | null; version: number };

export type ArtifactReference = { id?: string; sourceLabel?: string; label?: string; locator?: string; excerpt?: string };
export type ValidationIssue = string | { message?: string; text?: string };

export const issueText = (issue: ValidationIssue) => typeof issue === "string" ? issue : issue.message ?? issue.text ?? "Verificação pendente";

/** Open issues, the evidence check and the sources behind the text: what to confirm before use. */
export function DocumentReview({ artifactId, version, dirty, status, issues, references, citations, rechecking, onRecheck }: {
  artifactId: string; version: number; dirty: boolean; status: string; issues: ValidationIssue[]; references: ArtifactReference[];
  citations: StoredCitations | null; rechecking: boolean; onRecheck: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <Citations citations={citations} version={version} rechecking={rechecking} onRecheck={onRecheck} />
      <section className="mt-8 border-t pt-5">
        <h2 className="font-medium">Verificações</h2>
        <p className="mt-1 text-xs text-muted-foreground">{status === "needs_review" ? "Revisão necessária antes do uso." : "Documento em edição."}</p>
        {issues.length === 0 ? <p className="mt-4 text-sm text-subtle-foreground">Nenhuma pendência registrada.</p> : (
          <div className="mt-3 divide-y">
            {issues.map((issue, index) => <p key={index} className="flex gap-2 py-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{issueText(issue)}</p>)}
          </div>
        )}
      </section>
      <DocumentVerification artifactId={artifactId} version={version} dirty={dirty} />
      <section className="mt-8 border-t pt-5">
        <h2 className="font-medium">Fontes</h2>
        {references.length === 0 ? <p className="mt-3 text-sm text-subtle-foreground">Nenhuma fonte vinculada.</p> : (
          <div className="mt-2 divide-y">
            {references.map((reference, index) => (
              <div key={reference.id ?? index} className="py-3 text-sm">
                <p className="font-medium">{reference.sourceLabel ?? reference.label ?? `Fonte ${index + 1}`}</p>
                {reference.locator && <p className="mt-0.5 text-xs text-muted-foreground">{reference.locator}</p>}
                {reference.excerpt && <p className="mt-2 line-clamp-4 leading-5 text-muted-foreground">{reference.excerpt}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Each legal citation the Lume wrote, checked against what its conversation consulted. The ones
 * that do not match a source, or that the source does not back, are the lawyer's to confirm.
 */
function Citations({ citations, version, rechecking, onRecheck }: { citations: StoredCitations | null; version: number; rechecking: boolean; onRecheck: () => void }) {
  const review = citations?.review ?? null;
  const items = review?.items ?? [];
  const pending = toReview(items);
  const stale = review && review.artifactVersion < version;
  const note = !review ? "As citações deste documento ainda não foram conferidas."
    : stale ? `Conferidas na versão ${review.artifactVersion}. O texto mudou desde então.`
    : review.status === "disabled" ? "O Jev está desligado: as citações só foram comparadas com as fontes consultadas, sem avaliar se sustentam o texto."
    : review.status !== "evaluated" ? "Parte das citações não pôde ser avaliada agora."
    : items.length === 0 ? "Nenhuma citação jurídica encontrada."
    : pending.length === 0 ? "Todas conferem com as fontes consultadas."
    : `${pending.length} de ${items.length} precisam de conferência.`;
  return (
    <section aria-labelledby="citations-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="citations-heading" className="font-medium">Citações</h2>
        <Button type="button" size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={rechecking} onClick={onRecheck}>
          {rechecking && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}Conferir de novo
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{note}</p>
      {items.length > 0 && (
        <div className="mt-3 divide-y border-y">
          {[...pending, ...items.filter((item) => item.status === "verified")].map((item) => <CitationRow key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function CitationRow({ item }: { item: CitationItem }) {
  const ok = item.status === "verified";
  return (
    <div className="grid gap-1 py-3 text-sm">
      <p className="font-medium">{item.text}</p>
      <p className={ok ? "text-[13px] text-muted-foreground" : "text-[13px] text-foreground"}>
        {item.kind ? `${citationKindLabel[item.kind]} · ` : ""}{citationStatusLabel[item.status]}
        {item.source && <> · {sourceHref(item.source.url)
          ? <a href={sourceHref(item.source.url)!} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline-offset-4 hover:underline">{item.source.title || "fonte"}<span className="sr-only"> (abre em nova aba)</span></a>
          : item.source.title}</>}
      </p>
      {!ok && <p className="line-clamp-2 text-[13px] leading-5 text-subtle-foreground">{item.paragraph}</p>}
    </div>
  );
}
