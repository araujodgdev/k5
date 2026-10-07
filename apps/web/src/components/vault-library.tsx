"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CanvasPage } from "@/components/canvas/canvas-page";
import { DrivePanel } from "@/components/google/drive-panel";
import { ItemGrid } from "@/components/casos/item-card";
import { DocumentItems, DocumentPagination, UploadControl, usePolledDocuments } from "@/components/vault-files";
import type { VaultDocument } from "@/lib/vault";

/** Everything that belongs to the office but not to a case: models, templates, loose material. */
export function VaultLibrary({ initialDocuments, initialTotal, initialDriveOpen = false }: { initialDocuments: VaultDocument[]; initialTotal: number; initialDriveOpen?: boolean }) {
  const { documents, setDocuments, refresh, firstPage, pagination } = usePolledDocuments("scope=library", initialDocuments, initialTotal);
  const [failure, setFailure] = useState("");
  const [driveOpen, setDriveOpen] = useState(initialDriveOpen);

  return (
    <CanvasPage width="wide" className="md:gap-5">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Link href="/app/vault" className="-ml-1.5 inline-flex h-11 items-center self-start rounded-sm px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:h-6">
            Casos
          </Link>
          <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] md:text-[26px]">Biblioteca do escritório</h1>
          <p className="text-[13px] text-muted-foreground">Arquivos fora de um caso: modelos, procurações e materiais que servem a mais de um.</p>
        </div>
      </header>

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border pb-2 md:justify-end md:gap-1">
        <Button type="button" variant="ghost" className="text-muted-foreground max-md:h-11" aria-expanded={driveOpen} onClick={() => setDriveOpen((open) => !open)}>
          {driveOpen ? "Fechar Google Drive" : "Importar do Google Drive"}
        </Button>
        <UploadControl scope="library" onError={setFailure} onUploaded={() => void firstPage()} />
      </div>

      {failure && <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{failure}</p>}
      {driveOpen && <DrivePanel onImported={firstPage} />}

      <ItemGrid label="Arquivos da biblioteca">
        <DocumentItems documents={documents} onError={setFailure} onDeleted={() => void refresh()}
          onRetried={(documentId) => setDocuments((list) => list.map((item) => item.id === documentId ? { ...item, status: "queued", progress: 0, errorMessage: null } : item))} />
      </ItemGrid>
      {!pagination.loading && !pagination.error && pagination.total === 0 && <p className="text-[13.5px] text-muted-foreground">Nenhum arquivo na biblioteca ainda.</p>}
      <DocumentPagination {...pagination} />
    </CanvasPage>
  );
}
