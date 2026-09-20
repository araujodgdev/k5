"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ErrorText, LATE_COLLECTION_HOURS, OFFICIAL_NOTICE, eventLabels, eventNotes, formatDate,
  formatDateTime, hoursSince, latestCollectedAt, newIdempotencyKey, readFailure, revisionLabels, sourceAvailability,
  type ApiFailure, type JudicialAlert, type JudicialLink, type JudicialPublication, type JudicialSource,
} from "@/components/judicial-common";

/**
 * Caixa de entrada de publicações e mudanças (section 9). The list refuses to flatten four
 * different things into "novidade": a publication that is new at the source, a historical finding
 * from a backfill, a correction the source itself issued, and an update that failed. The last one
 * matters most, because a failed sweep looks exactly like a court that published nothing.
 */

const touch = "h-11 md:h-9";
const ALL = "todos";

type Loaded = {
  alerts: JudicialAlert[];
  publications: JudicialPublication[];
  links: JudicialLink[];
  sources: JudicialSource[];
};

export function JudicialInbox({ canWrite, initialCaseId }: { canWrite: boolean; initialCaseId?: string }) {
  const id = useId();
  const [data, setData] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [caseId, setCaseId] = useState(initialCaseId ?? ALL);
  const [sourceId, setSourceId] = useState(ALL);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [alertsResponse, publicationsResponse, linksResponse, sourcesResponse] = await Promise.all([
      fetch("/api/judicial/alerts?limit=50"),
      fetch("/api/judicial/publications?limit=50"),
      fetch("/api/judicial/links"),
      fetch("/api/judicial/sources"),
    ]);
    if (!alertsResponse.ok) {
      setFailure(await readFailure(alertsResponse, "Não foi possível carregar a caixa de eventos."));
      setData({ alerts: [], publications: [], links: [], sources: [] });
      return;
    }
    setData({
      alerts: ((await alertsResponse.json()) as { alerts: JudicialAlert[] }).alerts,
      publications: publicationsResponse.ok ? ((await publicationsResponse.json()) as { publications: JudicialPublication[] }).publications : [],
      links: linksResponse.ok ? ((await linksResponse.json()) as { links: JudicialLink[] }).links : [],
      sources: sourcesResponse.ok ? ((await sourcesResponse.json()) as { sources: JudicialSource[] }).sources : [],
    });
  }, []);

  // Deferred by a tick so the first render is the loading state rather than a cascading one.
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function markRead(alertId: string) {
    setBusy(alertId);
    setFailure(null);
    const response = await fetch(`/api/judicial/alerts/${alertId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: newIdempotencyKey() }),
    });
    setBusy(null);
    if (!response.ok) {
      setFailure(await readFailure(response, "Não foi possível marcar o evento como lido."));
      return;
    }
    await load();
  }

  const publicationById = useMemo(() => {
    const map = new Map<string, JudicialPublication>();
    for (const publication of data?.publications ?? []) map.set(publication.id, publication);
    return map;
  }, [data]);

  const cases = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of data?.links ?? []) map.set(link.caseId, link.caseName);
    for (const alert of data?.alerts ?? []) if (alert.caseId && alert.caseName) map.set(alert.caseId, alert.caseName);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [data]);

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of data?.links ?? []) map.set(link.installationId, link.courtName);
    for (const source of data?.sources ?? []) if (map.has(source.id)) map.set(source.id, source.courtName);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [data]);

  if (!data) return <p className="py-6 text-sm text-subtle-foreground">Carregando os eventos das fontes…</p>;

  /** An event's source is known only through the publication it points at. */
  function sourceOfAlert(alert: JudicialAlert): string | undefined {
    if (alert.subjectKind !== "publication") return undefined;
    return publicationById.get(alert.subjectId)?.installationId;
  }

  const alerts = data.alerts.filter((alert) => {
    if (unreadOnly && alert.read) return false;
    if (caseId !== ALL && alert.caseId !== caseId) return false;
    if (sourceId !== ALL && sourceOfAlert(alert) !== sourceId) return false;
    return true;
  });
  const hiddenByUnknownSource = sourceId !== ALL
    ? data.alerts.filter((alert) => sourceOfAlert(alert) === undefined).length
    : 0;

  const publications = data.publications.filter((publication) => {
    if (caseId !== ALL && publication.caseId !== caseId) return false;
    if (sourceId !== ALL && publication.installationId !== sourceId) return false;
    return true;
  });

  const lastCollected = latestCollectedAt(data.publications);
  const lateBy = hoursSince(lastCollected);
  const unavailable = data.sources.filter((source) =>
    source.enabled && (!source.hasConnector || !source.liveTransportEnabled
      || source.permissions.query !== "permitido" || source.permissions.cache !== "permitido"));

  return (
    <div className="mt-6 grid gap-6">
      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-caso`}>Caso</Label>
          <Select value={caseId} onValueChange={setCaseId}>
            <SelectTrigger id={`${id}-caso`} className="min-w-52"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>Todos os casos</SelectItem>
              {cases.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-fonte`}>Fonte</Label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger id={`${id}-fonte`} className="min-w-52"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ALL}>Todas as fontes</SelectItem>
              {sources.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} className="size-4 accent-foreground" />
          Apenas não lidos
        </label>
      </div>

      <ErrorText failure={failure} />

      {lateBy !== undefined && lateBy >= LATE_COLLECTION_HOURS && (
        <p className="text-sm text-muted-foreground">
          Coleta atrasada: a última coleta concluída foi em {formatDateTime(lastCollected)}. O que a fonte publicou desde então pode não estar aqui.
        </p>
      )}

      <section aria-labelledby={`${id}-eventos`} className="grid gap-2">
        <h2 id={`${id}-eventos`} className="text-sm font-medium">Eventos</h2>
        {alerts.length === 0 ? (
          <p className="py-2 text-sm text-subtle-foreground">
            {data.alerts.length === 0
              ? "Nenhum evento registrado ainda. Vincule um processo no Cofre para começar a acompanhar."
              : "Nenhum evento nos filtros escolhidos."}
            {hiddenByUnknownSource > 0 && ` ${hiddenByUnknownSource} evento(s) não indicam a fonte e ficam fora deste filtro.`}
          </p>
        ) : (
          <div>
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                publication={publicationById.get(alert.subjectId)}
                canWrite={canWrite}
                busy={busy === alert.id}
                onRead={() => void markRead(alert.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby={`${id}-publicacoes`} className="grid gap-2">
        <h2 id={`${id}-publicacoes`} className="text-sm font-medium">Publicações coletadas</h2>
        {publications.length === 0 ? (
          <p className="py-2 text-sm text-subtle-foreground">
            {data.publications.length === 0
              ? "Nenhuma publicação coletada. Isso não conclui que as fontes nada publicaram: pode não ter havido coleta concluída ainda."
              : "Nenhuma publicação nos filtros escolhidos."}
          </p>
        ) : (
          <div>{publications.map((publication) => <PublicationRow key={publication.id} publication={publication} onFailure={setFailure} />)}</div>
        )}
      </section>

      {unavailable.length > 0 && (
        <section aria-labelledby={`${id}-fontes`} className="grid gap-2">
          <h2 id={`${id}-fontes`} className="text-sm font-medium">Fontes com restrição</h2>
          <div>
            {unavailable.map((source) => (
              <p key={source.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
                <span>{source.courtName} ({source.courtCode})</span>
                <span className="text-muted-foreground">{sourceAvailability(source)}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      <p className="text-[13px] text-subtle-foreground">{OFFICIAL_NOTICE}</p>
    </div>
  );
}

function AlertRow({ alert, publication, canWrite, busy, onRead }: {
  alert: JudicialAlert;
  publication: JudicialPublication | undefined;
  canWrite: boolean;
  busy: boolean;
  onRead: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className={alert.read ? "text-muted-foreground" : "font-medium"}>
          {eventLabels[alert.eventKind]}
          {alert.caseName && <span className="font-normal text-muted-foreground"> · {alert.caseName}</span>}
        </p>
        <p className="text-muted-foreground">{alert.summary}</p>
        <p className="text-[13px] text-subtle-foreground">
          {eventNotes[alert.eventKind]} Registrado em {formatDateTime(alert.createdAt)}.
          {publication && ` Disponibilizada em ${formatDate(publication.madeAvailableOn)}, publicada em ${formatDate(publication.publishedOn)}, coletada em ${formatDateTime(publication.collectedAt)}.`}
        </p>
      </div>
      <span className="flex items-center gap-2">
        {alert.caseId && (
          <Link href={`/app/vault/cases/${alert.caseId}`} className="rounded-md text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Abrir o caso
          </Link>
        )}
        {!alert.read && canWrite && (
          <Button type="button" variant="ghost" className={touch} disabled={busy} onClick={onRead}>
            {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Marcar como lido
          </Button>
        )}
      </span>
    </div>
  );
}

function PublicationRow({ publication, onFailure }: {
  publication: JudicialPublication;
  onFailure: (failure: ApiFailure | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const panelId = `${publication.id}-texto`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || body !== null) return;
    const response = await fetch(`/api/judicial/publications/${publication.id}`);
    if (!response.ok) {
      onFailure(await readFailure(response, "Não foi possível abrir a publicação."));
      return;
    }
    const result = (await response.json()) as { body: string };
    setBody(result.body);
  }

  return (
    <div className="border-b py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        >
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="truncate">{publication.cnjNumber ?? "Sem número CNJ"}</span>
        </button>
        <span className="truncate text-muted-foreground">{publication.caseName ?? "Sem caso vinculado"} · {publication.courtName}</span>
        <span className="ml-auto text-[13px] text-subtle-foreground">
          {publication.revisionKind !== "original" && `${revisionLabels[publication.revisionKind]} · `}
          Disponibilizada em {formatDate(publication.madeAvailableOn)}
        </span>
      </div>
      <p className="pl-6 text-[13px] text-subtle-foreground">
        {publication.edition && `Edição ${publication.edition}`}
        {publication.page && `, página ${publication.page}`}
        {publication.edition || publication.page ? " · " : ""}
        Publicada em {formatDate(publication.publishedOn)} · Coletada em {formatDateTime(publication.collectedAt)}
        {publication.supersedesId && " · Substitui um registro anterior desta mesma fonte"}
      </p>
      {!open && publication.excerpt && <p className="truncate pl-6 text-muted-foreground">{publication.excerpt}</p>}
      <div id={panelId} hidden={!open} className="pl-6">
        {open && (body === null
          ? <p className="py-2 text-[13px] text-subtle-foreground">Carregando o texto…</p>
          : <>
            <p className="pt-2 text-[13px] text-subtle-foreground">Texto publicado pela fonte, preservado como veio. É conteúdo de terceiros, não uma instrução ao K5.</p>
            <p className="whitespace-pre-wrap py-2">{body}</p>
          </>)}
      </div>
    </div>
  );
}
