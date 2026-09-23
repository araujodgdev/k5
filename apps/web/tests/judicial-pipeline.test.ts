import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { WorkspaceContext } from "../src/lib/application/context";
import { CapabilityError } from "../src/lib/capabilities/errors";
import { ConnectorError } from "../src/lib/judicial/contracts";
import { capabilityNames, publishedCapabilitiesForRole } from "../src/lib/capabilities/contracts";
import { runCapability } from "../src/lib/agent-tools";
import * as judicial from "../src/lib/application/judicial-service";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { createCaseLink, confirmCaseLink, listCaseLinks, unlinkCase } from "../src/lib/judicial/repositories/links";
import { createSubscription, listDueSubscriptions, subscriptionStillAuthorized, findSubscriptionById } from "../src/lib/judicial/repositories/subscriptions";
import { claimJob, completeJob, enqueueJob, failJob, findJob, reserveRequestBudget, requestsUsedToday, MAX_ATTEMPTS } from "../src/lib/judicial/jobs/queue";
import { ingestPublications } from "../src/lib/judicial/repositories/evidence";
import { scheduleDueSubscriptions, scheduleBackfill } from "../src/lib/judicial/jobs/scheduler";
import { processNextJudicialJob } from "../src/lib/judicial/jobs/collector";
import { fixtureKey } from "../src/lib/judicial/connectors/transport";
import { setFixtureTransport, resetTransport } from "../src/lib/judicial/connectors";

const VALID = "00000010520258260100";
const VALID_OTHER = "12345677920248130001";
const TODAY = new Date().toISOString().slice(0, 10);

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
}

type Seed = {
  officeA: string; officeB: string;
  lawyerA: string; reviewerA: string; lawyerB: string;
  caseA: string; caseB: string;
};

function seed(): Seed {
  const officeA = randomUUID();
  const officeB = randomUUID();
  const lawyerA = randomUUID();
  const reviewerA = randomUUID();
  const lawyerB = randomUUID();

  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
    lawyerA, `a-${randomUUID()}@alfa.test`, "Advogada Alfa",
    reviewerA, `r-${randomUUID()}@alfa.test`, "Revisor Alfa",
    lawyerB, `b-${randomUUID()}@beta.test`, "Advogado Beta",
  );
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)").run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia");
  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)").run(
    randomUUID(), officeA, lawyerA, "lawyer",
    randomUUID(), officeA, reviewerA, "reviewer",
    randomUUID(), officeB, lawyerB, "lawyer",
  );

  const caseA = randomUUID();
  const caseB = randomUUID();
  testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, ?, ?), (?, ?, ?, ?)").run(
    caseA, officeA, `Caso Alfa ${caseA.slice(0, 6)}`, lawyerA,
    caseB, officeB, `Caso Beta ${caseB.slice(0, 6)}`, lawyerB,
  );

  return { officeA, officeB, lawyerA, reviewerA, lawyerB, caseA, caseB };
}

function context(officeId: string, userId: string, role: "lawyer" | "reviewer" = "lawyer"): WorkspaceContext {
  return { officeId, userId, role };
}

/**
 * The queue is deliberately global — a worker claims the next job for any office — so a test that
 * drives the collector starts from an empty queue instead of claiming whatever an earlier test
 * left pending and asserting against the wrong run.
 */
function clearQueue() {
  testDb.exec("UPDATE judicial_sync_job SET status = 'cancelled', lease_owner = NULL, lease_until = 0 WHERE status IN ('queued','running')");
  testDb.exec("UPDATE judicial_subscription SET status = 'cancelled' WHERE status = 'active'");
}

/**
 * Two collections in the same millisecond are exactly what the minimum spacing exists to stop, so
 * a test about ingestion has to clear the ledger between runs to reach the code it is testing.
 * The spacing itself is asserted separately, in the budget tests.
 */
function clearBudget() {
  testDb.exec("DELETE FROM judicial_rate_budget");
}

let installationCounter = 0;
/** A fresh installation per test, so enabling one source never leaks into another assertion. */
function source(overrides: Partial<Parameters<typeof upsertInstallation>[0]> = {}) {
  installationCounter += 1;
  return upsertInstallation({
    kind: "djen",
    courtCode: `DJEN${installationCounter}`,
    courtName: "Diário de Justiça Eletrônico Nacional",
    degree: "not_applicable",
    system: "not_applicable",
    purpose: "publications",
    baseUrl: "https://comunica.exemplo.jus.br/",
    authKind: "none",
    discoveryStatus: "spike_approved",
    permissions: { query: "permitido", cache: "permitido" },
    allowedHosts: ["comunica.exemplo.jus.br"],
    enabled: true,
    rateLimitPerMinute: 600,
    dailyRequestBudget: 500,
    ...overrides,
  });
}

/** Registers the sample a job will resolve to, keyed exactly as the transport looks it up. */
function stub(entries: Array<{ installationId: string; numero: string; from?: string; to?: string; body: string; page?: number }>) {
  const map = new Map<string, { contentType?: string; body: string; status?: number }>();
  for (const entry of entries) {
    map.set(fixtureKey(entry.installationId, "GET", "api/v1/comunicacao", {
      dataDisponibilizacaoInicio: entry.from ?? TODAY,
      dataDisponibilizacaoFim: entry.to ?? TODAY,
      numeroProcesso: entry.numero,
      itensPorPagina: 100,
      pagina: entry.page ?? 1,
    }), { body: entry.body });
  }
  setFixtureTransport(map);
}

test.after(() => resetTransport());

test("catalog: every judicial capability has an executor and a sane publication policy", () => {
  const judicialNames = capabilityNames.filter((name) => name.startsWith("k5_judicial_"));
  assert.equal(judicialNames.length, 13);

  const lawyerTools = publishedCapabilitiesForRole("lawyer", "agent");
  // Confirming a link authorizes recurring queries to a court; that stays with a person.
  assert.equal(lawyerTools.includes("k5_judicial_confirm_link"), false);
  assert.equal(lawyerTools.includes("k5_judicial_link_case"), true);

  // A reviewer reads and never writes, and this plan grants no new write permissions.
  const reviewerTools = publishedCapabilitiesForRole("reviewer", "agent").filter((name) => name.startsWith("k5_judicial_"));
  assert.deepEqual(reviewerTools.sort(), [
    "k5_judicial_get_job", "k5_judicial_get_publication", "k5_judicial_list_alerts",
    "k5_judicial_list_links", "k5_judicial_list_movements", "k5_judicial_list_publications", "k5_judicial_list_sources",
  ]);
});

test("linking: a proposed link never starts confirmed, whoever proposed it", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const result = await runCapability(context(officeA, lawyerA), "k5_judicial_link_case", {
    caseId: caseA, installationId: installation.id, number: "0000001-05.2025.8.26.0100", degree: "first",
  }) as Awaited<ReturnType<typeof judicial.linkJudicialCase>>;

  assert.equal(result.created, true);
  assert.equal(result.numberKind, "cnj");
  assert.equal(result.link.cnjNumber, VALID);
  assert.equal(result.link.confirmation, "pending_review", "a confirmação é um ato humano separado");

  // Re-linking the same proceeding is not an error and must not duplicate the row.
  const again = await runCapability(context(officeA, lawyerA), "k5_judicial_link_case", {
    caseId: caseA, installationId: installation.id, number: VALID, degree: "first",
  }) as typeof result;
  assert.equal(again.created, false);
  assert.equal(again.link.id, result.link.id);
});

test("linking: an unverifiable number is kept as native identity, not rejected", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const result = await runCapability(context(officeA, lawyerA), "k5_judicial_link_case", {
    caseId: caseA, installationId: installation.id, number: "583.00.2011.123456-7", degree: "first",
  }) as Awaited<ReturnType<typeof judicial.linkJudicialCase>>;

  assert.equal(result.numberKind, "native");
  assert.equal(result.link.cnjNumber, null);
  assert.equal(result.link.nativeNumber, "583.00.2011.123456-7");
});

test("isolation: a case from another office is not linkable and its links are invisible", async () => {
  const { officeA, lawyerA, caseB, officeB, lawyerB } = seed();
  const installation = await source();

  // The office comes from the trusted context, so naming another office's case finds nothing.
  await assert.rejects(
    async () => runCapability(context(officeA, lawyerA), "k5_judicial_link_case", {
      caseId: caseB, installationId: installation.id, number: VALID, degree: "first",
    }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );

  const { link } = await createCaseLink({
    officeId: officeB, userId: lawyerB, caseId: caseB, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  const seenByA = await runCapability(context(officeA, lawyerA), "k5_judicial_list_links", {}) as { links: Array<{ id: string }> };
  assert.equal(seenByA.links.some((item) => item.id === link.id), false, "vínculo de outro escritório não aparece");

  // And a forged link id from another office is a not-found, not a leak.
  await assert.rejects(
    () => runCapability(context(officeA, lawyerA), "k5_judicial_list_publications", { linkId: link.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );
});

test("links: unfiltered listings are bounded and the cursor advances without overlap", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  for (let index = 0; index < 25; index += 1) {
    await createCaseLink({
      officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
      cnjNumber: null, nativeNumber: `processo-${index}`, degree: "first", confirmed: true,
    });
  }

  const defaultPage = await runCapability(context(officeA, lawyerA), "k5_judicial_list_links", {}) as {
    links: Array<{ id: string }>;
    nextCursor: string | null;
  };
  assert.equal(defaultPage.links.length, 20);
  assert.equal(typeof defaultPage.nextCursor, "string");

  const capabilitySecondPage = await runCapability(context(officeA, lawyerA), "k5_judicial_list_links", {
    cursor: defaultPage.nextCursor,
  }) as typeof defaultPage;
  assert.equal(capabilitySecondPage.links.length, 5);
  assert.equal(capabilitySecondPage.nextCursor, null);
  assert.equal(capabilitySecondPage.links.some((link) => defaultPage.links.some((first) => first.id === link.id)), false);

  const firstPage = await listCaseLinks(officeA, { limit: 10 });
  const secondPage = await listCaseLinks(officeA, { limit: 10, cursor: firstPage.at(-1)?.id });
  assert.equal(firstPage.length, 10);
  assert.equal(secondPage.length, 10);
  assert.equal(secondPage.some((link) => firstPage.some((first) => first.id === link.id)), false);
});

test("inbox filters run before limits and collection state survives a reload", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const otherCase = randomUUID();
  testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, ?, ?)")
    .run(otherCase, officeA, "Outro caso", lawyerA);
  const installationA = await source();
  const installationB = await source();
  const linkA = (await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installationA.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  })).link;
  const linkB = (await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: otherCase, installationId: installationB.id,
    cnjNumber: VALID_OTHER, nativeNumber: null, degree: "first", confirmed: true,
  })).link;

  const ingest = async (installation: Awaited<ReturnType<typeof source>>, linkId: string, sourceId: string, cnjNumber: string, date: string) =>
    await ingestPublications({
      officeId: officeA,
      installation,
      linkId,
      jobId: null,
      historical: false,
      result: {
        cursor: null,
        coverage: { truncated: false, pagesFetched: 1, totalReported: 1, windowFrom: date, windowTo: date, rejected: 0 },
        source: { installationId: installation.id, operation: "listChanges", parserVersion: "test", collectedAt: `${date}T12:00:00.000Z` },
        rawPayloads: [{ contentType: "application/json", body: JSON.stringify({ sourceId }) }],
        items: [{
          sourcePublicationId: sourceId, cnjNumber, edition: "1", page: null, officialHash: null,
          body: sourceId, madeAvailableOn: date, publishedOn: date, sourceUpdatedAt: null,
          revisionKind: "original", rawPayloadIndex: 0,
        }],
      },
    });

  await ingest(installationA, linkA.id, `older-${randomUUID()}`, VALID, "2025-01-01");
  await ingest(installationB, linkB.id, `newer-${randomUUID()}`, VALID_OTHER, "2026-01-01");

  const alerts = await judicial.listJudicialAlerts(context(officeA, lawyerA), {
    caseId: caseA, installationId: installationA.id, unreadOnly: false, limit: 1,
  });
  assert.equal(alerts.alerts.length, 1);
  assert.equal(alerts.alerts[0]?.caseId, caseA);
  assert.equal(alerts.alerts[0]?.installationId, installationA.id);

  const publications = await judicial.listJudicialPublications(context(officeA, lawyerA), {
    caseId: caseA, installationId: installationA.id, limit: 1,
  });
  assert.equal(publications.publications.length, 1);
  assert.equal(publications.publications[0]?.installationId, installationA.id);

  const queued = await enqueueJob({
    officeId: officeA, installationId: installationA.id, linkId: linkA.id,
    kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] },
    windowFrom: TODAY, windowTo: TODAY,
  });
  const claimed = await claimJob();
  assert.equal(claimed?.job.id, queued.job.id);
  assert.equal(await completeJob(queued.job.id, claimed!.leaseOwner), true);

  const jobs = await judicial.listJudicialJobs(context(officeA, lawyerA), {
    caseId: caseA, installationId: installationA.id, status: "completed", limit: 1,
  });
  assert.equal(jobs.jobs[0]?.id, queued.job.id);
  assert.equal(jobs.jobs[0]?.linkId, linkA.id);

  const links = await judicial.listJudicialLinks(context(officeA, lawyerA), { caseId: caseA, limit: 20, activeOnly: true });
  assert.equal(links.jobs[0]?.id, queued.job.id);
  assert.equal(links.completedJobs[0]?.id, queued.job.id);
});

test("refresh: an unconfirmed link cannot spend a request against a court", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: false,
  });

  await assert.rejects(
    () => runCapability(context(officeA, lawyerA), "k5_judicial_request_refresh", { linkId: link.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "APPROVAL_REQUIRED",
  );

  await confirmCaseLink(officeA, link.id, lawyerA, "confirmed");
  const queued = await runCapability(context(officeA, lawyerA), "k5_judicial_request_refresh", { linkId: link.id }) as { job: { id: string; status: string }; created: boolean };
  assert.equal(queued.created, true);
  assert.equal(queued.job.status, "queued", "a coleta nunca roda dentro da requisição");

  // A second click while the first is pending reuses the job instead of queueing another.
  const repeated = await runCapability(context(officeA, lawyerA), "k5_judicial_request_refresh", { linkId: link.id }) as typeof queued;
  assert.equal(repeated.created, false);
  assert.equal(repeated.job.id, queued.job.id);
});

test("refresh: a source whose terms are unclear is not collected from", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source({ permissions: { query: "nao_esclarecido", cache: "nao_esclarecido" } });
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  await assert.rejects(
    () => runCapability(context(officeA, lawyerA), "k5_judicial_request_refresh", { linkId: link.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_READY",
  );
});

test("collection: originals, publications and alerts land together and a replay adds nothing", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });
  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);

  await runCapability(context(officeA, lawyerA), "k5_judicial_request_refresh", { linkId: link.id });
  const first = await processNextJudicialJob();
  assert.equal(first?.status, "completed");
  assert.equal(first?.inserted, 3);
  assert.equal(first?.alerts, 3);

  const snapshots = testDb.prepare("SELECT count(*) AS n FROM judicial_snapshot WHERE office_id = ?").get(officeA) as { n: number };
  assert.equal(snapshots.n, 1, "o original da página foi preservado");

  const publications = await runCapability(context(officeA, lawyerA), "k5_judicial_list_publications", { caseId: caseA }) as { publications: Array<{ id: string; snapshotId?: string }> };
  assert.equal(publications.publications.length, 3);

  // Running the identical window again is exactly what a retry does. It must be inert.
  clearBudget();
  const { job } = await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges",
    request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY,
  });
  const replay = await processNextJudicialJob();
  assert.equal(replay?.jobId, job.id);
  assert.equal(replay?.inserted, 0, "nenhuma publicação duplicada");
  assert.equal(replay?.duplicates, 3);
  assert.equal(replay?.alerts, 0, "e nenhum alerta repetido");

  const alerts = await runCapability(context(officeA, lawyerA), "k5_judicial_list_alerts", {}) as { alerts: Array<{ eventKind: string }> };
  assert.equal(alerts.alerts.length, 3);
  assert.equal(alerts.alerts.every((alert) => alert.eventKind === "new_publication"), true);
});

test("collection: the minimum spacing turns away a second sweep instead of asking the court twice", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  clearBudget();
  // One request per minute for this source: the second job in the same second must not go out.
  const installation = await source({ rateLimitPerMinute: 1 });
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);

  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  assert.equal((await processNextJudicialJob())?.status, "completed");

  const second = (await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "backfill", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: "2026-08-01", windowTo: "2026-08-31" })).job;
  const throttled = await processNextJudicialJob();
  assert.equal(throttled?.jobId, second.id);
  assert.equal(throttled?.status, "retrying", "o trabalho volta para a fila, não falha");
  assert.equal((await findJob(officeA, second.id))?.errorCode, "rate_limited");
});

test("collection: a backfill finding announces history, not news from today", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });
  stub([{ installationId: installation.id, numero: VALID, from: "2026-08-01", to: "2026-08-31", body: fixture("djen-page-1.json") }]);

  await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "backfill", operation: "listChanges",
    request: { cnjNumbers: [VALID] }, windowFrom: "2026-08-01", windowTo: "2026-08-31",
  });
  const outcome = await processNextJudicialJob();
  assert.equal(outcome?.status, "completed");

  const alerts = await runCapability(context(officeA, lawyerA), "k5_judicial_list_alerts", {}) as { alerts: Array<{ eventKind: string }> };
  // A month of history arriving at once must not read as a storm of today's updates.
  assert.equal(alerts.alerts.every((alert) => alert.eventKind === "historical_publication"), true);
});

test("collection: an errata is a new version related to the original, never an overwrite", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);
  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  await processNextJudicialJob();

  clearBudget();
  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-errata.json") }]);
  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  const outcome = await processNextJudicialJob();
  assert.equal(outcome?.inserted, 1);

  const rows = testDb.prepare(
    "SELECT revision_kind, supersedes_id, version FROM judicial_publication WHERE office_id = ? AND revision_kind = 'errata'",
  ).all(officeA) as Array<{ revision_kind: string; supersedes_id: string | null; version: number }>;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].supersedes_id, null, "a errata aponta para a publicação que corrige");
  assert.equal(rows[0].version, 2);

  // The original is still there, unchanged: the record of what was first published survives.
  const originals = testDb.prepare(
    "SELECT count(*) AS n FROM judicial_publication WHERE office_id = ? AND revision_kind = 'original'",
  ).get(officeA) as { n: number };
  assert.equal(originals.n, 3);

  const alerts = await runCapability(context(officeA, lawyerA), "k5_judicial_list_alerts", {}) as { alerts: Array<{ eventKind: string }> };
  assert.equal(alerts.alerts.some((alert) => alert.eventKind === "correction"), true);
});

test("collection: two offices tracking the same proceeding keep separate evidence", async () => {
  const { officeA, officeB, lawyerA, lawyerB, caseA, caseB } = seed();
  clearQueue();
  const installation = await source();
  const linkA = (await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true })).link;
  const linkB = (await createCaseLink({ officeId: officeB, userId: lawyerB, caseId: caseB, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true })).link;

  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);
  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: linkA.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  await enqueueJob({ officeId: officeB, installationId: installation.id, linkId: linkB.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  await processNextJudicialJob();
  clearBudget();
  await processNextJudicialJob();

  const forA = await runCapability(context(officeA, lawyerA), "k5_judicial_list_publications", {}) as { publications: Array<{ id: string }> };
  const forB = await runCapability(context(officeB, lawyerB), "k5_judicial_list_publications", {}) as { publications: Array<{ id: string }> };
  assert.equal(forA.publications.length, 3);
  assert.equal(forB.publications.length, 3);

  // Same gazette, same text, two offices: no row and no cached snapshot is shared between them.
  const idsA = new Set(forA.publications.map((item) => item.id));
  assert.equal(forB.publications.some((item) => idsA.has(item.id)), false);

  await assert.rejects(
    () => runCapability(context(officeA, lawyerA), "k5_judicial_get_publication", { publicationId: forB.publications[0].id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );
});

test("evidence: an opened publication carries its origin and is labelled untrusted", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);
  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  await processNextJudicialJob();

  const list = await runCapability(context(officeA, lawyerA), "k5_judicial_list_publications", {}) as {
    publications: Array<{ id: string; collectedAt: string; madeAvailableOn: string | null }>;
    untrustedContent: true;
  };
  assert.equal(list.untrustedContent, true);
  const opened = await runCapability(context(officeA, lawyerA), "k5_judicial_get_publication", { publicationId: list.publications[0].id }) as {
    body: string; snapshotId: string; untrustedContent: true; publication: { collectedAt: string };
  };

  assert.equal(opened.untrustedContent, true);
  assert.notEqual(opened.snapshotId, "", "toda publicação resolve para o original preservado");
  assert.notEqual(opened.publication.collectedAt, null, "quando o Lume consultou é um campo próprio");

  // The injection-shaped text in the fixture is returned as data, with nothing acting on it.
  const injected = list.publications.find((item) => item.madeAvailableOn === "2026-09-10");
  assert.notEqual(injected, undefined);
});

test("queue: a lease is exclusive, and an exhausted job stops instead of looping", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const { job } = await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: {}, windowFrom: TODAY, windowTo: TODAY });

  const first = await claimJob();
  assert.equal(first?.job.id, job.id);
  assert.equal(first?.job.attempts, 1);
  // A second worker arriving while the lease still holds must find nothing, not the same job.
  assert.equal(await claimJob(), undefined);

  // A worker that dies leaves an expired lease with its attempt already spent. Time has to move
  // past the lease on each pass, otherwise the job is simply still leased to the previous owner.
  const hour = 60 * 60 * 1000;
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const reclaimed = await claimJob(Date.now() + attempt * hour);
    assert.equal(reclaimed?.job.id, job.id, `tentativa ${attempt} deveria ser reivindicável`);
    assert.equal(reclaimed?.job.attempts, attempt);
  }

  // Attempts exhausted: the next sweep fails it explicitly instead of leaving it 'running'
  // forever with nobody working it.
  assert.equal(await claimJob(Date.now() + (MAX_ATTEMPTS + 1) * hour), undefined, "esgotadas as tentativas, ninguém mais reivindica");
  assert.equal((await findJob(officeA, job.id))?.status, "failed");
  assert.match((await findJob(officeA, job.id))?.errorMessage ?? "", /esgotou as tentativas/);
});

test("queue: a rejected credential stops the subscription instead of retrying forever", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const { subscription } = await createSubscription({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    targetKind: "publications_by_case", authorizedBy: lawyerA,
  });
  const { job } = await enqueueJob({
    officeId: officeA, installationId: installation.id, subscriptionId: subscription.id, linkId: link.id,
    kind: "refresh", operation: "listChanges", request: {}, windowFrom: TODAY, windowTo: TODAY,
  });

  const claimed = await claimJob();
  assert.equal(claimed?.job.id, job.id);
  const outcome = await failJob(job.id, claimed!.leaseOwner, { code: "unauthorized", message: "A fonte recusou a credencial." });

  assert.equal(outcome.retrying, false, "credencial recusada não é condição transitória");
  assert.equal((await findJob(officeA, job.id))?.status, "failed");
  assert.equal((await findSubscriptionById(subscription.id))?.status, "suspended", "a assinatura pede intervenção humana");
});

test("queue: a changed schema is quarantined, a rate limit is rescheduled", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });

  const quarantined = (await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: {}, windowFrom: TODAY, windowTo: TODAY })).job;
  const claimA = (await claimJob())!;
  // The payloads are already stored; the fix is a parser change, not another request.
  await failJob(quarantined.id, claimA.leaseOwner, { code: "schema_changed", message: "Formato inesperado." });
  assert.equal((await findJob(officeA, quarantined.id))?.status, "quarantined");

  const limited = (await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "backfill", operation: "listChanges", request: {}, windowFrom: "2026-01-01", windowTo: "2026-01-05" })).job;
  const claimB = (await claimJob())!;
  const outcome = await failJob(limited.id, claimB.leaseOwner, { code: "rate_limited", message: "429", retryAfterSeconds: 120 });
  assert.equal(outcome.retrying, true);
  assert.equal((await findJob(officeA, limited.id))?.status, "queued");
  // Retry-After is obeyed, so the job is not eligible again immediately.
  assert.equal(await claimJob(), undefined);
});

test("budget: the daily ceiling and the minimum spacing are enforced in the database", async () => {
  const { officeA } = seed();
  const installation = await source({ rateLimitPerMinute: 1, dailyRequestBudget: 2 });
  const shape = { id: installation.id, dailyRequestBudget: 2, rateLimitPerMinute: 1 };
  const now = Date.parse("2026-09-18T10:00:00Z");

  assert.deepEqual(await reserveRequestBudget(officeA, shape, now), { allowed: true });
  // One request per minute means the next one is not due yet, however many workers ask.
  const spaced = await reserveRequestBudget(officeA, shape, now + 1_000);
  assert.equal(spaced.allowed, false);
  if (!spaced.allowed) assert.equal(spaced.reason, "rate_limit");

  assert.deepEqual(await reserveRequestBudget(officeA, shape, now + 61_000), { allowed: true });
  const exhausted = await reserveRequestBudget(officeA, shape, now + 122_000);
  assert.equal(exhausted.allowed, false);
  if (!exhausted.allowed) assert.equal(exhausted.reason, "daily_budget");
});

test("scheduler: a subscription with nothing confirmed asks the court nothing", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: false });
  const { subscription } = await createSubscription({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    targetKind: "publications_by_case", authorizedBy: lawyerA,
  });

  const outcome = await scheduleDueSubscriptions();
  const mine = outcome.skipped.find((entry) => entry.subscriptionId === subscription.id);
  assert.match(mine?.reason ?? "", /aguarda confirmação/);
  assert.equal(outcome.queued, 0, "nenhuma consulta é enviada a um tribunal por um vínculo não confirmado");

  // Waiting on a review is not a revocation: the subscription is deferred, so confirming the
  // link later actually resumes collection instead of leaving a permanently suspended row.
  assert.equal((await findSubscriptionById(subscription.id))?.status, "active");
  assert.equal((await findSubscriptionById(subscription.id))!.nextRunAt > Date.now(), true);

  await confirmCaseLink(officeA, link.id, lawyerA, "confirmed");
  testDb.prepare("UPDATE judicial_subscription SET next_run_at = 0 WHERE id = ?").run(subscription.id);
  const resumed = await scheduleDueSubscriptions();
  assert.equal(resumed.queued >= 1, true, "confirmado o vínculo, a assinatura volta a agendar");
});

test("scheduler: losing the membership that authorized a subscription suspends it", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const { subscription } = await createSubscription({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    targetKind: "publications_by_case", authorizedBy: lawyerA,
  });
  assert.deepEqual(await subscriptionStillAuthorized((await findSubscriptionById(subscription.id))!), { ok: true });

  testDb.prepare("DELETE FROM office_member WHERE user_id = ? AND office_id = ?").run(lawyerA, officeA);

  const revoked = await subscriptionStillAuthorized((await findSubscriptionById(subscription.id))!);
  assert.equal(revoked.ok, false);

  await scheduleDueSubscriptions();
  assert.equal((await findSubscriptionById(subscription.id))?.status, "suspended");
  assert.equal((await listDueSubscriptions()).some((entry) => entry.id === subscription.id), false);
});

test("subscriptions: active retries preserve notification opt-outs; reactivation restores following", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const input = { officeId: officeA, installationId: installation.id, linkId: link.id,
    targetKind: "publications_by_case" as const, authorizedBy: lawyerA };
  const { subscription } = await createSubscription(input);
  const activeFollowers = () => testDb.prepare('SELECT count(*) AS total FROM notification_follow WHERE office_id=? AND case_id=? AND user_id=? AND ended_at IS NULL').get(officeA, caseA, lawyerA)!.total;
  assert.equal(activeFollowers(), 1);
  testDb.prepare('UPDATE notification_follow SET ended_at=CURRENT_TIMESTAMP WHERE office_id=? AND case_id=? AND user_id=?').run(officeA, caseA, lawyerA);
  await createSubscription(input);
  assert.equal(activeFollowers(), 0);
  testDb.prepare("UPDATE judicial_subscription SET status='paused' WHERE id=?").run(subscription.id);
  await createSubscription(input);
  assert.equal(activeFollowers(), 1);
  testDb.prepare("UPDATE judicial_subscription SET status='cancelled' WHERE id=?").run(subscription.id);
});

test("unlinking: collection stops and the evidence already gathered is kept", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const { subscription } = await createSubscription({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    targetKind: "publications_by_case", authorizedBy: lawyerA,
  });
  stub([{ installationId: installation.id, numero: VALID, body: fixture("djen-page-1.json") }]);
  await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY });
  await processNextJudicialJob();

  const pending = (await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "refresh", operation: "listChanges", request: {}, windowFrom: TODAY, windowTo: TODAY })).job;
  assert.equal(await unlinkCase(officeA, link.id), true);

  assert.equal((await findSubscriptionById(subscription.id))?.status, "cancelled", "a autorização recorrente cai junto");
  assert.equal((await findJob(officeA, pending.id))?.status, "cancelled");
  assert.equal((await listCaseLinks(officeA, { activeOnly: true })).some((item) => item.id === link.id), false);

  // The publications stay: they are evidence of what a gazette published, not a consequence of
  // the link still existing.
  const kept = testDb.prepare("SELECT count(*) AS n FROM judicial_publication WHERE office_id = ?").get(officeA) as { n: number };
  assert.equal(kept.n, 3);
});

test("authorization: a reviewer reads judicial data and writes none of it", async () => {
  const { officeA, lawyerA, reviewerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });

  const read = await runCapability(context(officeA, reviewerA, "reviewer"), "k5_judicial_list_links", {}) as { links: unknown[] };
  assert.equal(Array.isArray(read.links), true);

  for (const [name, input] of [
    ["k5_judicial_link_case", { caseId: caseA, installationId: installation.id, number: VALID_OTHER, degree: "first" }],
    ["k5_judicial_request_refresh", { linkId: link.id }],
    ["k5_judicial_unlink_case", { linkId: link.id }],
  ] as const) {
    await assert.rejects(
      () => runCapability(context(officeA, reviewerA, "reviewer"), name, input),
      (error: unknown) => error instanceof CapabilityError && error.code === "FORBIDDEN",
      `${name} deveria ser negada ao revisor`,
    );
  }
});

test("authorization: a membership revoked mid-turn stops the next judicial write", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const trusted = context(officeA, lawyerA);

  await runCapability(trusted, "k5_judicial_link_case", { caseId: caseA, installationId: installation.id, number: VALID, degree: "first" });
  testDb.prepare("DELETE FROM office_member WHERE user_id = ? AND office_id = ?").run(lawyerA, officeA);

  // The context was built before the removal; the check is re-read, not trusted from earlier.
  await assert.rejects(
    async () => runCapability(trusted, "k5_judicial_link_case", { caseId: caseA, installationId: installation.id, number: VALID_OTHER, degree: "first" }),
    (error: unknown) => error instanceof CapabilityError && error.code === "FORBIDDEN",
  );
});

test("durability: a job completed by its lease holder cannot be completed twice", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true });
  const { job } = await enqueueJob({ officeId: officeA, installationId: installation.id, linkId: link.id, kind: "manual", operation: "listChanges", request: {}, windowFrom: TODAY, windowTo: TODAY });

  const claimed = (await claimJob())!;
  assert.equal(await completeJob(job.id, claimed.leaseOwner), true);
  // A stale worker returning with the same owner after the lease was released changes nothing.
  assert.equal(await completeJob(job.id, claimed.leaseOwner), false);
  assert.equal(await completeJob(job.id, "outro-dono"), false);
});

test("collector: malformed upstream response is preserved in judicial_snapshot when job is quarantined", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  clearBudget();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  const malformedBody = fixture("djen-schema-changed.json");
  stub([{ installationId: installation.id, numero: VALID, body: malformedBody }]);

  const { job } = await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges",
    request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY,
  });

  const outcome = await processNextJudicialJob();
  assert.equal(outcome?.status, "quarantined");
  assert.equal((await findJob(officeA, job.id))?.status, "quarantined");

  // The malformed response MUST be preserved in judicial_snapshot for operator diagnosis
  const snapshot = testDb.prepare(
    "SELECT payload, sha256 FROM judicial_snapshot WHERE office_id = ? AND job_id = ?",
  ).get(officeA, job.id) as { payload: string; sha256: string } | undefined;

  assert.notEqual(snapshot, undefined, "o snapshot da resposta malformada deve estar salvo");
  assert.equal(snapshot?.payload, malformedBody);
});

test("provenance: publications across multiple pages/responses retain their respective matching snapshot ID", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  const page1Body = JSON.stringify({
    status: "success",
    count: 1,
    items: [{
      id: "pub-p1",
      numeroProcesso: VALID,
      numeroEdicao: "100",
      dataDisponibilizacao: "2026-09-10",
      texto: "Publicação da página 1",
    }],
  });
  const page2Body = JSON.stringify({
    status: "success",
    count: 1,
    items: [{
      id: "pub-p2",
      numeroProcesso: VALID,
      numeroEdicao: "101",
      dataDisponibilizacao: "2026-09-11",
      texto: "Publicação da página 2",
    }],
  });

  const outcome = await ingestPublications({
    officeId: officeA,
    installation,
    linkId: link.id,
    jobId: "job-multi-page",
    historical: false,
    result: {
      cursor: null,
      coverage: { truncated: false, pagesFetched: 2, totalReported: 2, windowFrom: TODAY, windowTo: TODAY, rejected: 0 },
      source: { installationId: installation.id, operation: "listChanges", parserVersion: "test", collectedAt: new Date().toISOString() },
      rawPayloads: [
        { contentType: "application/json", body: page1Body },
        { contentType: "application/json", body: page2Body },
      ],
      items: [
        {
          sourcePublicationId: "pub-p1",
          cnjNumber: VALID,
          edition: "100",
          page: null,
          officialHash: null,
          body: "Publicação da página 1",
          madeAvailableOn: "2026-09-10",
          publishedOn: null,
          sourceUpdatedAt: null,
          revisionKind: "original",
          rawPayloadIndex: 0,
        },
        {
          sourcePublicationId: "pub-p2",
          cnjNumber: VALID,
          edition: "101",
          page: null,
          officialHash: null,
          body: "Publicação da página 2",
          madeAvailableOn: "2026-09-11",
          publishedOn: null,
          sourceUpdatedAt: null,
          revisionKind: "original",
          rawPayloadIndex: 1,
        },
      ],
    },
  });

  assert.equal(outcome.snapshotIds.length, 2);
  assert.notEqual(outcome.snapshotIds[0], outcome.snapshotIds[1]);

  const p1 = testDb.prepare("SELECT snapshot_id FROM judicial_publication WHERE office_id = ? AND source_publication_id = 'pub-p1'").get(officeA) as { snapshot_id: string };
  const p2 = testDb.prepare("SELECT snapshot_id FROM judicial_publication WHERE office_id = ? AND source_publication_id = 'pub-p2'").get(officeA) as { snapshot_id: string };

  assert.equal(p1.snapshot_id, outcome.snapshotIds[0], "publicação da página 1 aponta para o snapshot 1");
  assert.equal(p2.snapshot_id, outcome.snapshotIds[1], "publicação da página 2 aponta para o snapshot 2");
});

test("scheduler: an individual case subscription schedules collection only for that case's linked CNJ", async () => {
  const { officeA, lawyerA, caseA, caseB } = seed();
  const installation = await source();
  const linkA = (await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id, cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true })).link;
  await createCaseLink({ officeId: officeA, userId: lawyerA, caseId: caseB, installationId: installation.id, cnjNumber: VALID_OTHER, nativeNumber: null, degree: "first", confirmed: true });

  clearQueue();
  const { subscription } = await createSubscription({
    officeId: officeA, installationId: installation.id, linkId: linkA.id,
    targetKind: "publications_by_case", authorizedBy: lawyerA,
  });

  const outcome = await scheduleDueSubscriptions();
  assert.equal(outcome.queued, 1);

  const queuedJob = testDb.prepare(
    "SELECT request FROM judicial_sync_job WHERE office_id = ? AND subscription_id = ?",
  ).get(officeA, subscription.id) as { request: string };

  const parsedRequest = JSON.parse(queuedJob.request) as { cnjNumbers: string[] };
  assert.deepEqual(parsedRequest.cnjNumbers, [VALID], "apenas o CNJ vinculado a esta assinatura deve ser consultado");
  assert.equal(parsedRequest.cnjNumbers.includes(VALID_OTHER), false, "não deve incluir o CNJ do outro caso");
});

test("collector: budget is reserved and enforced for each physical transport request", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  clearBudget();
  // Set rateLimit high so spacing doesn't block, but dailyRequestBudget is strictly 2
  const installation = await source({ rateLimitPerMinute: 600, dailyRequestBudget: 2 });
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  stub([
    { installationId: installation.id, numero: VALID, body: fixture("djen-empty.json") },
    { installationId: installation.id, numero: VALID_OTHER, body: fixture("djen-empty.json") },
  ]);

  await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges",
    request: { cnjNumbers: [VALID, VALID_OTHER] }, windowFrom: TODAY, windowTo: TODAY,
  });

  await processNextJudicialJob();
  // 2 physical transport requests were made (1 for VALID, 1 for VALID_OTHER)
  assert.equal(await requestsUsedToday(officeA, installation.id), 2);

  // Now daily budget (2) is completely exhausted. A third request must fail immediately.
  const { job: job2 } = await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges",
    request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY,
  });

  const outcome2 = await processNextJudicialJob();
  assert.equal(outcome2?.status, "retrying");
  assert.equal((await findJob(officeA, job2.id))?.errorCode, "rate_limited");
  assert.match((await findJob(officeA, job2.id))?.errorMessage ?? "", /Orçamento diário/);
});

test("collector: configured spacing above ten seconds is awaited between requests", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  clearBudget();
  const installation = await source({ rateLimitPerMinute: 5, dailyRequestBudget: 10 });
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });
  stub([
    { installationId: installation.id, numero: VALID, body: fixture("djen-empty.json") },
    { installationId: installation.id, numero: VALID_OTHER, body: fixture("djen-empty.json") },
  ]);
  await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges", request: { cnjNumbers: [VALID, VALID_OTHER] },
    windowFrom: TODAY, windowTo: TODAY,
  });

  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let clock = originalNow();
  const waits: number[] = [];
  Date.now = () => clock;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const milliseconds = Number(delay ?? 0);
    waits.push(milliseconds);
    clock += milliseconds;
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    const outcome = await processNextJudicialJob(clock);
    assert.equal(outcome?.status, "completed");
    assert.equal(waits.some((delay) => delay > 10_000), true);
    assert.equal(await requestsUsedToday(officeA, installation.id, clock), 2);
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("collector: a worker that loses its lease stops before persistence or completion", async () => {
  const { officeA, lawyerA, caseA } = seed();
  clearQueue();
  clearBudget();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });
  const { job } = await enqueueJob({
    officeId: officeA, installationId: installation.id, linkId: link.id,
    kind: "manual", operation: "listChanges",
    request: { cnjNumbers: [VALID] }, windowFrom: TODAY, windowTo: TODAY,
  });

  const fixtures = new Map([[fixtureKey(installation.id, "GET", "api/v1/comunicacao", {
    dataDisponibilizacaoInicio: TODAY,
    dataDisponibilizacaoFim: TODAY,
    numeroProcesso: VALID,
    itensPorPagina: 100,
    pagina: 1,
  }), { body: fixture("djen-empty.json") }]]);

  // Another worker takes the lease while the request is in flight, and the steal is complete
  // before the response comes back — which is the situation the collector has to survive.
  let replacement: Awaited<ReturnType<typeof claimJob>>;
  setFixtureTransport(fixtures, async () => {
    replacement ??= await claimJob(Date.now() + 6 * 60 * 1000);
  });

  const outcome = await processNextJudicialJob();
  assert.equal(outcome?.status, "skipped");
  assert.equal(replacement?.job.id, job.id);
  assert.equal((await findJob(officeA, job.id))?.status, "running");
  const snapshots = testDb.prepare("SELECT count(*) AS count FROM judicial_snapshot WHERE job_id = ?").get(job.id) as { count: number };
  assert.equal(snapshots.count, 0);
  await completeJob(job.id, replacement!.leaseOwner);
});

test("evidence: an oversized response rejects the transaction and does not write a synthetic storage key", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });

  // Create a payload larger than 512 KiB
  const bigBody = "x".repeat(513 * 1024);

  await assert.rejects(
    () => ingestPublications({
      officeId: officeA,
      installation,
      linkId: link.id,
      jobId: "job-oversized",
      historical: false,
      result: {
        cursor: null,
        coverage: { truncated: false, pagesFetched: 1, totalReported: 0, windowFrom: TODAY, windowTo: TODAY, rejected: 0 },
        source: { installationId: installation.id, operation: "listChanges", parserVersion: "test", collectedAt: new Date().toISOString() },
        rawPayloads: [{ contentType: "text/plain", body: bigBody }],
        items: [],
      },
    }),
    (error: unknown) => error instanceof ConnectorError && error.code === "partial",
  );

  // Assert no snapshot was committed with a synthetic storage key
  const snapshotCount = testDb.prepare(
    "SELECT count(*) as count FROM judicial_snapshot WHERE office_id = ? AND job_id = 'job-oversized'",
  ).get(officeA) as { count: number };
  assert.equal(snapshotCount.count, 0, "nenhum snapshot deve ser persistido quando excede o limite");
});

test("cross-case isolation: publications belonging to another confirmed case resolve to that case link rather than the job's fallback link", async () => {
  const { officeA, lawyerA, caseA, caseB } = seed();
  const installation = await source();
  const { link: linkA } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: true,
  });
  const { link: linkB } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseB, installationId: installation.id,
    cnjNumber: VALID_OTHER, nativeNumber: null, degree: "first", confirmed: true,
  });

  const outcome = await ingestPublications({
    officeId: officeA,
    installation,
    linkId: linkA.id, // Job was run with linkA
    jobId: "job-cross-case-test",
    historical: false,
    result: {
      cursor: null,
      coverage: { truncated: false, pagesFetched: 1, totalReported: 2, windowFrom: TODAY, windowTo: TODAY, rejected: 0 },
      source: { installationId: installation.id, operation: "listChanges", parserVersion: "test", collectedAt: new Date().toISOString() },
      rawPayloads: [{ contentType: "application/json", body: '{"items":[]}' }],
      items: [
        {
          sourcePublicationId: "pub-case-a",
          cnjNumber: VALID,
          edition: "500",
          page: null,
          officialHash: null,
          body: "Publicação do caso A",
          madeAvailableOn: TODAY,
          publishedOn: null,
          sourceUpdatedAt: null,
          revisionKind: "original",
          rawPayloadIndex: 0,
        },
        {
          sourcePublicationId: "pub-case-b",
          cnjNumber: VALID_OTHER, // Belongs to Case B!
          edition: "501",
          page: null,
          officialHash: null,
          body: "Publicação do caso B",
          madeAvailableOn: TODAY,
          publishedOn: null,
          sourceUpdatedAt: null,
          revisionKind: "original",
          rawPayloadIndex: 0,
        },
      ],
    },
  });

  assert.equal(outcome.inserted, 2);
  const pubA = testDb.prepare(
    "SELECT link_id FROM judicial_publication WHERE office_id = ? AND source_publication_id = 'pub-case-a'",
  ).get(officeA) as { link_id: string | null };

  const pubB = testDb.prepare(
    "SELECT link_id FROM judicial_publication WHERE office_id = ? AND source_publication_id = 'pub-case-b'",
  ).get(officeA) as { link_id: string | null };

  assert.equal(pubA.link_id, linkA.id, "publicação do caso A deve ser atribuída ao linkA");
  assert.equal(pubB.link_id, linkB.id, "publicação do caso B deve ser atribuída ao linkB e nunca ao linkA");

  const alertB = testDb.prepare(
    "SELECT link_id FROM judicial_alert WHERE office_id = ? AND subject_id = (SELECT id FROM judicial_publication WHERE source_publication_id = 'pub-case-b')",
  ).get(officeA) as { link_id: string | null };

  assert.equal(alertB.link_id, linkB.id, "alerta do caso B deve ser direcionado para linkB");
});

test("scheduler: scheduleBackfill rejects unconfirmed case link rather than doing an unauthorized broad sweep", async () => {
  const { officeA, lawyerA, caseA } = seed();
  const installation = await source();
  const { link: pendingLink } = await createCaseLink({
    officeId: officeA, userId: lawyerA, caseId: caseA, installationId: installation.id,
    cnjNumber: VALID, nativeNumber: null, degree: "first", confirmed: false,
  });

  await assert.rejects(
    () => scheduleBackfill({
      officeId: officeA,
      installationId: installation.id,
      linkId: pendingLink.id,
    }),
    (error: unknown) => error instanceof ConnectorError && error.code === "human_action_required",
  );
});
