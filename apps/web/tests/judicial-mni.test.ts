import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConnectorError, isRetryable, type InstallationRef } from "../src/lib/judicial/contracts";
import { buildMniRequest, createMniConnector, MNI_REFUSED_OPERATIONS } from "../src/lib/judicial/connectors/mni";
import { readEnvelope } from "../src/lib/judicial/connectors/soap";
import { fixtureKey, fixtureTransport, type Transport } from "../src/lib/judicial/connectors/transport";
import { resetTransport, setFixtureTransport } from "../src/lib/judicial/connectors";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { createCaseLink } from "../src/lib/judicial/repositories/links";
import { createSubscription, findSubscriptionById } from "../src/lib/judicial/repositories/subscriptions";
import { claimJob, enqueueJob, failJob, findJob } from "../src/lib/judicial/jobs/queue";
import { processNextJudicialJob } from "../src/lib/judicial/jobs/collector";

const CNJ = "00000010520258260100";
const CREDENTIAL = "usuario-sintetico:senha-sintetica-123";
const SECRET = "senha-sintetica-123";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
}

function installation(overrides: Partial<InstallationRef> = {}): InstallationRef {
  return {
    id: "inst-mni", kind: "mni", courtCode: "TJXX", courtName: "Tribunal Sintético",
    degree: "first", system: "pje", purpose: "case_tracking",
    baseUrl: "https://pje.exemplo.jus.br/pje/intercomunicacao", contractVersion: "2.2.2", authKind: "institutional",
    discoveryStatus: "spike_approved",
    permissions: { query: "permitido", cache: "permitido", documents: "nao_esclarecido", redistribution: "nao_esclarecido", ai: "restrito" },
    allowedHosts: ["pje.exemplo.jus.br"], enabled: true, liveTransportEnabled: false,
    rateLimitPerMinute: 600, dailyRequestBudget: 500, coverage: { from: null, to: null },
    ...overrides,
  };
}

/** Answers the SOAP endpoint of one installation with the given response. */
function answering(inst: InstallationRef, body: string, extra: Array<[string, string]> = []): Transport {
  return fixtureTransport(new Map([
    [fixtureKey(inst.id, "POST", ""), { body, contentType: "text/xml; charset=utf-8" }],
    ...extra.map(([key, value]) => [key, { body: value, contentType: "text/xml" }] as const),
  ]));
}

async function lookupFails(inst: InstallationRef, body: string): Promise<ConnectorError> {
  try {
    await createMniConnector(answering(inst, body)).lookupCase!(inst, {
      identity: { cnjNumber: CNJ, nativeNumber: null, degree: inst.degree }, credential: CREDENTIAL,
    });
  } catch (error) {
    assert.ok(error instanceof ConnectorError);
    return error;
  }
  assert.fail("a consulta deveria ter falhado");
}

const lookup = (inst: InstallationRef, transport: Transport) => createMniConnector(transport).lookupCase!(inst, {
  identity: { cnjNumber: CNJ, nativeNumber: null, degree: inst.degree }, credential: CREDENTIAL,
});

test("envelope de consultarProcesso é byte-idêntico à fixture", () => {
  const envelope = buildMniRequest("consultarProcesso", { numeroProcesso: CNJ, credential: CREDENTIAL });
  assert.equal(envelope.replace(/\n$/, ""), fixture("mni-consultarProcesso-request.xml").replace(/\n$/, ""));
});

test("XXE: DOCTYPE e ENTITY são recusados antes do parse", async () => {
  assert.throws(() => readEnvelope(fixture("mni-xxe.xml")), (error: unknown) => error instanceof ConnectorError && error.code === "schema_changed");
  assert.throws(() => readEnvelope('<!ENTITY x "y"><a/>'), (error: unknown) => error instanceof ConnectorError && error.code === "schema_changed");
  // An undeclared named entity is not resolved either, even without a DTD.
  assert.throws(() => readEnvelope("<Envelope><Body><r>&xxe;</r></Body></Envelope>"), ConnectorError);

  const error = await lookupFails(installation(), fixture("mni-xxe.xml"));
  assert.equal(error.code, "schema_changed");
});

test("F1: '>' dentro de atributo é XML válido e não derruba o leitor", () => {
  const xml = fixture("mni-consultarProcesso-ok.xml")
    .replace('descricao="Conclusos para despacho"', `descricao="Remessa > Contadoria 'externa'"`);
  const connector = createMniConnector(answering(installation(), ""));
  const { items } = connector.normalize("lookupCase", xml) as { items: Array<{ movements: Array<{ sourceText: string }> }> };
  assert.equal(items[0].movements[1].sourceText, "Remessa > Contadoria 'externa' — Juntada de petição & documentos");
  assert.throws(() => readEnvelope('<Envelope><Body a="aberto></Body></Envelope>'), ConnectorError, "aspas sem fim continua recusado");
});

test("bomba de entidades não expande e não demora", async () => {
  const started = performance.now();
  const error = await lookupFails(installation(), fixture("mni-entity-bomb.xml"));
  assert.ok(performance.now() - started < 1000, "recusa deve ser imediata");
  assert.equal(error.code, "schema_changed");
  const everything = JSON.stringify([error.message, error.rawPayloads]);
  assert.equal(everything.includes("EXPANDIDOEXPANDIDO"), false, "nenhuma entidade foi expandida");
});

test("credencial não aparece em snapshot, erro nem log", async () => {
  const logged: string[] = [];
  const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const level of Object.keys(originals) as Array<keyof typeof originals>) {
    console[level] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  }
  try {
    const inst = installation();
    const failure = await lookupFails(inst, fixture("mni-fault-unauthorized.xml"));
    const success = await lookup(inst, answering(inst, fixture("mni-consultarProcesso-ok.xml").replace("</mensagem>", ` ${SECRET}</mensagem>`)));
    const everywhere = JSON.stringify([failure.message, failure.rawPayloads, failure.rawPayload, success.rawPayloads, logged]);
    assert.equal(everywhere.includes(SECRET), false);
    assert.ok(failure.rawPayloads?.length, "o snapshot da falha continua existindo, só sem a senha");
  } finally {
    Object.assign(console, originals);
  }
});

test("fault de autorização encerra o job e suspende a assinatura", async () => {
  const error = await lookupFails(installation(), fixture("mni-fault-unauthorized.xml"));
  assert.equal(error.code, "unauthorized");
  assert.equal(isRetryable(error.code), false);

  const officeId = randomUUID();
  const userId = randomUUID();
  const caseId = randomUUID();
  testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, `${userId}@mni.test`, "Advogada MNI");
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Escritório MNI");
  testDb.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, ?)").run(randomUUID(), officeId, userId, "lawyer");
  testDb.prepare("INSERT INTO vault_case (id, office_id, name, created_by) VALUES (?, ?, ?, ?)").run(caseId, officeId, "Caso MNI", userId);
  const inst = await upsertInstallation({
    kind: "mni", courtCode: "TJFAULT", courtName: "Tribunal Sintético", degree: "first", system: "pje",
    purpose: "case_tracking", baseUrl: "https://pje.exemplo.jus.br/pje/intercomunicacao", authKind: "institutional",
    permissions: { query: "permitido", cache: "permitido" }, allowedHosts: ["pje.exemplo.jus.br"], enabled: true,
  });
  const { link } = await createCaseLink({
    officeId, userId, caseId, installationId: inst.id, cnjNumber: CNJ, nativeNumber: null, degree: "first", confirmed: true,
  });
  const { subscription } = await createSubscription({ officeId, installationId: inst.id, linkId: link.id, targetKind: "case", authorizedBy: userId });
  testDb.exec("UPDATE judicial_sync_job SET status = 'cancelled', lease_owner = NULL WHERE status IN ('queued','running')");
  const { job } = await enqueueJob({
    officeId, installationId: inst.id, subscriptionId: subscription.id, linkId: link.id, kind: "refresh", operation: "lookupCase",
  });
  const claimed = await claimJob();
  assert.equal(claimed?.job.id, job.id);

  const outcome = await failJob(job.id, claimed!.leaseOwner, { code: error.code, message: error.message });
  assert.equal(outcome.retrying, false);
  assert.equal((await findJob(officeId, job.id))?.status, "failed");
  assert.equal((await findSubscriptionById(subscription.id))?.status, "suspended");
});

test("número inexistente devolve not_found_in_source", async () => {
  assert.equal((await lookupFails(installation(), fixture("mni-nao-encontrado.xml"))).code, "not_found_in_source");
});

test("processo sigiloso devolve forbidden e não grava movimento", async () => {
  const error = await lookupFails(installation(), fixture("mni-sigiloso.xml"));
  assert.equal(error.code, "forbidden");
  assert.match(error.message, /sigilo 5/);
  // The connector returns no result at all, so there is nothing a caller could ingest.
  assert.throws(() => createMniConnector(answering(installation(), "")).normalize("lookupCase", fixture("mni-sigiloso.xml")),
    (failure: unknown) => failure instanceof ConnectorError && failure.code === "forbidden");
});

test("mesma numeração em dois graus produz dois registros", async () => {
  const first = installation({ id: "inst-mni-1g", degree: "first" });
  const second = installation({ id: "inst-mni-2g", degree: "second" });
  const [a] = (await lookup(first, answering(first, fixture("mni-consultarProcesso-ok.xml")))).items;
  const [b] = (await lookup(second, answering(second, fixture("mni-consultarProcesso-ok.xml")))).items;
  assert.notEqual(a.sourceRecordId, b.sourceRecordId);
  assert.equal(a.identity.degree, "first");
  assert.equal(b.identity.degree, "second");
  assert.equal(a.identity.cnjNumber, CNJ);
});

test("normalize é puro e não toca no transporte", () => {
  const exploding: Transport = { mode: "fixture", request: () => { throw new Error("transporte chamado"); } };
  const connector = createMniConnector(exploding);
  const once = connector.normalize("lookupCase", fixture("mni-consultarProcesso-ok.xml")) as { items: Array<{ movements: unknown[] }>; rejected: number };
  const twice = connector.normalize("lookupCase", fixture("mni-consultarProcesso-ok.xml"));
  assert.deepEqual(once, twice);

  const [record] = once.items;
  assert.equal(record.movements.length, 3);
  assert.equal(once.rejected, 1, "movimento sem data é contado, não inventado");
  assert.deepEqual(record.movements[0], {
    sourceMovementId: "mov-1", sourceCode: "26", sourceText: "[código 26]", tpuCode: "26", tpuSource: "source_declared",
    eventAt: "2025-01-03T09:30:00", eventPrecision: "second", eventTimezone: null,
  });
  assert.deepEqual(record.movements[1], {
    sourceMovementId: "mov-2", sourceCode: "9001", sourceText: "Conclusos para despacho — Juntada de petição & documentos",
    tpuCode: null, tpuSource: null, eventAt: "2025-02-10T14:15:00", eventPrecision: "second", eventTimezone: null,
  });
});

test("operação de possível ciência é recusada no worker", async () => {
  for (const operation of MNI_REFUSED_OPERATIONS) {
    assert.throws(() => buildMniRequest(operation, { numeroProcesso: CNJ }), (error: unknown) => error instanceof ConnectorError && error.code === "unsupported");
  }

  const officeId = randomUUID();
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Escritório Ciência");
  const inst = await upsertInstallation({
    kind: "mni", courtCode: "TJAVISO", courtName: "Tribunal Sintético", degree: "first", system: "pje",
    purpose: "case_tracking", baseUrl: "https://pje.exemplo.jus.br/pje/intercomunicacao", authKind: "none",
    permissions: { query: "permitido", cache: "permitido" }, allowedHosts: ["pje.exemplo.jus.br"], enabled: true,
  });
  testDb.exec("UPDATE judicial_sync_job SET status = 'cancelled', lease_owner = NULL WHERE status IN ('queued','running')");
  let requests = 0;
  setFixtureTransport(new Map(), () => { requests += 1; });
  try {
    const { job } = await enqueueJob({
      officeId, installationId: inst.id, kind: "manual", operation: "consultarAvisosPendentes" as never,
    });
    const outcome = await processNextJudicialJob();
    assert.equal(outcome?.jobId, job.id);
    assert.equal(outcome?.status, "skipped");
    assert.equal(requests, 0, "nenhuma requisição foi gasta");
    const budget = testDb.prepare("SELECT COUNT(*) AS n FROM judicial_rate_budget WHERE installation_id = ?").get(inst.id) as { n: number };
    assert.equal(budget.n, 0);
  } finally {
    resetTransport();
  }
});

test("WSDL com hash divergente reprova no health", async () => {
  const dir = mkdtempSync(join(tmpdir(), "k5-contracts-"));
  const wsdl = "<definitions name='MNI 2.2.2 sintético'/>";
  writeFileSync(join(dir, "mni-tjxx-2.2.2.wsdl.sha256"), `${createHash("sha256").update(wsdl).digest("hex")}  mni-tjxx-2.2.2.wsdl\n`);
  const inst = installation();
  const wsdlKey = fixtureKey(inst.id, "GET", "?wsdl");

  const matching = createMniConnector(answering(inst, "", [[wsdlKey, wsdl]]), { contractsDir: dir });
  assert.deepEqual(await matching.health!(inst), { ok: true, detail: "WSDL confere com o contrato fixado." });

  const drifted = createMniConnector(answering(inst, "", [[wsdlKey, wsdl.replace("sintético", "alterado")]]), { contractsDir: dir });
  const health = await drifted.health!(inst);
  assert.equal(health.ok, false);
  assert.match(health.detail, /^schema_changed/);

  const unpinned = await createMniConnector(answering(inst, ""), { contractsDir: join(dir, "nada") }).health!(inst);
  assert.match(unpinned.detail, /^schema_changed: sem contrato fixado/);
});
