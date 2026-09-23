"use client";

import { CircleAlert } from "lucide-react";
import { DocumentVerification } from "@/components/document-verification";

export type ArtifactReference = { id?: string; sourceLabel?: string; label?: string; locator?: string; excerpt?: string };
export type ValidationIssue = string | { message?: string; text?: string };

export const issueText = (issue: ValidationIssue) => typeof issue === "string" ? issue : issue.message ?? issue.text ?? "Verificação pendente";

/** Open issues, the evidence check and the sources behind the text: what to confirm before use. */
export function DocumentReview({ artifactId, version, dirty, status, issues, references }: {
  artifactId: string; version: number; dirty: boolean; status: string; issues: ValidationIssue[]; references: ArtifactReference[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8">
      <section>
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
