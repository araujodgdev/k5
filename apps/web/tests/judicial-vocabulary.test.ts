import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyCoverage, type NormalizedMovement } from "../src/lib/judicial/contracts";
import {
  currentVocabularyVersion, importVocabulary, listCurrentTerms, resolveTpu, vocabularyFileSchema,
} from "../src/lib/judicial/normalization/vocabulary";
import { upsertInstallation } from "../src/lib/judicial/repositories/installations";
import { ingestCase, listMovements } from "../src/lib/judicial/repositories/cases";

const catalog = (name: string) => vocabularyFileSchema.parse(
  JSON.parse(readFileSync(new URL(`./fixtures/judicial/${name}`, import.meta.url), "utf8")),
);
const V1 = catalog("tpu-v1.json");
const V2 = catalog("tpu-v2.json");

// The catalog is global, so each test imports under its own version names and "current" is
// always the version that test imported last.
let run = 0;
const version = (name: string) => `${name}-t${run}`;
test.beforeEach(() => { run += 1; });

const count = (sql: string, ...params: string[]) => (testDb.prepare(sql).get(...params) as { n: number }).n;

function movement(id: string, code: string | null, declared: boolean, text: string): NormalizedMovement {
  return {
    sourceMovementId: id, sourceCode: code, sourceText: text,
    tpuCode: declared ? code : null, tpuSource: declared ? "source_declared" : null,
    eventAt: "2025-01-10", eventPrecision: "date", eventTimezone: null,
  };
}

/** One office with one collected case whose movements use codes the catalogs know and do not. */
async function collected() {
  const officeId = randomUUID();
  testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, "Escritório Vocabulário");
  const installation = await upsertInstallation({
    kind: "mni", courtCode: `TJVOC${run}`, courtName: "Tribunal Sintético", degree: "first", system: "pje",
    purpose: "case_tracking", baseUrl: "https://pje.exemplo.jus.br/", authKind: "none",
    permissions: { query: "permitido", cache: "permitido" }, allowedHosts: ["pje.exemplo.jus.br"], enabled: true,
  });
  await ingestCase({
    officeId, installation, linkId: null, jobId: null,
    result: {
      items: [{
        sourceRecordId: `00000010520258260100@first#${run}`,
        identity: { cnjNumber: "00000010520258260100", nativeNumber: null, degree: "first" },
        title: null, classCode: "7", subjectCodes: [], sourceUpdatedAt: null,
        movements: [
          movement("m-11010", "11010", true, "Despacho"),
          movement("m-60", "60", true, "Expedido ofício"),
          movement("m-581", "581", true, "Juntada"),
          movement("m-99999", "99999", true, "Código nacional que o catálogo não conhece"),
          movement("m-local", "26", false, "Conclusos para despacho"),
        ],
      }],
      cursor: null,
      coverage: { ...emptyCoverage(), pagesFetched: 1 },
      source: { installationId: installation.id, operation: "lookupCase", parserVersion: "teste", collectedAt: "2025-01-11T00:00:00Z" },
      rawPayloads: [{ contentType: "text/xml", body: `<amostra run="${run}"/>` }],
    },
  });
  const byId = async () => Object.fromEntries((await listMovements(officeId)).map((row) => [row.sourceText, row]));
  return { officeId, byId };
}

test("reimportar a mesma versão é inerte", async () => {
  const v = version("v1");
  assert.deepEqual(await importVocabulary(V1, v), { ok: true, version: v, inserted: 7, unchanged: 0 });
  const before = testDb.prepare("SELECT id, kind, code, label, valid_to FROM judicial_vocabulary_term WHERE version = ? ORDER BY id").all(v);

  assert.deepEqual(await importVocabulary(V1, v), { ok: true, version: v, inserted: 0, unchanged: 7 });
  assert.deepEqual(testDb.prepare("SELECT id, kind, code, label, valid_to FROM judicial_vocabulary_term WHERE version = ? ORDER BY id").all(v), before);

  // Different content under the same version is refused whole: nothing changes, nothing is added.
  const refused = await importVocabulary(V2, v);
  assert.equal(refused.ok, false);
  assert.deepEqual(!refused.ok && [...refused.conflicts].sort(), ["movement:11010", "movement:12000", "movement:581", "movement:60"]);
  assert.equal(count("SELECT COUNT(*) AS n FROM judicial_vocabulary_term WHERE version = ?", v), 7);
});

test("nova versão não reescreve movimento já gravado", async () => {
  await importVocabulary(V1, version("v1"));
  const { officeId, byId } = await collected();
  const snapshot = () => testDb.prepare("SELECT * FROM judicial_movement WHERE office_id = ? ORDER BY id").all(officeId).map((row) => ({ ...row }));
  const before = snapshot();
  assert.equal((await byId())["Despacho"].tpuLabel, "Mero expediente");

  await importVocabulary(V2, version("v2"));
  assert.deepEqual(snapshot(), before, "nenhuma linha de movimento muda com o catálogo novo");
  // The label is read, not stored: the renamed code now reads with the current version's name.
  assert.equal((await byId())["Despacho"].tpuLabel, "Proferido despacho de mero expediente");
  assert.equal(await currentVocabularyVersion(), version("v2"));
});

test("código desconhecido preserva o original e não inventa TPU", async () => {
  await importVocabulary(V1, version("v1"));
  const { byId } = await collected();
  const rows = await byId();

  const unknown = rows["Código nacional que o catálogo não conhece"];
  assert.deepEqual([unknown.sourceCode, unknown.tpuCode, unknown.tpuLabel], ["99999", "99999", null]);
  assert.equal(await resolveTpu("movement", "99999"), null);

  // A local code that collides with a national one (26 is "Distribuição" in the catalog) is the
  // tribunal's own numbering, and is never looked up in the national catalog.
  const local = rows["Conclusos para despacho"];
  assert.deepEqual([local.sourceCode, local.tpuCode, local.tpuLabel], ["26", null, null]);
});

test("rótulos parecidos com códigos diferentes não se unificam", async () => {
  await importVocabulary(V1, version("v1"));
  const realized = await resolveTpu("movement", "970");
  const scheduled = await resolveTpu("movement", "11385");
  assert.deepEqual(realized, { code: "970", label: "Audiência de conciliação realizada", source: "catalog_exact" });
  assert.deepEqual(scheduled, { code: "11385", label: "Audiência de conciliação designada", source: "catalog_exact" });

  // Exact code only: no padding, no trimming, no kind crossing, no lookup by label.
  assert.equal(await resolveTpu("movement", "0970"), null);
  assert.equal(await resolveTpu("class", "970"), null);
  assert.equal(await resolveTpu("movement", "Audiência de conciliação realizada"), null);

  // `catalog_exact` is the only strategy that exists in the module.
  const source = readFileSync(new URL("../src/lib/judicial/normalization/vocabulary.ts", import.meta.url), "utf8");
  assert.deepEqual([...new Set(source.match(/source: '[a-z_]+'/g))], ["source: 'catalog_exact'"]);
  assert.doesNotMatch(source, /\bLIKE\b|\blower\(|levenshtein|\.toLowerCase\(/);
});

test("termo vencido não vira filtro corrente mas resolve histórico", async () => {
  await importVocabulary(V1, version("v1"));
  await importVocabulary(V2, version("v2"));
  const current = (await listCurrentTerms("movement", "2026-09-22")).map((term) => term.code);
  assert.equal(current.includes("60"), false, "vencido em 2024-12-31");
  assert.equal(current.includes("581"), false, "retirado na v2");
  assert.ok(current.includes("12000") && current.includes("26"));

  // History still has a name for both.
  assert.equal((await resolveTpu("movement", "60"))?.label, "Expedição de documento");
  assert.equal((await resolveTpu("movement", "581"))?.label, "Juntada de documento");
  const { byId } = await collected();
  assert.equal((await byId())["Juntada"].tpuLabel, "Juntada de documento");
  assert.equal((await byId())["Expedido ofício"].tpuLabel, "Expedição de documento");
});
