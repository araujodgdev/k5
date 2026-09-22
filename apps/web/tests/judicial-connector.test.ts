import "./test-setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ConnectorError, isRetryable, isWorkerSafe, permits, type InstallationRef,
} from "../src/lib/judicial/contracts";
import { createDjenConnector, normalizeCommunications, plainTextFromGazette, DJEN_PARSER_VERSION } from "../src/lib/judicial/connectors/djen";
import { fixtureKey, fixtureTransport, isPrivateAddress, liveTransport } from "../src/lib/judicial/connectors/transport";
import { connectorFor, hasConnectorFor } from "../src/lib/judicial/connectors";

const VALID = "00000010520258260100";
const VALID_OTHER = "12345677920248130001";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
}

function installation(overrides: Partial<InstallationRef> = {}): InstallationRef {
  return {
    id: "inst-djen", kind: "djen", courtCode: "DJEN", courtName: "Diário de Justiça Eletrônico Nacional",
    degree: "not_applicable", system: "not_applicable", purpose: "publications",
    baseUrl: "https://comunica.exemplo.jus.br/", contractVersion: "v1", authKind: "none",
    discoveryStatus: "spike_approved",
    permissions: { query: "permitido", cache: "permitido", documents: "nao_esclarecido", redistribution: "nao_esclarecido", ai: "restrito" },
    allowedHosts: ["comunica.exemplo.jus.br"],
    enabled: true, liveTransportEnabled: false,
    rateLimitPerMinute: 30, dailyRequestBudget: 500,
    coverage: { from: "2022-01-01", to: null },
    ...overrides,
  };
}

/** Builds the fixture map for one installation, keyed the way the transport looks it up. */
function transportFor(inst: InstallationRef, pages: Array<{ page: number; body: string; status?: number; numero?: string }>) {
  const map = new Map<string, { contentType?: string; body: string; status?: number }>();
  for (const entry of pages) {
    map.set(fixtureKey(inst.id, "GET", "api/v1/comunicacao", {
      dataDisponibilizacaoInicio: "2026-09-08",
      dataDisponibilizacaoFim: "2026-09-12",
      numeroProcesso: entry.numero,
      itensPorPagina: 100,
      pagina: entry.page,
    }), { body: entry.body, status: entry.status });
  }
  return fixtureTransport(map);
}

const WINDOW = { windowFrom: "2026-09-08", windowTo: "2026-09-12" };

test("connector registry: only implemented kinds resolve, and the rest say so plainly", () => {
  assert.equal(hasConnectorFor("djen"), true);
  // The plan is explicit that these need access Lume does not hold; claiming a connector exists
  // would be worse than reporting the gap.
  assert.equal(hasConnectorFor("mni"), false);
  assert.equal(hasConnectorFor("ckan"), false);

  assert.throws(
    () => connectorFor(installation({ kind: "mni" })),
    (error: unknown) => error instanceof ConnectorError && error.code === "unsupported",
  );
});

test("DJEN capabilities: declares what it does not do instead of staying silent", () => {
  const connector = createDjenConnector(transportFor(installation(), []));
  const capabilities = connector.describeCapabilities(installation());
  assert.equal(capabilities.parserVersion, DJEN_PARSER_VERSION);

  const lookup = capabilities.operations.find((operation) => operation.operation === "lookupCase");
  assert.equal(lookup?.supported, false, "DJEN publica comunicações, não os autos");

  const listChanges = capabilities.operations.find((operation) => operation.operation === "listChanges");
  assert.equal(listChanges?.supported, true);
  assert.equal(isWorkerSafe(listChanges!.effect), true, "ler diário público é consulta neutra");

  const fetchDocument = capabilities.operations.find((operation) => operation.operation === "fetchDocument");
  assert.equal(isWorkerSafe(fetchDocument!.effect), false, "efeito desconhecido nunca entra no worker genérico");
});

test("DJEN normalize: pure, and it separates the dates the court keeps apart", () => {
  const parsed = normalizeCommunications(fixture("djen-page-1.json"));
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.rejected, 0);
  assert.equal(parsed.totalReported, 3);

  const [first] = parsed.items;
  assert.equal(first.cnjNumber, VALID, "o número é normalizado para vinte dígitos");
  assert.equal(first.madeAvailableOn, "2026-09-10");
  assert.equal(first.publishedOn, "2026-09-11", "publicação e disponibilização não são o mesmo campo");
  assert.equal(first.edition, "3210");

  // Same bytes in, same records out: that is what lets a parser fix re-read stored snapshots.
  assert.deepEqual(normalizeCommunications(fixture("djen-page-1.json")), parsed);
});

test("DJEN normalize: an unverifiable number is not written to the CNJ column", () => {
  const parsed = normalizeCommunications(fixture("djen-page-1.json"));
  const legacy = parsed.items[2];
  assert.equal(legacy.cnjNumber, null, "numeração legada não entra no índice CNJ");
  assert.match(legacy.body, /numeracao legada/i, "mas a publicação continua sendo coletada");
});

test("DJEN normalize: gazette markup becomes text, and the text is data, not instructions", () => {
  const parsed = normalizeCommunications(fixture("djen-page-1.json"));
  assert.equal(parsed.items[0].body.includes("<"), false, "o HTML do diário não é armazenado como markup");
  assert.match(parsed.items[0].body, /fls\. 12/);

  // The second entry contains text shaped like a prompt injection. Nothing here executes it: it
  // is stored verbatim as the published text, which is exactly what it is.
  assert.match(parsed.items[1].body, /IGNORE AS INSTRUCOES ANTERIORES/);

  assert.equal(plainTextFromGazette("<script>alert(1)</script><p>Texto&nbsp;&amp;&nbsp;mais</p>"), "Texto & mais");
  assert.equal(
    plainTextFromGazette("Válido: &#65;. Inválidos: &#-1; &#1.5; &#999999999999999999999999;."),
    "Válido: A. Inválidos: &#-1; &#1.5; &#999999999999999999999999;.",
  );
});

test("DJEN normalize: an empty page is a real answer, a changed contract is not", () => {
  assert.deepEqual(normalizeCommunications(fixture("djen-empty.json")), { items: [], rejected: 0, totalReported: 0 });

  // Publishing an empty list as a successful "nothing new" is the failure this refuses to make.
  assert.throws(
    () => normalizeCommunications(fixture("djen-schema-changed.json")),
    (error: unknown) => error instanceof ConnectorError && error.code === "schema_changed",
  );
  assert.throws(
    () => normalizeCommunications("isto não é json"),
    (error: unknown) => error instanceof ConnectorError && error.code === "schema_changed",
  );
});

test("DJEN listChanges: reports coverage of the window it actually walked", async () => {
  const inst = installation();
  const connector = createDjenConnector(transportFor(inst, [{ page: 1, body: fixture("djen-page-1.json") }]));
  const result = await connector.listChanges!(inst, WINDOW);

  assert.equal(result.items.length, 3);
  assert.equal(result.coverage.pagesFetched, 1);
  assert.equal(result.coverage.truncated, false);
  assert.equal(result.coverage.windowFrom, "2026-09-08");
  assert.equal(result.coverage.windowTo, "2026-09-12");
  assert.equal(result.cursor, null, "uma página curta encerra a varredura");
  assert.equal(result.source.parserVersion, DJEN_PARSER_VERSION);
  assert.equal(result.rawPayloads.length, 1, "o original é devolvido para ser persistido antes do normalizado");
});

test("DJEN listChanges: refuses a window wider than the source documents", async () => {
  const inst = installation();
  const connector = createDjenConnector(transportFor(inst, []));
  await assert.rejects(
    () => connector.listChanges!(inst, { windowFrom: "2026-01-01", windowTo: "2026-09-12" }),
    (error: unknown) => error instanceof ConnectorError && error.code === "unsupported",
  );
});

test("DJEN listChanges: one request per linked proceeding, never a filterless sweep", async () => {
  const inst = installation();
  const connector = createDjenConnector(transportFor(inst, [
    { page: 1, numero: VALID, body: fixture("djen-page-1.json") },
    { page: 1, numero: VALID_OTHER, body: fixture("djen-empty.json") },
  ]));

  const result = await connector.listChanges!(inst, { ...WINDOW, cnjNumbers: [VALID, VALID_OTHER] });
  assert.equal(result.coverage.pagesFetched, 2, "uma consulta por processo vinculado");
  assert.equal(result.items.length, 3);
});

test("DJEN listChanges: a list with no valid CNJ number is refused rather than widened", async () => {
  const inst = installation();
  const connector = createDjenConnector(transportFor(inst, []));
  // Falling back to an unfiltered sweep here would be discovery the office never authorized.
  await assert.rejects(
    () => connector.listChanges!(inst, { ...WINDOW, cnjNumbers: ["numero-invalido"] }),
    (error: unknown) => error instanceof ConnectorError && error.code === "unsupported",
  );
  await assert.rejects(
    () => connector.listChanges!(inst, { ...WINDOW, cnjNumbers: [] }),
    (error: unknown) => error instanceof ConnectorError && error.code === "unsupported",
  );
});

test("DJEN fetchPublication: preserves raw payload when response fails schema normalization", async () => {
  const inst = installation();
  const malformed = "{ not valid json";
  const map = new Map<string, { contentType?: string; body: string; status?: number }>();
  map.set(fixtureKey(inst.id, "GET", "api/v1/comunicacao/pub-999"), { body: malformed });
  const connector = createDjenConnector(fixtureTransport(map));

  await assert.rejects(
    () => connector.fetchPublication!(inst, "pub-999"),
    (error: unknown) => {
      assert(error instanceof ConnectorError);
      assert.equal(error.code, "schema_changed");
      assert.equal(error.rawPayload?.body, malformed);
      assert.equal(error.rawPayloads?.[0]?.body, malformed);
      return true;
    },
  );
});

test("DJEN listChanges: source errors arrive as structured codes, with retryability decided", async () => {
  const inst = installation();
  for (const [status, code, retryable] of [
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found_in_source", false],
    [429, "rate_limited", true],
    [503, "source_unavailable", true],
  ] as const) {
    const connector = createDjenConnector(transportFor(inst, [{ page: 1, body: "{}", status }]));
    await assert.rejects(
      () => connector.listChanges!(inst, WINDOW),
      (error: unknown) => error instanceof ConnectorError && error.code === code,
      `status ${status} deveria virar ${code}`,
    );
    assert.equal(isRetryable(code), retryable, `${code} retryable=${retryable}`);
  }
});

test("transport: live egress stays shut until a person opens it, even for an enabled source", async () => {
  // The whole point of the second switch: an installation can be enabled for use while the
  // permission to actually contact the court is still pending.
  await assert.rejects(
    () => liveTransport.request(installation({ liveTransportEnabled: false }), "api/v1/comunicacao"),
    (error: unknown) => error instanceof ConnectorError && error.code === "human_action_required",
  );

  await assert.rejects(
    () => liveTransport.request(installation({ enabled: false, liveTransportEnabled: true }), "api/v1/comunicacao"),
    (error: unknown) => error instanceof ConnectorError && error.code === "unsupported",
  );
});

test("transport: a host outside the installation allowlist is refused before any lookup", async () => {
  const inst = installation({ liveTransportEnabled: true, baseUrl: "https://atacante.example.com/", allowedHosts: ["comunica.exemplo.jus.br"] });
  await assert.rejects(
    () => liveTransport.request(inst, "api/v1/comunicacao"),
    (error: unknown) => error instanceof ConnectorError && error.code === "forbidden",
  );
});

test("transport: plain HTTP is refused even when the host is on the allowlist", async () => {
  const inst = installation({ liveTransportEnabled: true, baseUrl: "http://comunica.exemplo.jus.br/" });
  await assert.rejects(
    () => liveTransport.request(inst, "api/v1/comunicacao"),
    (error: unknown) => error instanceof ConnectorError && error.code === "forbidden",
  );
});

test("transport: a literal internal address never passes, allowlisted or not", async () => {
  for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "[::1]"]) {
    const hostname = host.replace(/[[\]]/g, "");
    const inst = installation({ liveTransportEnabled: true, baseUrl: `https://${host}/`, allowedHosts: [hostname] });
    await assert.rejects(
      () => liveTransport.request(inst, "api/v1/comunicacao"),
      (error: unknown) => error instanceof ConnectorError && error.code === "forbidden",
      `${host} deveria ser recusado`,
    );
  }
});

test("transport: the private-range classifier covers the addresses an SSRF actually aims at", () => {
  for (const address of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.51.100.1", "::1", "::",
    "fe80::1", "fe90::1", "febf::1", "fec0::1", "fd00::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "::7f00:1", "2001:db8::1",
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} deveria ser privado`);
  }
  for (const address of ["8.8.8.8", "200.160.2.3", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(address), false, `${address} deveria ser público`);
  }
  // 172.32.x is outside the private block and must not be over-blocked.
  assert.equal(isPrivateAddress("172.32.0.1"), false);
});

test("transport: a fixture is bound to the installation it was captured from", async () => {
  const inst = installation();
  const transport = transportFor(inst, [{ page: 1, body: fixture("djen-page-1.json") }]);
  // The same path under a different installation id must not resolve to this court's sample.
  await assert.rejects(
    () => createDjenConnector(transport).listChanges!(installation({ id: "outra-instalacao" }), WINDOW),
    (error: unknown) => error instanceof ConnectorError && error.code === "not_found_in_source",
  );
});

test("permissions: each dimension is answered on its own and silence is not consent", () => {
  const inst = installation();
  assert.equal(permits(inst.permissions, "query"), true);
  assert.equal(permits(inst.permissions, "cache"), true);
  // 'restrito' and 'nao_esclarecido' are both "not cleared"; only an explicit yes counts.
  assert.equal(permits(inst.permissions, "ai"), false);
  assert.equal(permits(inst.permissions, "documents"), false);
  assert.equal(permits(inst.permissions, "redistribution"), false);
});
