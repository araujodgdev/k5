import { testDatabase, testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { WorkspaceContext } from "../src/lib/application/context";
import { runCapability } from "../src/lib/agent-tools";
import { CapabilityError } from "../src/lib/capabilities/errors";
import { capabilities } from "../src/lib/capabilities/contracts";
import { fixtureKey } from "../src/lib/judicial/connectors/transport";
import { resetTransport, setFixtureTransport } from "../src/lib/judicial/connectors";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { createCaseLink } from "../src/lib/judicial/repositories/links";
import { createSubscription } from "../src/lib/judicial/repositories/subscriptions";
import { enqueueJob } from "../src/lib/judicial/jobs/queue";
import { processNextJudicialJob } from "../src/lib/judicial/jobs/collector";
import { scheduleDueSubscriptions } from "../src/lib/judicial/jobs/scheduler";

const CNJ = "00000010520258260100";
const OK = readFileSync(new URL("./fixtures/judicial/mni-consultarProcesso-ok.xml", import.meta.url), "utf8");

/** The successful response with extra movements appended to the process. */
const withMovements = (extra: string) => OK.replace("      </processo>", `${extra}\n      </processo>`);
const movement = (dataHora: string, body: string, id?: string) =>
  `<movimento dataHora="${dataHora}"${id ? ` identificadorMovimento="${id}"` : ""}>${body}</movimento>`;

function context(officeId: string, userId: string): WorkspaceContext {
  return { officeId, userId, role: "lawyer" };
}

let counter = 0;
async function scenario() {
  counter += 1;
  const officeA = randomUUID(); const officeB = randomUUID();
  const userA = randomUUID(); const userB = randomUUID();
  const caseA = randomUUID(); const caseB = randomUUID();
  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?), (?, ?, ?)").run(
    userA, `${userA}@a.test`, "Advogada A", userB, `${userB}@b.test`, "Advogado B");
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?), (?, ?)").run(officeA, "Escritório A", officeB, "Escritório B");
  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, 'lawyer'), (?, ?, ?, 'lawyer')").run(
    randomUUID(), officeA, userA, randomUUID(), officeB, userB);
  testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, ?, ?), (?, ?, ?, ?)").run(
    caseA, officeA, `Caso A ${counter}`, userA, caseB, officeB, `Caso B ${counter}`, userB);

  const installation = await upsertInstallation({
    kind: "mni", courtCode: `TJCASE${counter}`, courtName: "Tribunal Sintético", degree: "first", system: "pje",
    purpose: "case_tracking", baseUrl: "https://pje.exemplo.jus.br/pje/intercomunicacao", authKind: "none",
    permissions: { query: "permitido", cache: "permitido" }, allowedHosts: ["pje.exemplo.jus.br"],
    enabled: true, rateLimitPerMinute: 600, dailyRequestBudget: 500,
  });
  const { link } = await createCaseLink({
    officeId: officeA, userId: userA, caseId: caseA, installationId: installation.id,
    cnjNumber: CNJ, nativeNumber: null, degree: "first", confirmed: true,
  });
  return { officeA, officeB, userA, userB, caseA, caseB, installation, link };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

/** Answers the next lookup with `body` and runs exactly one job for the scenario's link. */
async function collect(s: Scenario, body: string) {
  testDb.exec("UPDATE judicial_sync_job SET status = 'cancelled', lease_owner = NULL, lease_until = 0 WHERE status IN ('queued','running')");
  testDb.exec("DELETE FROM judicial_rate_budget");
  setFixtureTransport(new Map([[fixtureKey(s.installation.id, "POST", ""), { body, contentType: "text/xml" }]]));
  try {
    const { job } = await enqueueJob({
      officeId: s.officeA, installationId: s.installation.id, linkId: s.link.id, kind: "manual", operation: "lookupCase",
    });
    const outcome = await processNextJudicialJob();
    assert.equal(outcome?.jobId, job.id);
    return outcome!;
  } finally {
    resetTransport();
  }
}

const count = (sql: string, ...params: string[]) => (testDb.prepare(sql).get(...params) as { n: number }).n;
const movementsOf = (officeId: string) => count("SELECT COUNT(*) AS n FROM judicial_movement WHERE office_id = ?", officeId);
const alertsOf = (officeId: string) => count("SELECT COUNT(*) AS n FROM judicial_alert WHERE office_id = ? AND event_kind = 'new_movement'", officeId);

test("primeira coleta grava linha de base sem alertas", async () => {
  const s = await scenario();
  const outcome = await collect(s, OK);
  assert.equal(outcome.status, "completed", outcome.detail);
  assert.equal(outcome.inserted, 3);
  assert.equal(movementsOf(s.officeA), 3);
  assert.equal(alertsOf(s.officeA), 0, "uma vida inteira de movimentos não é notícia");
  assert.match(outcome.detail, /linha de base/);
});

test("reexecutar o job é inerte", async () => {
  const s = await scenario();
  await collect(s, OK);
  const again = await collect(s, OK);
  assert.equal(again.inserted, 0);
  assert.equal(again.duplicates, 3);
  assert.equal(movementsOf(s.officeA), 3);
  assert.equal(alertsOf(s.officeA), 0);
});

test("movimento novo gera um alerta e só um", async () => {
  const s = await scenario();
  await collect(s, OK);
  const next = withMovements(movement("20250301090000", '<movimentoNacional codigoNacional="123"/>', "mov-novo"));
  const outcome = await collect(s, next);
  assert.equal(outcome.inserted, 1);
  assert.equal(outcome.alerts, 1);
  const replay = await collect(s, next);
  assert.equal(replay.alerts, 0);
  assert.equal(alertsOf(s.officeA), 1);

  const alert = testDb.prepare("SELECT summary, link_id FROM judicial_alert WHERE office_id = ? AND event_kind = 'new_movement'").get(s.officeA) as { summary: string; link_id: string };
  assert.equal(alert.link_id, s.link.id);
  assert.equal(alert.summary, "Novo movimento em Tribunal Sintético, registrado em 2025-03-01.");
});

test("mesmo código e mesmo dia com textos diferentes são dois movimentos", async () => {
  const s = await scenario();
  const body = withMovements([
    movement("20250401100000", '<complemento>Juntada de petição do autor</complemento><movimentoLocal codigoMovimento="85" descricao="Juntada"/>'),
    movement("20250401100000", '<complemento>Juntada de petição do réu</complemento><movimentoLocal codigoMovimento="85" descricao="Juntada"/>'),
  ].join("\n"));
  await collect(s, body);
  assert.equal(count("SELECT COUNT(*) AS n FROM judicial_movement WHERE office_id = ? AND source_code = '85'", s.officeA), 2);
});

test("sem código declarado, tpu_code fica nulo", async () => {
  const s = await scenario();
  await collect(s, withMovements(movement("20250402100000", "<complemento>Certidão de publicação expedida</complemento>", "sem-codigo")));
  const row = testDb.prepare("SELECT source_code, tpu_code, tpu_source FROM judicial_movement WHERE office_id = ? AND source_movement_id = 'sem-codigo'")
    .get(s.officeA) as { source_code: string | null; tpu_code: string | null; tpu_source: string | null };
  assert.deepEqual({ ...row }, { source_code: null, tpu_code: null, tpu_source: null });
  // A local code is kept as the source wrote it and never promoted to TPU.
  const local = testDb.prepare("SELECT source_code, tpu_code FROM judicial_movement WHERE office_id = ? AND source_movement_id = 'mov-2'")
    .get(s.officeA) as { source_code: string; tpu_code: string | null };
  assert.deepEqual({ ...local }, { source_code: "9001", tpu_code: null });
});

test("queda antes do commit não deixa movimento órfão", async () => {
  const s = await scenario();
  const originalBatch = testDatabase.batch;
  let crashed = false;
  // Only the commit of the collected record fails; the failure path that records the gap runs.
  testDatabase.batch = async (statements) => {
    if (!crashed) { crashed = true; throw new Error("queda simulada entre o download e o commit"); }
    return originalBatch.call(testDatabase, statements);
  };
  try {
    const failed = await collect(s, OK);
    assert.notEqual(failed.status, "completed");
  } finally {
    testDatabase.batch = originalBatch;
  }
  assert.ok(count("SELECT COUNT(*) AS n FROM judicial_snapshot WHERE office_id = ?", s.officeA) >= 1, "o original foi preservado");
  assert.equal(movementsOf(s.officeA), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM judicial_source_record WHERE office_id = ? AND record_kind = 'case'", s.officeA), 0);
  assert.equal(count(`SELECT COUNT(*) AS n FROM judicial_movement m
    LEFT JOIN judicial_snapshot sn ON sn.id = m.snapshot_id WHERE sn.id IS NULL`), 0);

  // The retry is still the first complete collection: a baseline, not an avalanche of alerts.
  const retry = await collect(s, OK);
  assert.equal(retry.inserted, 3);
  assert.equal(alertsOf(s.officeA), 0);
});

test("isolamento entre escritórios em rota, capacidade e ferramenta", async () => {
  const s = await scenario();
  await collect(s, OK);

  const own = await runCapability(context(s.officeA, s.userA), "k5_judicial_list_movements", { linkId: s.link.id }) as { movements: unknown[] };
  assert.equal(own.movements.length, 3);

  await assert.rejects(
    runCapability(context(s.officeB, s.userB), "k5_judicial_list_movements", { linkId: s.link.id }),
    (error: unknown) => error instanceof CapabilityError && error.code === "NOT_FOUND",
  );
  // Asking by the other office's case, or with no filter, returns nothing from A.
  const byCase = await runCapability(context(s.officeB, s.userB), "k5_judicial_list_movements", { caseId: s.caseA }) as { movements: unknown[] };
  const all = await runCapability(context(s.officeB, s.userB), "k5_judicial_list_movements", {}) as { movements: unknown[] };
  assert.equal(byCase.movements.length + all.movements.length, 0);
  // The HTTP route and the agent tool land on this same capability; the route only parses input.
  const route = readFileSync(new URL("../src/app/api/judicial/movements/route.ts", import.meta.url), "utf8");
  assert.match(route, /handleCapability\(request, 'k5_judicial_list_movements'/);
});

test("texto de movimento é marcado como não confiável", async () => {
  const s = await scenario();
  await collect(s, OK);
  const jobsBefore = count("SELECT COUNT(*) AS n FROM judicial_sync_job WHERE office_id = ?", s.officeA);

  const result = await runCapability(context(s.officeA, s.userA), "k5_judicial_list_movements", { linkId: s.link.id }) as {
    movements: Array<{ text: string }>; untrustedContent: true;
  };
  assert.equal(result.untrustedContent, true);
  assert.equal(capabilities.k5_judicial_list_movements.effect, "read");
  const injected = result.movements.find((item) => item.text.includes("IGNORE AS INSTRUCOES"));
  assert.ok(injected, "o texto chega intacto, como dado");
  // Reading it changed nothing: no job, no alert, and the inbox never carries the third-party text.
  assert.equal(count("SELECT COUNT(*) AS n FROM judicial_sync_job WHERE office_id = ?", s.officeA), jobsBefore);
  assert.equal(count("SELECT COUNT(*) AS n FROM judicial_alert WHERE office_id = ? AND summary LIKE '%IGNORE%'", s.officeA), 0);
});

test("o coletor não ramifica por tipo de fonte", () => {
  const source = readFileSync(new URL("../src/lib/judicial/jobs/collector.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function runJob("));
  assert.ok(body.length > 0 && body.includes("runLookupCase"), "o ramo de lookupCase existe");
  // `job.kind` (refresh/backfill) is the kind of job, not of source, and is allowed.
  assert.doesNotMatch(body, /(installation|inst)\.kind|'(djen|mni|ckan|jurisprudence_api|court_portal)'/);
});

test("assinatura de processo agenda lookupCase", async () => {
  const s = await scenario();
  testDb.exec("UPDATE judicial_subscription SET status = 'cancelled' WHERE status = 'active'");
  const { subscription } = await createSubscription({
    officeId: s.officeA, installationId: s.installation.id, linkId: s.link.id, targetKind: "case", authorizedBy: s.userA,
  });
  const outcome = await scheduleDueSubscriptions(Date.now() + 1000);
  assert.equal(outcome.queued, 1, JSON.stringify(outcome.skipped));
  const job = testDb.prepare("SELECT operation, link_id FROM judicial_sync_job WHERE subscription_id = ?").get(subscription.id) as { operation: string; link_id: string };
  assert.deepEqual({ ...job }, { operation: "lookupCase", link_id: s.link.id });
});

test("Atualizar em fonte de processo pede lookupCase", async () => {
  const s = await scenario();
  testDb.exec("UPDATE judicial_sync_job SET status = 'cancelled', lease_owner = NULL WHERE status IN ('queued','running')");
  const result = await runCapability(context(s.officeA, s.userA), "k5_judicial_request_refresh", { linkId: s.link.id }) as { job: { operation: string } };
  assert.equal(result.job.operation, "lookupCase");
});
