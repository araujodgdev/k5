"use client";

import { useState } from "react";
import { File, FileText, Folder, FolderLock, Image as ImageIcon, UsersRound } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { visibilityNote } from "@/components/vault-folder-access";
import type { VaultDocument, VaultFolder } from "@/lib/vault";
import { ItemCard, ItemMenu } from "./item-card";
import { ago, documentMeta, fileCount, isImage } from "./labels";

/** A page of the case: a document the viewer wrote in a conversation about it. */
export type CasePage = { id: string; title: string; excerpt: string; createdByAgent: boolean; updatedAt: string };

const PREVIEW_LINES = 4;

/** The page's first lines as plain text, without its title or the markdown marks. */
export function pageLines(excerpt: string, title: string) {
  return excerpt.split("\n")
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "").replace(/[*_`]/g, "").trim())
    .filter((line) => line && line !== title.trim())
    .slice(0, PREVIEW_LINES);
}

export function PageItem({ page, href }: { page: CasePage; href: string }) {
  return (
    <ItemCard title={page.title} icon={FileText} preview={{ kind: "page", lines: pageLines(page.excerpt, page.title) }}
      meta={<span suppressHydrationWarning>{`Página · atualizada ${page.createdByAgent ? "pelo Lume " : ""}${ago(page.updatedAt)}`}</span>}
      action={{ kind: "tab", href, tab: page.title }} />
  );
}

function folderIcon(folder: VaultFolder) {
  return folder.visibility === "private" ? FolderLock : folder.visibility === "restricted" ? UsersRound : Folder;
}

export function FolderItem({ folder, href, canRemove, onAccess, onRemove }: {
  folder: VaultFolder;
  href: string;
  canRemove: boolean;
  onAccess: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const reserved = folder.visibility !== "public";
  const menu = (folder.owned || canRemove) && (
    <ItemMenu label={`Mais opções da pasta ${folder.name}`}>
      {folder.owned && <DropdownMenuItem onSelect={onAccess}>Quem vê a pasta</DropdownMenuItem>}
      {canRemove && <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>Remover pasta</DropdownMenuItem>}
    </ItemMenu>
  );
  return (
    <>
      <ItemCard title={folder.name} icon={folderIcon(folder)} preview={{ kind: "folder" }}
        meta={[fileCount(folder.documentCount), visibilityNote(folder)].filter(Boolean).join(" · ")}
        action={{ kind: "route", href }} menu={menu || undefined} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a pasta {folder.name}?</AlertDialogTitle>
            <AlertDialogDescription>{reserved
              ? "Para preservar o acesso reservado, mova o conteúdo ou altere quem vê a pasta antes de removê-la. Pastas privadas ou restritas só podem ser removidas quando estão vazias."
              : "Os arquivos e as subpastas sobem um nível. Nada é excluído."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onRemove}>Remover pasta</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function FileItem({ document, onRetry, onDelete }: { document: VaultDocument; onRetry: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const image = isImage(document);
  const retryable = document.status === "failed" || document.status === "queued";
  const download = `/api/vault/documents/${document.id}/download`;
  return (
    <>
      <ItemCard title={document.name} icon={image ? ImageIcon : File} preview={{ kind: image ? "images" : "paper" }}
        meta={documentMeta(document)} alert={document.status === "failed"} action={{ kind: "route", href: `/app/vault/files/${encodeURIComponent(document.id)}` }}
        menu={(
          <ItemMenu label={`Mais opções de ${document.name}`}>
            <DropdownMenuItem asChild><a href={download}>Baixar</a></DropdownMenuItem>
            {retryable && <DropdownMenuItem onSelect={onRetry}>Reenviar</DropdownMenuItem>}
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>Excluir</DropdownMenuItem>
          </ItemMenu>
        )} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {document.name}?</AlertDialogTitle>
            <AlertDialogDescription>O arquivo sai do Lume e da busca, e as versões anteriores vão junto. Não dá para desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>Excluir documento</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
