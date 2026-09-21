"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, CircleAlert } from "lucide-react";
import { DocumentRows, UploadControl, usePolledDocuments } from "@/components/vault-files";
import type { OfficeRole } from "@/lib/offices";
import type { VaultDocument } from "@/lib/vault";

/** Everything that belongs to the office but not to a case: models, templates, loose material. */
export function VaultLibrary({ initialDocuments, role }: { initialDocuments: VaultDocument[]; role: OfficeRole }) {
  const { documents, setDocuments } = usePolledDocuments("scope=library", initialDocuments);
  const [failure, setFailure] = useState("");
  const canWrite = role !== "reviewer";

  return <div className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
    <nav aria-label="Trilha" className="flex items-center gap-1 text-sm text-muted-foreground" data-reveal>
      <Link href="/app/vault" className="rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cofre</Link>
      <ChevronRight className="size-3.5" aria-hidden="true" />
      <span aria-current="page">Biblioteca</span>
    </nav>

    <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b pb-5" data-reveal>
      <h1 className="display text-[28px] leading-none">Biblioteca</h1>
      <UploadControl canWrite={canWrite} scope="library" onError={setFailure} onUploaded={(document) => setDocuments((current) => [document, ...current])} />
    </div>

    {!canWrite && <p className="mt-5 border-b pb-5 text-sm text-muted-foreground">Seu papel permite consultar e baixar documentos.</p>}
    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-5 min-h-0 overflow-auto">
      <DocumentRows
        documents={documents}
        canWrite={canWrite}
        onError={setFailure}
        onRetried={(documentId) => setDocuments((current) => current.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))}
        onDeleted={(documentId) => setDocuments((current) => current.filter((item) => item.id !== documentId))}
        empty="Nenhum arquivo na biblioteca."
      />
    </div>
  </div>;
}
