import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeZip } from "client-zip";

import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { contextForCase } from "../src/lib/collaboration/access";
import { officeExportEntries, safeSegment } from "../src/lib/office-export";

async function seedOffice(label: string): Promise<WorkspaceContext> {
  const userId = randomUUID();
  const officeId = randomUUID();
  await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, `${label}-${randomUUID()}@lume.test`, label);
  await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, `${label} Advocacia`);
  await testDb.prepare("INSERT INTO office_member (id, office_id, user_id) VALUES (?, ?, ?)").run(randomUUID(), officeId, userId);
  await testDb.prepare("INSERT INTO crm_client (id, office_id, name, stage, created_at, updated_at) VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
    .run(randomUUID(), officeId, `Cliente de ${label}`);
  return { officeId, userId } as WorkspaceContext;
}

/** File names and bytes of a stored (uncompressed) ZIP, read from its central directory. */
function entries(zip: Buffer) {
  const files = new Map<string, Buffer>();
  for (let at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) {
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const local = zip.readUInt32LE(at + 42);
    const size = zip.readUInt32LE(at + 20);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.set(name, zip.subarray(start, start + size));
  }
  return files;
}

test("export: the office's records and originals, and nothing of another office", async () => {
  const office = await seedOffice("Alfa");
  const other = await seedOffice("Beta");
  const caseId = (await vaultService.createCase(office, { name: "Ação de Cobrança / 2026" })).case.id;
  const upload = await uploadsService.createUploadRef(office, new File(["conteúdo original da petição"], "petição inicial.txt", { type: "text/plain" }));
  await vaultService.ingestUpload(office, { uploadRef: upload.id, scope: "case", caseId });

  const zip = Buffer.from(await new Response(makeZip(officeExportEntries(office))).arrayBuffer());
  const files = entries(zip);
  assert.ok(files.has("LEIA-ME.txt"));
  const clients = files.get("dados/clientes.jsonl")!.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(clients.map(client => client.name), ["Cliente de Alfa"]);
  assert.ok(!zip.includes(Buffer.from("Cliente de Beta")), "another office's records never enter the export");
  assert.equal(files.get("cofre/Ação de Cobrança _ 2026/petição inicial.txt")?.toString("utf8"), "conteúdo original da petição");
  const documents = files.get("dados/documentos.jsonl")!.toString("utf8");
  assert.ok(documents.includes("petição inicial.txt"));
  assert.ok(!documents.includes("stored_name") && !documents.includes(upload.storageKey), "storage keys are internal");
  assert.ok(other.officeId);
});

test("export: a participant's private folder stays out, what the owner sees stays in", async () => {
  const office = await seedOffice("Alfa");
  const guest = await seedOffice("Bia");
  const caseId = (await vaultService.createCase(office, { name: "Caso compartilhado" })).case.id;
  await testDb.prepare("INSERT INTO case_participant (office_id, case_id, user_id, invited_by) VALUES (?, ?, ?, ?)").run(office.officeId, caseId, guest.userId, office.userId);
  const participant = await contextForCase(guest, caseId);
  const upload = async (person: WorkspaceContext, name: string, content: string, folderId?: string) => {
    const ref = await uploadsService.createUploadRef(person, new File([content], name, { type: "text/plain" }));
    return (await vaultService.ingestUpload(person === guest ? participant : person, { uploadRef: ref.id, scope: "case", caseId, folderId })).document;
  };
  const privateFolder = (await vaultService.createFolder(participant, { caseId, name: "Anotações da Bia", visibility: "private" })).folder;
  const hidden = await upload(guest, "rascunho.txt", "rascunho privado da Bia", privateFolder.id);
  const shared = await upload(guest, "parecer.txt", "parecer compartilhado pela Bia");
  const own = await upload(office, "contrato.txt", "contrato do escritório");

  const zip = Buffer.from(await new Response(makeZip(officeExportEntries(office))).arrayBuffer());
  const files = entries(zip);
  assert.equal(files.get("cofre/Caso compartilhado/contrato.txt")?.toString("utf8"), "contrato do escritório");
  assert.equal(files.get("cofre/Caso compartilhado/parecer.txt")?.toString("utf8"), "parecer compartilhado pela Bia");
  assert.ok(files.get("dados/documentos.jsonl")!.includes(own.id) && files.get("dados/documentos.jsonl")!.includes(shared.id));
  assert.ok(!zip.includes(Buffer.from(privateFolder.id)), "the participant's private folder is not listed");
  assert.ok(!zip.includes(Buffer.from(hidden.id)), "its document is not listed, nor its versions");
  assert.ok(!files.has("cofre/Caso compartilhado/rascunho.txt") && !zip.includes(Buffer.from("rascunho privado da Bia")), "its original never enters the export");
});

test("export: each version is checked against its own content policy, not the active one's", async () => {
  const office = await seedOffice("Alfa");
  const caseId = (await vaultService.createCase(office, { name: "Caso versionado" })).case.id;
  const ref = await uploadsService.createUploadRef(office, new File(["primeira versão"], "versao-restrita.txt", { type: "text/plain" }));
  const { document } = await vaultService.ingestUpload(office, { uploadRef: ref.id, scope: "case", caseId });
  const first = (await testDb.prepare("SELECT id, stored_name, sha256 FROM vault_document_version WHERE document_id=? AND version=1")
    .get<{ id: string; stored_name: string; sha256: string }>(document.id))!;
  // A policy whose digest names other bytes is visible to no one.
  await testDb.prepare(`UPDATE vault_document_version SET is_active=0, content_policy='{"digest":"outros-bytes"}'::jsonb WHERE id=?`).run(first.id);
  const second = randomUUID();
  await testDb.prepare("INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active) VALUES(?,?,?,2,?,?,?,?,?,?,1)")
    .run(second, office.officeId, document.id, "versao-atual.txt", first.stored_name, "text/plain", 16, first.sha256, office.userId);
  await testDb.prepare("UPDATE vault_document SET original_name='versao-atual.txt' WHERE id=?").run(document.id);

  const versions = entries(Buffer.from(await new Response(makeZip(officeExportEntries(office))).arrayBuffer())).get("dados/documentos-versoes.jsonl")!.toString("utf8");
  assert.ok(versions.includes(second), "the active version is exported");
  assert.ok(!versions.includes(first.id) && !versions.includes("versao-restrita.txt"), "the older version its own policy hides stays out");
});

test("export: file names stay valid in any unzip tool", () => {
  assert.equal(safeSegment("../../etc/passwd", "x"), "_.._etc_passwd");
  assert.equal(safeSegment("   ", "fallback"), "fallback");
  assert.equal(safeSegment('a:b*c?"d<e>f|g', "x"), "a_b_c__d_e_f_g");
});
