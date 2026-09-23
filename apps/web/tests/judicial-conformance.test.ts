import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDjenConnector } from "../src/lib/judicial/connectors/djen";
import { compareToParser, conformanceExitCode } from "../src/lib/judicial/connectors/conformance";
import { sanitizeForFixture } from "../src/lib/judicial/connectors/sanitize";
import { fixtureKey, fixtureTransport } from "../src/lib/judicial/connectors/transport";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { runProbe } from "../src/lib/judicial/jobs/probe";

const DAY = "2026-09-18";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
}

const djen = createDjenConnector(fixtureTransport(new Map()));

function office(): string {
  const id = randomUUID();
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(id, `Escritório ${id.slice(0, 6)}`);
  return id;
}

let counter = 0;
function source(overrides: { enabled?: boolean; liveTransportEnabled?: boolean } = {}) {
  counter += 1;
  return upsertInstallation({
    kind: "djen", courtCode: `PROBE${counter}`, courtName: "DJEN de teste", degree: "not_applicable",
    system: "not_applicable", purpose: "publications", baseUrl: "https://comunica.exemplo.jus.br/",
    authKind: "none", discoveryStatus: "spike_approved",
    permissions: { query: "permitido", cache: "permitido", documents: "restrito", redistribution: "restrito", ai: "restrito" },
    allowedHosts: ["comunica.exemplo.jus.br"], rateLimitPerMinute: 600, dailyRequestBudget: 500,
    enabled: overrides.enabled ?? true, liveTransportEnabled: overrides.liveTransportEnabled ?? true,
  });
}

function stubPage(installationId: string, body: string, page = 1, status?: number) {
  return new Map<string, { body: string; status?: number }>([[fixtureKey(installationId, "GET", "api/v1/comunicacao", {
    dataDisponibilizacaoInicio: DAY, dataDisponibilizacaoFim: DAY, itensPorPagina: 100, pagina: page,
  }), { body, status }]]);
}

function budgetUsed(installationId: string): number {
  const row = testDb.prepare("SELECT COALESCE(SUM(requests), 0) AS n FROM judicial_rate_budget WHERE installation_id = ?")
    .get(installationId) as { n: number };
  return row.n;
}

function audits(installationId: string) {
  return testDb.prepare("SELECT actor, action, outcome FROM judicial_access_audit WHERE installation_id = ?")
    .all(installationId).map((row) => ({ ...row })) as Array<{ actor: string; action: string; outcome: string }>;
}

const probe = (installationId: string, officeId: string, extra: { record?: boolean } = {}) => ({
  installationId, officeId, operation: "listChanges" as const, windowFrom: DAY, windowTo: DAY, ...extra,
});

test("probe: recusa sem os dois interruptores e não gasta orçamento", async () => {
  const officeId = office();
  for (const gates of [{ enabled: false }, { liveTransportEnabled: false }]) {
    const inst = await source(gates);
    let called = false;
    const transport = fixtureTransport(stubPage(inst.id, fixture("djen-page-1.json")), () => { called = true; });
    const result = await runProbe(probe(inst.id, officeId), transport);
    assert.equal(result.exitCode, 1, JSON.stringify(gates));
    assert.equal(called, false, "nenhuma requisição sai com um interruptor desligado");
    assert.equal(budgetUsed(inst.id), 0);
  }
});

test("probe: uma execução consome exatamente uma unidade de orçamento", async () => {
  const officeId = office();
  const inst = await source();
  // A full page means the source may have more; the probe must still stop at one request.
  const full = JSON.stringify({ count: 250, items: Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}`, texto: `Texto ${i}` })) });
  const result = await runProbe(probe(inst.id, officeId), fixtureTransport(stubPage(inst.id, full)));
  assert.equal(result.exitCode, 0, result.detail);
  assert.equal(result.requestsSpent, 1);
  assert.equal(budgetUsed(inst.id), 1);
  assert.equal(result.reports[0].items, 100);
});

const fullPage = (from: number) => JSON.stringify({ count: 150, items: Array.from({ length: 100 }, (_, i) => ({ id: `s-${from + i}`, texto: `Texto ${i}` })) });

test("F2: falha depois da primeira resposta não vira 'conforme'", async () => {
  const officeId = office();
  const inst = await source();
  const map = stubPage(inst.id, fullPage(0));
  for (const [key, value] of stubPage(inst.id, "", 2, 403)) map.set(key, value);
  const result = await runProbe({ ...probe(inst.id, officeId), maxRequests: 2 }, fixtureTransport(map));
  assert.equal(result.exitCode, 1);
  assert.match(result.detail, /após 1 resposta\(s\): forbidden/);
  assert.equal(result.reports.length, 1, "o que chegou continua relatado");
  assert.deepEqual(audits(inst.id), [{ actor: "worker", action: "judicial.probe", outcome: "error" }]);
});

test("F2: com --max-requests 2 o probe espera o intervalo mínimo em vez de falhar", async () => {
  const officeId = office();
  const inst = await source();
  const map = stubPage(inst.id, fullPage(0));
  for (const [key, value] of stubPage(inst.id, JSON.stringify({ count: 150, items: [{ id: "s-100", texto: "Fim" }] }), 2)) map.set(key, value);
  const result = await runProbe({ ...probe(inst.id, officeId), maxRequests: 2 }, fixtureTransport(map));
  assert.equal(result.exitCode, 0, result.detail);
  assert.equal(result.requestsSpent, 2);
  assert.equal(budgetUsed(inst.id), 2);
});

test("conformidade: campo novo na resposta aparece em unknownFields, nunca some", () => {
  const report = compareToParser(djen, "listChanges", fixture("conformance-extra-field.json"));
  assert.deepEqual(report.unknownFields, ["items[].nomeOrgao"]);
  assert.equal(report.items, 1, "o parser continua lendo o que conhece");
  assert.equal(conformanceExitCode(report), 2);

  // The synthetic page the suite already uses is fully accounted for, so the check is not noise.
  assert.equal(conformanceExitCode(compareToParser(djen, "listChanges", fixture("djen-page-1.json"))), 0);
});

test("conformidade: campo exigido e ausente aparece em missingExpected", () => {
  const report = compareToParser(djen, "listChanges", fixture("conformance-missing-field.json"));
  assert.deepEqual(report.missingExpected, ["items[].texto|textoComunicacao|texto_comunicacao|conteudo"]);
  assert.equal(report.rejected, 1);
  assert.equal(conformanceExitCode(report), 2);

  const noList = compareToParser(djen, "listChanges", JSON.stringify({ resultado: [] }));
  assert.deepEqual(noList.missingExpected, ["items|content|comunicacoes|data"]);
  assert.match(noList.parseError ?? "", /^schema_changed/);
});

test("sanitização: CPF, CNPJ, OAB, e-mail e telefone não sobrevivem à fixture", () => {
  const clean = sanitizeForFixture(fixture("conformance-pii.json"), "application/json");
  for (const secret of ["123.456.789-09", "12.345.678/0001-90", "12.345", "12345", "advogada.sintetica@exemplo.com.br", "99123-4567"]) {
    assert.equal(clean.includes(secret), false, `sobreviveu: ${secret}`);
  }
  for (const token of ["[cpf]", "[cnpj]", "[oab]", "[email]", "[telefone]"]) assert.ok(clean.includes(token), token);

  const xml = sanitizeForFixture(
    "<env><idConsultante>usuario</idConsultante><tns:senhaConsultante>s3gr3d0</tns:senhaConsultante></env>",
    "application/soap+xml",
  );
  assert.equal(xml.includes("s3gr3d0") || xml.includes("usuario"), false);
  assert.ok(xml.includes("<tns:senhaConsultante>[removido]</tns:senhaConsultante>"));
});

test("F3: CPF e CNPJ em número JSON ou em campo de documento não sobrevivem", () => {
  const clean = JSON.parse(sanitizeForFixture(JSON.stringify({
    cpf: 12345678909, cnpjEmpresa: "12345", numeroDocumentoPrincipal: 98765432100,
    parte: { documento: 11222333000181 }, avulso: 12345678909, count: 42, pagina: 3,
  }), "application/json"));
  assert.deepEqual(clean, {
    cpf: "[documento]", cnpjEmpresa: "[documento]", numeroDocumentoPrincipal: "[documento]",
    parte: { documento: "[documento]" }, avulso: "[cpf]",
    // Numbers that are not identifiers keep their value and their type.
    count: 42, pagina: 3,
  });
});

test("sanitização: a estrutura e os nomes de campo sobrevivem", () => {
  const original = JSON.parse(fixture("conformance-pii.json"));
  const clean = JSON.parse(sanitizeForFixture(fixture("conformance-pii.json"), "application/json"));
  const shape = (value: unknown): unknown => Array.isArray(value)
    ? value.map(shape)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : typeof value;
  assert.deepEqual(shape(clean), shape(original));
  // A CNJ number is public and is what joins a publication to a case; it must not be mistaken for PII.
  assert.equal(clean.items[0].numeroProcesso, "0000001-05.2025.8.26.0100");
  assert.ok(clean.items[0].texto.includes("00000010520258260100"));
});

test("fixture gravada: reprocessar produz o mesmo relatório", async () => {
  const officeId = office();
  const inst = await source();
  const result = await runProbe(probe(inst.id, officeId, { record: true }), fixtureTransport(stubPage(inst.id, fixture("conformance-pii.json"))));
  assert.equal(result.fixtures.length, 1, result.detail);

  const [recorded] = result.fixtures;
  assert.deepEqual(compareToParser(djen, "listChanges", recorded.body, {
    installationId: inst.id, requestSummary: recorded.report.requestSummary,
  }), recorded.report);
  for (const key of ["knownFields", "unknownFields", "missingExpected", "items", "rejected"] as const) {
    assert.deepEqual(recorded.report[key], result.reports[0][key], key);
  }
});

test("probe recusado também grava auditoria", async () => {
  const officeId = office();
  const inst = await source({ liveTransportEnabled: false });
  await runProbe(probe(inst.id, officeId), fixtureTransport(new Map()));
  assert.deepEqual(audits(inst.id), [{ actor: "worker", action: "judicial.probe", outcome: "denied" }]);

  const live = await source();
  await runProbe(probe(live.id, officeId), fixtureTransport(stubPage(live.id, fixture("djen-page-1.json"))));
  assert.deepEqual(audits(live.id), [{ actor: "worker", action: "judicial.probe", outcome: "ok" }]);
});
