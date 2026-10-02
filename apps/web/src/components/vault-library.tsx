"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrivePanel } from "@/components/google/drive-panel";
import { DocumentPagination, DocumentRows, UploadControl, usePolledDocuments } from "@/components/vault-files";
import type { VaultDocument } from "@/lib/vault";

/** Everything that belongs to the office but not to a case: models, templates, loose material. */
export function VaultLibrary({ initialDocuments, initialTotal, initialDriveOpen = false }: { initialDocuments: VaultDocument[]; initialTotal: number; initialDriveOpen?: boolean }) {
  const { documents, setDocuments, refresh, firstPage, pagination } = usePolledDocuments("scope=library", initialDocuments, initialTotal);
  const [failure, setFailure] = useState("");
  const [driveOpen, setDriveOpen] = useState(initialDriveOpen);

  return <div className="flex min-h-0 flex-1 flex-col px-5 py-6 md:px-10 md:py-10">
    <nav aria-label="Trilha" className="flex items-center gap-1 text-sm text-muted-foreground" data-reveal>
      <Link href="/app/vault" className="rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cofre</Link>
      <ChevronRight className="size-3.5" aria-hidden="true" />
      <span aria-current="page">Biblioteca</span>
    </nav>

    <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b pb-5" data-reveal>
      <h1 className="page-title leading-none">Biblioteca</h1>
      <div className="flex flex-wrap items-center gap-2">
        <UploadControl scope="library" onError={setFailure} onUploaded={() => void firstPage()} />
        <Button type="button" variant="outline" aria-expanded={driveOpen} onClick={() => setDriveOpen(open => !open)}>
          {driveOpen ? "Fechar Google Drive" : "Importar do Google Drive"}
        </Button>
      </div>
    </div>

    {failure && <p className="mt-4 flex items-start gap-2 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{failure}</p>}

    <div className="mt-5 min-h-0 overflow-auto">
      {driveOpen && <DrivePanel onImported={firstPage} />}
      <DocumentRows
        documents={documents}
        onError={setFailure}
        onRetried={(documentId) => setDocuments((current) => current.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))}
        onDeleted={() => void refresh()}
        empty="Nenhum arquivo na biblioteca."
      />
      <DocumentPagination {...pagination} />
    </div>
  </div>;
}
