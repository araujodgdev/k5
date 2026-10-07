"use client";

import { useRef, useState } from "react";
import { CircleAlert, Folder, Layers, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CanvasPage, CanvasRow } from "@/components/canvas/canvas-page";
import { CaseDelete } from "@/components/vault-case-delete";
import { CaseCard, CaseGrid } from "@/components/casos/case-card";
import { ItemMenu } from "@/components/casos/item-card";
import { ago, dayMonth, fileCount } from "@/components/casos/labels";
import { CaseFormDialog } from "@/components/casos/case-form-dialog";
import type { CasePerson } from "@/components/casos/people-stack";
import { ViewToggle, type ItemView } from "@/components/casos/view-toggle";
import type { VaultCase } from "@/lib/vault";

const LIBRARY_HREF = "/app/vault/library";
const LIBRARY_TITLE = "Biblioteca do escritório";

function matches(item: VaultCase, query: string) {
  const needle = query.trim().toLocaleLowerCase("pt-BR");
  if (!needle) return true;
  return [item.name, item.client.name, item.description].some((text) => text?.toLocaleLowerCase("pt-BR").includes(needle));
}

/**
 * Casos (`v.casos`): every case the person can open, as cards or rows, and the office library
 * for files that belong to no case. A case opens as its own canvas tab.
 */
export function VaultBrowser({ initialCases, libraryCount, ownCaseIds, people }: {
  initialCases: VaultCase[];
  libraryCount: number;
  ownCaseIds: string[];
  people: Record<string, CasePerson[]>;
}) {
  const [cases, setCases] = useState(initialCases);
  const [ownedIds, setOwnedIds] = useState(ownCaseIds);
  const [view, setView] = useState<ItemView>("grid");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VaultCase | null>(null);
  const [failure, setFailure] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const isShared = (id: string) => !ownedIds.includes(id);
  const shown = cases.filter((item) => matches(item, query));
  const href = (item: VaultCase) => `/app/vault/cases/${item.id}`;
  const updated = (item: VaultCase) => isShared(item.id) ? "compartilhado com você" : `atualizado ${ago(item.updatedAt)}`;

  function created(record: VaultCase) {
    setCases((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    setOwnedIds((current) => [...current, record.id]);
  }

  const menu = (item: VaultCase) => isShared(item.id) ? undefined : (
    <ItemMenu label={`Mais opções do caso ${item.name}`}>
      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(item)}>Excluir caso</DropdownMenuItem>
    </ItemMenu>
  );

  return (
    <CanvasPage width="wide" className="md:gap-6 md:pt-9">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 text-[24px] leading-[1.45] font-semibold tracking-[-0.02em] md:text-[26px]">Casos</h1>
        <ViewToggle view={view} onChange={setView} />
        <label className="flex h-11 items-center gap-2 rounded-md border border-border-strong px-2.5 text-muted-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring max-md:order-last max-md:w-full md:h-[34px] md:w-60">
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar casos" aria-label="Buscar casos"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle-foreground md:text-[13.5px]" />
        </label>
        <Button type="button" size="lg" className="max-md:h-11" onClick={() => { setFailure(""); setCreating(true); }}><Plus aria-hidden="true" className="size-3.5" />Novo caso</Button>
      </header>

      {failure && <p role="alert" className="flex items-start gap-2 text-[13px] text-destructive"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{failure}</p>}

      {view === "grid" ? (
        <CaseGrid label="Casos">
          {shown.map((item) => (
            <CaseCard key={item.id} href={href(item)} title={item.name} icon={Folder} client={item.client.name} summary={item.description}
              footer={<span suppressHydrationWarning>{fileCount(item.documentCount)} · {updated(item)}</span>}
              people={people[item.id]} menu={menu(item)} />
          ))}
          {!query.trim() && (
            <CaseCard href={LIBRARY_HREF} title={LIBRARY_TITLE} icon={Layers} client="Arquivos fora de um caso"
              summary="Modelos, procurações e materiais que servem a mais de um caso." footer={fileCount(libraryCount)} />
          )}
        </CaseGrid>
      ) : (
        <div role="list" aria-label="Casos" className="flex flex-col gap-0.5 md:max-w-[760px]">
          {shown.map((item) => (
            <div key={item.id} role="listitem" className="flex min-w-0 items-center gap-1">
              <CanvasRow stacked href={href(item)} icon={<Folder />} title={item.name} className="min-w-0 flex-1"
                detail={[item.client.name, item.description].filter(Boolean).join(" · ") || undefined}
                meta={<span suppressHydrationWarning>{dayMonth(item.updatedAt)}</span>} status={isShared(item.id) ? "compartilhado" : fileCount(item.documentCount)} />
              {menu(item) ?? <span aria-hidden="true" className="w-11 shrink-0 md:w-[30px]" />}
            </div>
          ))}
          {!query.trim() && (
            <div role="listitem" className="flex min-w-0 items-center gap-1">
              <CanvasRow stacked href={LIBRARY_HREF} icon={<Layers />} title={LIBRARY_TITLE} detail="Arquivos fora de um caso" status={fileCount(libraryCount)} className="min-w-0 flex-1" />
              <span aria-hidden="true" className="w-11 shrink-0 md:w-[30px]" />
            </div>
          )}
        </div>
      )}

      {cases.length === 0 && <p className="text-[13.5px] text-muted-foreground">Nenhum caso ainda. Crie o primeiro para reunir os arquivos e o trabalho de um processo.</p>}
      {cases.length > 0 && shown.length === 0 && (
        <p className="text-[13.5px] text-muted-foreground">
          Nenhum caso com “{query.trim()}”.{" "}
          <button type="button" className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => { setQuery(""); searchRef.current?.focus(); }}>Limpar busca</button>
        </p>
      )}

      <CaseFormDialog open={creating} onOpenChange={setCreating} onSaved={created} />
      {deleting && (
        <CaseDelete caseId={deleting.id} name={deleting.name} documentCount={deleting.documentCount} open onOpenChange={(open) => { if (!open) setDeleting(null); }}
          onError={setFailure} onDeleted={() => { setCases((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); }} />
      )}
    </CanvasPage>
  );
}
