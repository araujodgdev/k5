"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ErrorText, OFFICIAL_NOTICE, collectionAgeSentence, confirmationLabels, degreeLabels, formatDate,
  jobStatusLabels, newIdempotencyKey, permissionDimensions, permissionLabels,
  readFailure, sourceAvailability, type ApiFailure, type JudicialJob, type JudicialLink,
  type JudicialPublication, type JudicialSource,
} from "@/components/judicial-common";

/**
 * "Vincular processo" inside a case (section 9 of docs/plano-infra-judicial.md).
 *
 * The screen's job is to keep four things separate that are easy to merge and wrong to merge: the
 * coverage a source documents, what the K5 has actually collected, the date the court declared,
 * and the moment we asked. An empty answer is reported as an empty answer from one source, never
 * as the proceeding not existing.
 */

const touch = "h-11 md:h-9";
const degreeOptions = ["first", "second", "superior", "panel", "not_applicable"] as const;

type Loaded = {
  links: JudicialLink[];
  sources: JudicialSource[];
  publications: JudicialPublication[];
  nextCursor: string | null;
};

type LinksPage = {
  links: JudicialLink[];
  nextCursor: string | null;
  jobs: JudicialJob[];
  completedJobs: JudicialJob[];
};

function jobsByLink(rows: JudicialJob[]): Record<string, JudicialJob> {
  return Object.fromEntries(rows.flatMap((job) => job.linkId ? [[job.linkId, job]] : []));
}

export function JudicialCaseLinks({ caseId, canWrite }: { caseId: string; canWrite: boolean }) {
  const headingId = useId();
  const [data, setData] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JudicialJob>>({});
  const [completedJobs, setCompletedJobs] = useState<Record<string, JudicialJob>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const query = `caseId=${encodeURIComponent(caseId)}`;
    const [linksResponse, sourcesResponse, publicationsResponse, followResponse] = await Promise.all([
      fetch(`/api/judicial/links?${query}&limit=20`),
      fetch("/api/judicial/sources"),
      fetch(`/api/judicial/publications?${query}&limit=50`),
      fetch(`/api/notifications/follows?${query}`, { cache: "no-store" })
        .then(async (response) => response.ok ? await response.json() as { following: boolean } : null)
        .catch(() => null),
    ]);
    if (!linksResponse.ok) {
      setFailure(await readFailure(linksResponse, "Não foi possível carregar os processos deste caso."));
      setData({ links: [], sources: [], publications: [], nextCursor: null });
      return;
    }
    const links = (await linksResponse.json()) as LinksPage;
    // The catalog and the collected publications are context, not the answer: a failure in either
    // still leaves a usable list of links instead of an empty screen.
    const sources = sourcesResponse.ok ? ((await sourcesResponse.json()) as { sources: JudicialSource[] }).sources : [];
    const publications = publicationsResponse.ok
      ? ((await publicationsResponse.json()) as { publications: JudicialPublication[] }).publications
      : [];
    if (followResponse) setFollowing(followResponse.following);
    setJobs(jobsByLink(links.jobs));
    setCompletedJobs(jobsByLink(links.completedJobs));
    setData({ links: links.links, sources, publications, nextCursor: links.nextCursor });
  }, [caseId]);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    setFailure(null);
    const params = new URLSearchParams({ caseId, limit: "20", cursor: data.nextCursor });
    const response = await fetch(`/api/judicial/links?${params}`);
    setLoadingMore(false);
    if (!response.ok) {
      setFailure(await readFailure(response, "Não foi possível carregar os demais processos."));
      return;
    }
    const page = (await response.json()) as LinksPage;
    setJobs((current) => ({ ...current, ...jobsByLink(page.jobs) }));
    setCompletedJobs((current) => ({ ...current, ...jobsByLink(page.completedJobs) }));
    setData((current) => current ? {
      ...current,
      links: [...current.links, ...page.links],
      nextCursor: page.nextCursor,
    } : current);
  }

  // Deferred by a tick so the first render is the loading state rather than a cascading one.
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function act(linkId: string, run: () => Promise<Response>, fallback: string) {
    setBusy(linkId);
    setFailure(null);
    const response = await run();
    setBusy(null);
    if (!response.ok) {
      setFailure(await readFailure(response, fallback));
      return null;
    }
    return response;
  }

  async function decide(linkId: string, decision: "confirmed" | "rejected") {
    const done = await act(linkId, () => fetch(`/api/judicial/links/${linkId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, idempotencyKey: newIdempotencyKey() }),
    }), "Não foi possível registrar a decisão sobre este vínculo.");
    if (done) await load();
  }

  async function unlink(linkId: string) {
    const done = await act(linkId, () => fetch(`/api/judicial/links/${linkId}`, { method: "DELETE" }), "Não foi possível remover o vínculo.");
    if (done) await load();
  }

  async function refresh(linkId: string) {
    const done = await act(linkId, () => fetch(`/api/judicial/links/${linkId}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: newIdempotencyKey() }),
    }), "Não foi possível solicitar a atualização.");
    if (!done) return;
    const { job } = (await done.json()) as { job: JudicialJob };
    setJobs((current) => ({ ...current, [linkId]: job }));
    setExpanded(linkId);
  }

  async function toggleFollowing() {
    if (following === null) return;
    setBusy("following");
    setFailure(null);
    try {
      const response = await fetch("/api/notifications/follows", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId, following: !following }),
      });
      if (!response.ok) {
        setFailure(await readFailure(response, "Não foi possível alterar as notificações deste caso."));
        return;
      }
      setFollowing(((await response.json()) as { following: boolean }).following);
    } catch {
      setFailure({ message: "Não foi possível alterar as notificações deste caso." });
    } finally {
      setBusy(null);
    }
  }

  useJobPolling(jobs, setJobs, load);

  if (!data) {
    return (
      <section aria-labelledby={headingId} className="border-b py-5">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-medium">Processos acompanhados</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Vincule um número CNJ a este caso para coletar publicações e acompanhar atualizações da fonte.</p>
        </div>
        <p className="py-3 text-sm text-subtle-foreground">Carregando os processos vinculados…</p>
      </section>
    );
  }

  const bySource = new Map<string, number>();
  for (const link of data.links) bySource.set(link.installationId, (bySource.get(link.installationId) ?? 0) + 1);

  return (
    <section aria-labelledby={headingId} className="border-b py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-medium">Processos acompanhados</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Vincule um número CNJ a este caso para coletar publicações e acompanhar atualizações da fonte.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {following !== null && (
            <Button type="button" variant="ghost" className={touch} disabled={busy === "following"} aria-pressed={following} onClick={() => void toggleFollowing()}>
              {busy === "following" ? "Salvando…" : following ? "Notificações ativas" : "Receber notificações"}
            </Button>
          )}
          {canWrite && (
            <Button type="button" variant="outline" className={touch} aria-expanded={adding} onClick={() => { setAdding((value) => !value); setFailure(null); }}>
              {adding ? "Fechar" : "Vincular processo"}
            </Button>
          )}
        </div>
      </div>

      <ErrorText failure={failure} />

      {adding && canWrite && (
        <LinkForm
          caseId={caseId}
          sources={data.sources}
          onFailure={setFailure}
          onLinked={async () => { setAdding(false); await load(); }}
        />
      )}

      {data.links.length === 0 ? (
        <p className="py-3 text-sm text-subtle-foreground">
          Nenhum processo vinculado. Use Vincular processo para informar o número e a fonte; as publicações coletadas aparecem nesta lista.
        </p>
      ) : (
        <div className="mt-3">
          {data.links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              source={data.sources.find((source) => source.id === link.installationId)}
              publications={data.publications.filter((publication) => publication.linkId === link.id)}
              job={jobs[link.id]}
              completedJob={completedJobs[link.id]}
              siblings={bySource.get(link.installationId) ?? 1}
              expanded={expanded === link.id}
              busy={busy === link.id}
              canWrite={canWrite}
              onToggle={() => setExpanded((current) => (current === link.id ? null : link.id))}
              onDecide={decide}
              onUnlink={unlink}
              onRefresh={refresh}
            />
          ))}
          {data.nextCursor && (
            <Button type="button" variant="ghost" className={`${touch} mt-2`} disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Carregar mais processos
            </Button>
          )}
        </div>
      )}

      <p className="pt-3 text-[13px] text-subtle-foreground">{OFFICIAL_NOTICE}</p>
    </section>
  );
}

/** Keeps a requested collection visible while it runs, then reloads once it settles. */
function useJobPolling(
  jobs: Record<string, JudicialJob>,
  setJobs: (update: (current: Record<string, JudicialJob>) => Record<string, JudicialJob>) => void,
  onSettled: () => Promise<void>,
) {
  const pending = Object.entries(jobs).filter(([, job]) => job.status === "queued" || job.status === "running");
  const pendingIds = pending.map(([, job]) => job.id).join(",");

  useEffect(() => {
    if (!pendingIds) return;
    const entries = pendingIds.split(",");
    const timer = setInterval(async () => {
      for (const jobId of entries) {
        const response = await fetch(`/api/judicial/jobs/${jobId}`);
        if (!response.ok) continue;
        const { job } = (await response.json()) as { job: JudicialJob };
        setJobs((current) => {
          const linkId = Object.keys(current).find((key) => current[key].id === job.id);
          return linkId ? { ...current, [linkId]: job } : current;
        });
        if (job.status !== "queued" && job.status !== "running") await onSettled();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pendingIds, setJobs, onSettled]);
}

function LinkRow({ link, source, publications, job, completedJob, siblings, expanded, busy, canWrite, onToggle, onDecide, onUnlink, onRefresh }: {
  link: JudicialLink;
  source: JudicialSource | undefined;
  publications: JudicialPublication[];
  job: JudicialJob | undefined;
  completedJob: JudicialJob | undefined;
  siblings: number;
  expanded: boolean;
  busy: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onDecide: (linkId: string, decision: "confirmed" | "rejected") => void;
  onUnlink: (linkId: string) => void;
  onRefresh: (linkId: string) => void;
}) {
  const panelId = `${link.id}-detalhes`;
  const number = link.cnjNumber ?? link.nativeNumber ?? "Sem número";
  const status = link.confirmation === "confirmed"
    ? collectionAgeSentence(completedJob?.completedAt)
    : confirmationLabels[link.confirmation];

  return (
    <div className="border-b">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        >
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="truncate font-medium">{number}</span>
        </button>
        <span className="truncate text-sm text-muted-foreground">
          {source?.courtName ?? link.courtName} · {degreeLabels[link.degree] ?? link.degree}
        </span>
        <span className="ml-auto text-[13px] text-subtle-foreground">{status}</span>
        {canWrite && (
          <span className="flex items-center gap-1">
            {link.confirmation === "pending_review" && (
              <>
                <Button type="button" className={touch} disabled={busy} onClick={() => onDecide(link.id, "confirmed")}>Confirmar</Button>
                <Button type="button" variant="ghost" className={touch} disabled={busy} onClick={() => onDecide(link.id, "rejected")}>Rejeitar</Button>
              </>
            )}
            {link.confirmation === "confirmed" && link.cnjNumber && (
              <Button type="button" variant="ghost" className={touch} disabled={busy} onClick={() => onRefresh(link.id)}>
                {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                Atualizar
              </Button>
            )}
            <UnlinkDialog number={number} onConfirm={() => onUnlink(link.id)} />
          </span>
        )}
      </div>

      {siblings > 1 && (
        <p className="pb-2 text-[13px] text-muted-foreground">
          Este caso tem {siblings} registros nesta mesma fonte. Confirme qual corresponde ao processo e remova os demais.
        </p>
      )}

      <div id={panelId} hidden={!expanded} className="pb-4">
        {expanded && <LinkDetail link={link} source={source} publications={publications} job={job} completedJob={completedJob} />}
      </div>
    </div>
  );
}

function LinkDetail({ link, source, publications, job, completedJob }: {
  link: JudicialLink;
  source: JudicialSource | undefined;
  publications: JudicialPublication[];
  job: JudicialJob | undefined;
  completedJob: JudicialJob | undefined;
}) {
  const latest = publications[0];
  const emptyAnswer = completedJob?.recordsAccepted === 0;

  return (
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <dl className="grid gap-2">
        <Field term="Fonte" detail={source ? `${source.courtName} (${source.courtCode}) · ${source.system}` : link.courtName} />
        <Field
          term="Identidade"
          detail={link.cnjNumber
            ? `Número CNJ ${link.cnjNumber}`
            : `Identidade nativa ${link.nativeNumber ?? "—"}. O número não passou na verificação dos dígitos CNJ e foi mantido como a fonte o escreve.`}
        />
        <Field
          term="Cobertura documentada pela fonte"
          detail={`${formatDate(source?.coverage.from)} a ${formatDate(source?.coverage.to)}. É o que a fonte declara cobrir, não o que o K5 já coletou.`}
        />
        <Field term="Data da consulta" detail={collectionAgeSentence(completedJob?.completedAt)} />
        <Field
          term="Atualização declarada pela fonte"
          detail={latest
            ? `Disponibilizada em ${formatDate(latest.madeAvailableOn)}; publicada em ${formatDate(latest.publishedOn)}.`
            : "Sem registro coletado para comparar."}
        />
        <Field term="Situação da conexão" detail={sourceAvailability(source)} />
      </dl>

      <div className="grid gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Condição de uso desta fonte</p>
          <div className="mt-1">
            {permissionDimensions.map(([dimension, label]) => (
              <div key={dimension} className="flex items-center justify-between border-b py-1.5 last:border-b-0">
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {permissionLabels[source?.permissions[dimension] ?? "nao_esclarecido"]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {job && (
          <p className="text-[13px] text-muted-foreground">
            Última coleta solicitada: {jobStatusLabels[job.status]} · janela de {formatDate(job.windowFrom)} a {formatDate(job.windowTo)} ·{" "}
            {job.pagesFetched} página(s), {job.recordsAccepted} aceita(s), {job.recordsRejected} rejeitada(s).
            {job.errorCode === "partial" && " Dados parciais: a varredura parou no limite de páginas e continua no próximo ciclo."}
            {job.errorMessage && job.errorCode !== "partial" && ` ${job.errorMessage}`}
          </p>
        )}

        {emptyAnswer && (
          <p className="text-[13px] text-muted-foreground">
            Não encontrado nesta fonte na janela consultada. Isso não conclui que o processo não existe: outra fonte,
            outro grau ou outra janela podem tê-lo.
          </p>
        )}

        <p className="text-[13px] text-muted-foreground">
          {publications.length > 0
            ? `${publications.length} publicação(ões) coletada(s) para este processo.`
            : "Nenhuma publicação coletada para este processo ainda."}
        </p>
      </div>
    </div>
  );
}

function Field({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}

function UnlinkDialog({ number, onConfirm }: { number: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className={touch}>Desvincular</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desvincular o processo {number}?</AlertDialogTitle>
          <AlertDialogDescription>
            As coletas recorrentes deste processo param. As publicações já coletadas permanecem como evidência.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Desvincular</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinkForm({ caseId, sources, onFailure, onLinked }: {
  caseId: string;
  sources: JudicialSource[];
  onFailure: (failure: ApiFailure | null) => void;
  onLinked: () => Promise<void>;
}) {
  const id = useId();
  // A vocabulary source describes terms; it does not follow proceedings, and the server refuses it.
  const selectable = useMemo(() => sources.filter((source) => source.purpose !== "vocabulary"), [sources]);
  const [installationId, setInstallationId] = useState(selectable[0]?.id ?? "");
  const [number, setNumber] = useState("");
  const [degree, setDegree] = useState<string>("first");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const chosen = selectable.find((source) => source.id === installationId);

  if (!selectable.length) {
    return <p className="py-3 text-sm text-subtle-foreground">Nenhuma fonte judicial cadastrada. Fale com o administrador da plataforma.</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onFailure(null);
    setNote("");
    const response = await fetch("/api/judicial/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, installationId, number: number.trim(), degree, idempotencyKey: newIdempotencyKey() }),
    });
    setBusy(false);
    if (!response.ok) {
      onFailure(await readFailure(response, "Não foi possível vincular o processo."));
      return;
    }
    const result = (await response.json()) as { created: boolean; numberKind: "cnj" | "native" };
    setNumber("");
    setNote(result.created
      ? `Vínculo criado aguardando confirmação de uma pessoa${result.numberKind === "native" ? "; o número foi guardado como identidade nativa da fonte" : ""}.`
      : "Este processo já estava vinculado a este caso nesta fonte.");
    await onLinked();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-b py-4 md:grid-cols-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-fonte`}>Fonte</Label>
        <Select value={installationId} onValueChange={setInstallationId}>
          <SelectTrigger id={`${id}-fonte`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            {selectable.map((source) => (
              <SelectItem key={source.id} value={source.id}>{source.courtName} ({source.courtCode})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-numero`}>Número do processo</Label>
        <Input id={`${id}-numero`} className={touch} value={number} onChange={(event) => setNumber(event.target.value)} placeholder="0000000-00.0000.0.00.0000" minLength={3} maxLength={60} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-grau`}>Grau</Label>
        <Select value={degree} onValueChange={setDegree}>
          <SelectTrigger id={`${id}-grau`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent position="popper">
            {degreeOptions.map((option) => <SelectItem key={option} value={option}>{degreeLabels[option]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[13px] text-muted-foreground md:col-span-3">{sourceAvailability(chosen)}</p>
      {note && <p className="text-[13px] text-muted-foreground md:col-span-3" role="status">{note}</p>}
      <div className="md:col-span-3">
        <Button type="submit" className={touch} disabled={busy || !number.trim()}>
          {busy && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Vincular processo
        </Button>
      </div>
    </form>
  );
}
