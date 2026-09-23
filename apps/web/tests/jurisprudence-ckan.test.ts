import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import PizZip from "pizzip";

import type { InstallationRef, SourcePermissions } from "../src/lib/judicial/contracts";
import { createCkanConnector, normalizePackage, normalizeResource } from "../src/lib/judicial/connectors/ckan";
import { fixtureKey, fixtureTransport, type FixtureEntry, type Transport } from "../src/lib/judicial/connectors/transport";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { assertExportable, syncDataset, documentUsePolicy } from "../src/lib/jurisprudence/sync";
import { objectStorage } from "../src/lib/storage";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8");
const noWait = () => Promise.resolve();
const ALL_PERMITTED: SourcePermissions = { query: "permitido", cache: "permitido", documents: "permitido", redistribution: "permitido", ai: "permitido" };

let counter = 0;
function source(permissions: Partial<SourcePermissions> = {}) {
  counter += 1;
  return upsertInstallation({
    kind: "ckan", courtCode: `STJ${counter}`, courtName: "STJ Dados Abertos (teste)", degree: "superior",
    system: "not_applicable", purpose: "jurisprudence", baseUrl: "https://dadosabertos.web.stj.jus.br/",
    authKind: "none", permissions: { ...ALL_PERMITTED, ...permissions },
    allowedHosts: ["dadosabertos.web.stj.jus.br"], enabled: true, rateLimitPerMinute: 600, dailyRequestBudget: 500,
  });
}

/** Espelho-shaped records, in the provisional STJ layout the parser reads. */
function records(ids: string[], extra: Record<string, unknown> = {}) {
  return ids.map((id) => ({
    id, numeroProcesso: `1${id.replace(/\D/g, "").padStart(6, "0")}`, siglaClasse: "REsp", nomeOrgaoJulgador: "TERCEIRA TURMA",
    ministroRelator: "MINISTRA RELATORA SINTÉTICA", dataDecisao: "20250110",
    dataPublicacao: "DJE        DATA:15/01/2025", ementa: `Ementa sintética do julgado ${id}.`, ...extra,
  }));
}

function zip(files: Record<string, unknown>): Buffer {
  const archive = new PizZip();
  for (const [name, content] of Object.entries(files)) archive.file(name, JSON.stringify(content));
  return archive.generate({ type: "nodebuffer" }) as Buffer;
}

/** Answers package_show and each resource URL, and counts only the downloads. */
function answering(inst: InstallationRef, datasetId: string, packageJson: string, resources: Record<string, Buffer | string>) {
  const map = new Map<string, FixtureEntry>([[fixtureKey(inst.id, "GET", "api/3/action/package_show", { id: datasetId }), { body: packageJson }]]);
  for (const [url, content] of Object.entries(resources)) {
    map.set(fixtureKey(inst.id, "GET", url), typeof content === "string" ? { body: content } : { body: "", bytes: content, contentType: "application/zip" });
  }
  const base = fixtureTransport(map);
  const downloads: string[] = [];
  const transport: Transport = {
    mode: "fixture",
    request(installation, path, init) {
      if (path.startsWith("https://")) downloads.push(path);
      return base.request(installation, path, init);
    },
  };
  return { transport, downloads };
}

const urlOf = (packageJson: string, id: string) =>
  (JSON.parse(packageJson).result.resources as Array<{ id: string; url: string }>).find((resource) => resource.id === id)!.url;

test("licença é lida por recurso, não por catálogo", async () => {
  const licensed = normalizePackage(fixture("ckan-package-show.json"));
  const byId = Object.fromEntries(licensed.items.map((item) => [item.sourceResourceId, item.license]));
  assert.deepEqual(byId["res-json"], { title: "Creative Commons Attribution", url: "http://www.opendefinition.org/licenses/cc-by", attribution: "Superior Tribunal de Justiça" });
  // The resource's own declaration wins over its dataset's.
  assert.equal(byId["res-propria"]?.title, "Creative Commons Attribution-ShareAlike");

  // Another dataset that declares nothing gets nothing, whatever its neighbour declared.
  const unlicensed = normalizePackage(fixture("ckan-resource-sem-licenca.json"));
  assert.equal(unlicensed.items[0].license, null);

  const inst = await source();
  const pkg = fixture("ckan-resource-sem-licenca.json");
  const { transport } = answering(inst, "conjunto-sem-licenca", pkg, { [urlOf(pkg, "res-sem-licenca")]: JSON.stringify(records(["SL1"])) });
  await syncDataset(inst, { datasetId: "conjunto-sem-licenca", contentKind: "espelho" }, { transport, sleep: noWait });
  const row = testDb.prepare("SELECT content_kind, license_title FROM jurisprudence_document WHERE installation_id = ?").get(inst.id) as { content_kind: string; license_title: string | null };
  assert.deepEqual({ ...row }, { content_kind: "espelho", license_title: null });
});

test("recurso sem licença é armazenado e não indexado", async () => {
  const inst = await source();
  const pkg = fixture("ckan-resource-sem-licenca.json");
  const { transport } = answering(inst, "conjunto-sem-licenca", pkg, { [urlOf(pkg, "res-sem-licenca")]: JSON.stringify(records(["SL2"])) });
  await syncDataset(inst, { datasetId: "conjunto-sem-licenca", contentKind: "espelho" }, { transport, sleep: noWait });

  const stored = testDb.prepare("SELECT id, license_title, permissions, headnote FROM jurisprudence_document WHERE installation_id = ?").get(inst.id) as { id: string; license_title: null; permissions: string; headnote: string };
  assert.equal(stored.headnote, "Ementa sintética do julgado SL2.", "armazenado e legível");
  assert.deepEqual(documentUsePolicy(stored), { indexable: false, exportable: false, reasons: ["Documento sem licença declarada pela fonte."] });
  await assert.rejects(assertExportable(stored.id), /Exportação recusada: Documento sem licença declarada pela fonte\./);
  // B3 creates the chunk and vector tables and asserts, against them, that this document has none.

  // Licensed, but the source never cleared redistribution: readable and indexable, not exportable.
  const restricted = await source({ redistribution: "restrito" });
  const licensedPkg = fixture("ckan-package-show.json");
  const answered = answering(restricted, "espelhos-sintetico", licensedPkg, {
    [urlOf(licensedPkg, "res-json")]: JSON.stringify(records(["R1"])),
    [urlOf(licensedPkg, "res-zip")]: zip({ "a.json": records(["R2"]) }),
    [urlOf(licensedPkg, "res-propria")]: JSON.stringify(records(["R3"])),
  });
  await syncDataset(restricted, { datasetId: "espelhos-sintetico", contentKind: "espelho" }, { transport: answered.transport, sleep: noWait });
  const document = testDb.prepare("SELECT id, license_title, permissions FROM jurisprudence_document WHERE installation_id = ? AND source_document_id = 'R1'").get(restricted.id) as { id: string; license_title: string; permissions: string };
  assert.equal(documentUsePolicy(document).indexable, true);
  await assert.rejects(assertExportable(document.id), /não autoriza redistribuição/);
});

test("checksum inalterado não gera novo download", async () => {
  const inst = await source();
  const pkg = fixture("ckan-resource-v1.json");
  const body = JSON.stringify(records(["V1", "V2"]));
  const first = answering(inst, "espelhos-versionado", pkg, { [urlOf(pkg, "res-versionado")]: body });
  const run1 = await syncDataset(inst, { datasetId: "espelhos-versionado", contentKind: "espelho" }, { transport: first.transport, sleep: noWait });
  assert.equal(run1.resourcesDownloaded, 1);

  const second = answering(inst, "espelhos-versionado", pkg, { [urlOf(pkg, "res-versionado")]: body });
  const run2 = await syncDataset(inst, { datasetId: "espelhos-versionado", contentKind: "espelho" }, { transport: second.transport, sleep: noWait });
  assert.deepEqual(second.downloads, [], "nenhum download na segunda sincronização");
  assert.equal(run2.resourcesUnchanged, 1);
  assert.equal(run2.documentsInserted, 0);
});

test("checksum alterado cria versão e preserva a anterior", async () => {
  const inst = await source();
  const v1 = fixture("ckan-resource-v1.json");
  const v2 = fixture("ckan-resource-v2.json");
  const url = urlOf(v1, "res-versionado");
  await syncDataset(inst, { datasetId: "espelhos-versionado", contentKind: "espelho" },
    { transport: answering(inst, "espelhos-versionado", v1, { [url]: JSON.stringify(records(["C1", "C2"])) }).transport, sleep: noWait });
  testDb.prepare("UPDATE jurisprudence_resource SET collected_at = '2025-01-15T00:00:00Z' WHERE installation_id = ?").run(inst.id);
  testDb.prepare("UPDATE jurisprudence_document SET collected_at = '2025-01-15T00:00:00Z' WHERE installation_id = ?").run(inst.id);

  // C1 was corrected upstream; C2 is byte-identical.
  const changed = [...records(["C1"], { ementa: "Ementa corrigida do julgado C1." }), ...records(["C2"])];
  const run = await syncDataset(inst, { datasetId: "espelhos-versionado", contentKind: "espelho" },
    { transport: answering(inst, "espelhos-versionado", v2, { [url]: JSON.stringify(changed) }).transport, sleep: noWait });
  assert.equal(run.documentsInserted, 1);
  assert.equal(run.documentsUnchanged, 1);

  const resources = testDb.prepare("SELECT id, version, supersedes_id, storage_key, collected_at FROM jurisprudence_resource WHERE installation_id = ? ORDER BY version").all(inst.id) as Array<{ id: string; version: number; supersedes_id: string | null; storage_key: string; collected_at: string }>;
  assert.deepEqual(resources.map((row) => row.version), [1, 2]);
  assert.equal(resources[1].supersedes_id, resources[0].id);
  assert.equal(resources[0].collected_at, "2025-01-15T00:00:00Z", "a versão anterior guarda a data de coleta original");
  // The previous file is still readable, byte for byte.
  const previous = JSON.parse((await (await objectStorage()).get(resources[0].storage_key)).toString("utf8"));
  assert.equal(previous[0].ementa, "Ementa sintética do julgado C1.");

  const versions = testDb.prepare("SELECT version, headnote, collected_at FROM jurisprudence_document WHERE installation_id = ? AND source_document_id = 'C1' ORDER BY version").all(inst.id).map((row) => ({ ...row }));
  assert.deepEqual(versions, [
    { version: 1, headnote: "Ementa sintética do julgado C1.", collected_at: "2025-01-15T00:00:00Z" },
    { version: 2, headnote: "Ementa corrigida do julgado C1.", collected_at: versions[1].collected_at },
  ]);
});

test("um recurso com N documentos conta N documentos e um recurso", async () => {
  const inst = await source();
  const pkg = fixture("ckan-package-show.json");
  const { transport } = answering(inst, "espelhos-sintetico", pkg, {
    [urlOf(pkg, "res-json")]: JSON.stringify(records(["J1"])),
    [urlOf(pkg, "res-zip")]: zip({ "parte-1.json": records(["Z1", "Z2", "Z3"]), "parte-2.json": records(["Z4", "Z5"]), "leia-me.txt": "ignorado" }),
    [urlOf(pkg, "res-propria")]: JSON.stringify(records(["P1"])),
  });
  const outcome = await syncDataset(inst, { datasetId: "espelhos-sintetico", contentKind: "espelho" }, { transport, sleep: noWait });
  assert.equal(outcome.resourcesDownloaded, 3);
  assert.equal(outcome.documentsInserted, 7, "1 + 5 + 1 documentos; três recursos");

  const zipRow = testDb.prepare("SELECT documents_count, storage_key FROM jurisprudence_resource WHERE installation_id = ? AND source_resource_id = 'res-zip'").get(inst.id) as { documents_count: number; storage_key: string };
  assert.equal(zipRow.documents_count, 5);
  assert.match(zipRow.storage_key, /\.zip$/);
  assert.equal((testDb.prepare("SELECT COUNT(*) AS n FROM jurisprudence_resource WHERE installation_id = ? AND source_resource_id = 'res-zip'").get(inst.id) as { n: number }).n, 1);
});

test("espelho e íntegra só se ligam quando a fonte liga", async () => {
  const inst = await source();
  const pkg = JSON.stringify({
    success: true,
    result: {
      id: "misto", license_id: "cc-by", license_title: "Creative Commons Attribution", organization: { title: "Superior Tribunal de Justiça" },
      resources: [
        { id: "espelhos", url: "https://dadosabertos.web.stj.jus.br/misto/espelhos.json", hash: "e1" },
        { id: "integras", url: "https://dadosabertos.web.stj.jus.br/misto/integras.json", hash: "i1" },
      ],
    },
  });
  const sameProcess = { numeroProcesso: "777777", ementa: "Mesma ementa, palavra por palavra." };
  const { transport } = answering(inst, "misto", pkg, {
    // E1 declares its full text; E2 merely shares process and wording with I2.
    "https://dadosabertos.web.stj.jus.br/misto/espelhos.json": JSON.stringify([
      ...records(["E1"], { documentoRelacionado: "I1" }),
      ...records(["E2"], sameProcess),
    ]),
    "https://dadosabertos.web.stj.jus.br/misto/integras.json": JSON.stringify([
      ...records(["I1"], { inteiroTeor: "Inteiro teor sintético de I1." }),
      ...records(["I2"], { ...sameProcess, inteiroTeor: "Inteiro teor sintético de I2." }),
    ]),
  });
  await syncDataset(inst, { datasetId: "misto", contentKind: "espelho" }, { transport, sleep: noWait });

  const doc = (id: string) => testDb.prepare("SELECT id, related_document_id FROM jurisprudence_document WHERE installation_id = ? AND source_document_id = ?").get(inst.id, id) as { id: string; related_document_id: string | null };
  // The relation resolved even though the target arrived in a later resource.
  assert.equal(doc("E1").related_document_id, doc("I1").id);
  assert.equal(doc("E2").related_document_id, null, "mesma ementa e mesmo processo não bastam");
  assert.equal(doc("I2").related_document_id, null);
});

test("varredura truncada retoma pelo cursor", async () => {
  const inst = await source();
  const pkg = fixture("ckan-pacote-truncado.json");
  const bodies = Object.fromEntries(["res-a", "res-b", "res-c"].map((id) => [urlOf(pkg, id), JSON.stringify(records([`T-${id}`]))]));

  const first = answering(inst, "espelhos-grande", pkg, bodies);
  const run1 = await syncDataset(inst, { datasetId: "espelhos-grande", contentKind: "espelho", maxDownloads: 2 }, { transport: first.transport, sleep: noWait });
  assert.equal(run1.truncated, true);
  assert.equal(run1.cursor, "res-c");
  assert.equal(first.downloads.length, 2);

  const second = answering(inst, "espelhos-grande", pkg, bodies);
  const run2 = await syncDataset(inst, { datasetId: "espelhos-grande", contentKind: "espelho", maxDownloads: 2, cursor: run1.cursor }, { transport: second.transport, sleep: noWait });
  assert.deepEqual(second.downloads, [urlOf(pkg, "res-c")], "retoma no res-c; não volta ao começo");
  assert.equal(run2.truncated, false);
  assert.equal(run2.resourcesUnchanged, 0, "res-a e res-b nem são revisitados");
  assert.equal((testDb.prepare("SELECT COUNT(*) AS n FROM jurisprudence_document WHERE installation_id = ?").get(inst.id) as { n: number }).n, 3);
});

test("normalize é puro", () => {
  const exploding: Transport = { mode: "fixture", request: () => { throw new Error("transporte chamado"); } };
  const connector = createCkanConnector(exploding);
  const payload = fixture("ckan-package-show.json");
  assert.deepEqual(connector.normalize("listPrecedents", payload), connector.normalize("listPrecedents", payload));

  const context = { contentKind: "espelho" as const, license: null, resourceRef: "r" };
  const bytes = zip({ "x.json": records(["N1", "N2"]) });
  const once = normalizeResource(bytes, context);
  assert.deepEqual(once, normalizeResource(bytes, context));
  assert.equal(once.items.length, 2);
  assert.equal(once.items[0].citationLabel, "STJ, REsp 1000001, Rel. MINISTRA RELATORA SINTÉTICA, TERCEIRA TURMA, julgado em 10/01/2025, publicado em 15/01/2025");
  // A record with neither identity nor text is counted, not stored.
  assert.equal(normalizeResource(Buffer.from(JSON.stringify([{ ementa: "sem id" }, { id: "sem-texto" }])), context).rejected, 2);
});
