import { testDb } from "./test-setup";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { WorkspaceContext } from "../src/lib/application/context";
import * as vaultService from "../src/lib/application/vault-service";
import * as uploadsService from "../src/lib/application/uploads-service";
import { cancelOfficeDeletion, openDeletionRequest, purgeOffice, requestOfficeDeletion } from "../src/lib/office-deletion";

async function seedOffice(label: string): Promise<WorkspaceContext & { email: string }> {
  const userId = randomUUID();
  const officeId = randomUUID();
  const email = `${label}-${randomUUID()}@lume.test`;
  await testDb.prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(userId, email, label);
  await testDb.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, `${label} Advocacia`);
  await testDb.prepare("INSERT INTO office_member (id, office_id, user_id) VALUES (?, ?, ?)").run(randomUUID(), officeId, userId);
  const context = { officeId, userId } as WorkspaceContext;
  const clientId = randomUUID();
  await testDb.prepare("INSERT INTO crm_client (id, office_id, name, stage, created_at, updated_at) VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run(clientId, officeId, `Cliente de ${label}`);
  const caseId = (await vaultService.createCase(context, { name: `Caso de ${label}` })).case.id;
  await testDb.prepare("INSERT INTO crm_client_case (office_id, client_id, case_id) VALUES (?, ?, ?)").run(officeId, clientId, caseId);
  const upload = await uploadsService.createUploadRef(context, new File([`peça de ${label}`], "peca.txt", { type: "text/plain" }));
  await vaultService.ingestUpload(context, { uploadRef: upload.id, scope: "case", caseId });
  await testDb.prepare(`INSERT INTO agenda_activity (id, office_id, kind, title, status, due_on, client_id, case_id, created_by, created_at, updated_at)
    VALUES (?, ?, 'task', 'Prazo de contestação', 'pending', CURRENT_DATE, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(randomUUID(), officeId, clientId, caseId, userId);
  await testDb.prepare("INSERT INTO ai_conversation (id, office_id, user_id, title) VALUES (?, ?, ?, 'Conversa')").run(randomUUID(), officeId, userId);
  const agreementId = randomUUID();
  await testDb.prepare("INSERT INTO honorario_agreement (id, office_id, client_id, title, created_by) VALUES (?, ?, ?, 'Honorários', ?)").run(agreementId, officeId, clientId, userId);
  await testDb.prepare("INSERT INTO honorario_installment (id, office_id, agreement_id, number, due_on, amount_cents) VALUES (?, ?, ?, 1, CURRENT_DATE, 100000)").run(randomUUID(), officeId, agreementId);
  return { ...context, email };
}

/** Rows that still name the office, in every table that has an office_id and is not kept on purpose. */
async function remaining(officeId: string) {
  const tables = await testDb.prepare(`SELECT table_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'office_id'`).all<{ name: string }>();
  const kept = new Set(['office', 'office_deletion_request', 'vault_deletion_queue', 'honcho_deletion', 'platform_audit_log', 'office_billing']);
  const left: Record<string, number> = {};
  for (const { name } of tables) {
    if (kept.has(name) || name.startsWith('billing_')) continue;
    const row = await testDb.prepare(`SELECT count(*)::int AS n FROM "${name}" WHERE office_id = ?`).get<{ n: number }>(officeId);
    if (row?.n) left[name] = row.n;
  }
  return left;
}

test("deletion: a request waits, can be cancelled, and is asked once at a time", async () => {
  const office = await seedOffice("Prazo");
  const first = await requestOfficeDeletion(office);
  const again = await requestOfficeDeletion(office);
  assert.equal(again.id, first.id, "a second click does not schedule a second deletion");
  assert.ok(Date.parse(first.scheduledFor) - Date.parse(first.requestedAt) >= 6.9 * 24 * 3600 * 1000);
  assert.equal(await cancelOfficeDeletion(office.officeId), true);
  assert.equal(await openDeletionRequest(office.officeId), undefined);
  await assert.rejects(() => purgeOffice(first.id, { dryRun: true }), /não encontrado/, "a cancelled request cannot be carried out");
});

test("deletion: the purge removes everything the office owns, queues its files, and leaves other offices alone", async () => {
  const office = await seedOffice("Alfa");
  const other = await seedOffice("Beta");
  const request = await requestOfficeDeletion(office);

  const preview = await purgeOffice(request.id, { dryRun: true });
  assert.ok(preview.deleted.vault_document && preview.deleted.crm_client && preview.deleted.honorario_installment, JSON.stringify(preview.deleted));
  assert.ok(Object.keys(await remaining(office.officeId)).length > 0, "a dry run changes nothing");

  const report = await purgeOffice(request.id, { dryRun: false });
  assert.deepEqual(await remaining(office.officeId), {});
  assert.ok(report.objects >= 1 && report.vectors >= 1);
  const queued = await testDb.prepare("SELECT target_kind AS kind, count(*)::int AS n FROM vault_deletion_queue WHERE office_id=? AND completed_at IS NULL GROUP BY target_kind ORDER BY target_kind")
    .all<{ kind: string; n: number }>(office.officeId);
  assert.deepEqual(queued.map(row => row.kind), ["object", "vector_document"], "originals and vectors leave through the existing queue");
  const person = await testDb.prepare('SELECT name, email FROM "user" WHERE id=?').get<{ name: string; email: string }>(office.userId);
  assert.equal(person?.name, "Conta excluída");
  assert.ok(!person?.email.includes(office.email.split("@")[0]), "the e-mail no longer identifies the person");
  assert.equal((await testDb.prepare("SELECT status FROM office_deletion_request WHERE id=?").get<{ status: string }>(request.id))?.status, "completed");

  const untouched = await testDb.prepare("SELECT count(*)::int AS n FROM crm_client WHERE office_id=?").get<{ n: number }>(other.officeId);
  assert.equal(untouched?.n, 1);
  assert.ok((await testDb.prepare("SELECT count(*)::int AS n FROM vault_document WHERE office_id=?").get<{ n: number }>(other.officeId))!.n >= 1);
});

test("deletion: memory leaves with the purge's transaction, and a rolled-back purge keeps it", async () => {
  const office = await seedOffice("Memoria");
  const resource = `${office.officeId}:${office.userId}`;
  await testDb.prepare(`INSERT INTO mastra_resources (id, "workingMemory", "createdAt", "updatedAt") VALUES (?, '- Prefere respostas curtas.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(resource);
  await testDb.prepare("INSERT INTO honcho_memory (office_id, user_id, generation) VALUES (?, ?, 3)").run(office.officeId, office.userId);
  const previous = process.env.HONCHO_API_KEY;
  process.env.HONCHO_API_KEY = "honcho-test-key";
  try {
    const request = await requestOfficeDeletion(office);
    await purgeOffice(request.id, { dryRun: true });
    assert.ok(await testDb.prepare("SELECT 1 FROM mastra_resources WHERE id=?").get(resource), "the dry run rolls back and the memory stays");
    assert.equal(await testDb.prepare("SELECT 1 FROM honcho_deletion WHERE office_id=?").get(office.officeId), undefined, "nothing is asked of Honcho");

    await purgeOffice(request.id, { dryRun: false });
    assert.equal(await testDb.prepare("SELECT 1 FROM mastra_resources WHERE id=?").get(resource), undefined);
    const queued = await testDb.prepare("SELECT workspace_id AS workspace FROM honcho_deletion WHERE office_id=? AND user_id=?").all<{ workspace: string }>(office.officeId, office.userId);
    assert.equal(queued.length, 1, "the current Honcho workspace is queued for deletion, once");
  } finally {
    if (previous === undefined) delete process.env.HONCHO_API_KEY; else process.env.HONCHO_API_KEY = previous;
  }
});
