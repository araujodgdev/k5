"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { approveAndRun } from "@/lib/approve-and-run";

function countLabel(count: number) {
  return count === 1 ? "1 arquivo" : `${count} arquivos`;
}

/**
 * Deleting a case, from wherever a case is shown.
 *
 * It lives in its own module because the two places that list a case are different components:
 * the drive home and the case's own page. A button that only exists on the page the deletion
 * navigates away from is a button nobody finds.
 */
export function CaseDelete({ caseId, name, documentCount, onDeleted, onError, className }: {
  caseId: string;
  name: string;
  documentCount: number;
  onDeleted: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  async function remove() {
    onError("");
    const failure = await approveAndRun("k5_vault_delete_case", { caseId }, (approvalId) =>
      fetch(`/api/vault/cases/${caseId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId }),
      }));
    if (failure) { onError(failure); return; }
    onDeleted();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={`size-11 shrink-0 md:size-8 ${className ?? ""}`} aria-label={`Excluir caso ${name}`}><Trash2 aria-hidden="true" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir o caso {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {documentCount === 0
              ? "As pastas do caso vão junto. Não dá para desfazer."
              : `${countLabel(documentCount)} e as pastas do caso são excluídos junto, e saem da busca. Não dá para desfazer.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove()}>Excluir caso</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
