import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  claimRun, conversation, createConversation, mergeHistory, ownedArtifact, ownedRun,
  publicArtifact, publicRun, saveMessages, updateArtifact,
} from "../src/lib/ai-store";
import { nodeSqliteDatabase } from "../src/lib/db/node-sqlite";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);");
  db.exec(readFileSync(new URL("../db/migrations/0001_offices.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../db/migrations/0004_ai_workspace.sql", import.meta.url), "utf8"));
  const userA = randomUUID(), userB = randomUUID(), officeA = randomUUID(), officeB = randomUUID();
  db.prepare("INSERT INTO user (id,email,name) VALUES (?,?,?),(?,?,?)").run(userA, "a@example.test", "A", userB, "b@example.test", "B");
  db.prepare("INSERT INTO office (id,name) VALUES (?,?),(?,?)").run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia");
  db.prepare("INSERT INTO office_member (id,office_id,user_id,role) VALUES (?,?,?,?),(?,?,?,?)")
    .run(randomUUID(), officeA, userA, "lawyer", randomUUID(), officeB, userB, "lawyer");
  // The raw handle arranges rows; `database` is the async seam every module under test uses.
  return { db, database: nodeSqliteDatabase(db), userA, userB, officeA, officeB };
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}
function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

test("mergeHistory appends a new user message", () => {
  const stored = [userMessage("u1", "oi"), assistantMessage("a1", "olá")];
  const result = mergeHistory(stored, userMessage("u2", "tudo bem?"));
  assert.deepEqual(result.map(m => m.id), ["u1", "a1", "u2"]);
});

test("mergeHistory truncates on regenerate without duplicating the user turn", () => {
  // Regenerate (ActionBarPrimitive.Reload) resends the same user message id that is
  // already the second-to-last entry in stored history (the assistant reply follows it).
  const stored = [userMessage("u1", "oi"), assistantMessage("a1", "olá")];
  const result = mergeHistory(stored, userMessage("u1", "oi"));
  assert.deepEqual(result.map(m => m.id), ["u1"]);
  assert.equal(result.filter(m => m.id === "u1").length, 1);
});

test("mergeHistory replaces and truncates when an earlier message is edited", () => {
  const stored = [userMessage("u1", "oi"), assistantMessage("a1", "olá"), userMessage("u2", "e depois?"), assistantMessage("a2", "resposta")];
  const result = mergeHistory(stored, userMessage("u1", "oi, editado"));
  assert.deepEqual(result.map(m => m.id), ["u1"]);
  assert.equal((result[0].parts[0] as { text: string }).text, "oi, editado");
});

test("conversation, run and artifact access is scoped by office and user", async () => {
  const { db, database, userA, userB, officeA, officeB } = fixture();
  const ownerA = { officeId: officeA, userId: userA };
  const ownerB = { officeId: officeB, userId: userB };

  const created = await createConversation(database, ownerA);
  assert.equal((await conversation(database, ownerA, created.id))?.conversation.id, created.id);
  assert.equal(await conversation(database, ownerB, created.id), null, "other office/user must not see the conversation");

  await saveMessages(database, ownerA, created.id, [userMessage("u1", "Qual o prazo do recurso?")]);
  const reloaded = await conversation(database, ownerA, created.id);
  assert.equal(reloaded?.conversation.title, "Qual o prazo do recurso?");
  assert.equal(reloaded?.messages.length, 1);

  const runId = randomUUID();
  db.prepare(`INSERT INTO ai_run (id, office_id, user_id, kind, input, lease_token) VALUES (?,?,?,?,?,?)`)
    .run(runId, officeA, userA, "chronology", "{}", randomUUID());
  assert.equal((await ownedRun(database, ownerA, runId))?.id, runId);
  assert.equal(await ownedRun(database, ownerB, runId), undefined, "other office/user must not see the run");
  assert.equal(publicRun((await ownedRun(database, ownerA, runId))!).id, runId);

  const claimed = await claimRun(database);
  assert.equal(claimed?.id, runId);
  assert.equal(claimed?.status, "running");

  const artifactId = randomUUID();
  db.prepare(`INSERT INTO ai_artifact (id, office_id, user_id, run_id, title, content) VALUES (?,?,?,?,?,?)`)
    .run(artifactId, officeA, userA, runId, "Minuta", "conteúdo");
  assert.equal((await ownedArtifact(database, ownerA, artifactId))?.id, artifactId);
  assert.equal(await ownedArtifact(database, ownerB, artifactId), undefined, "other office/user must not see the artifact");
  assert.equal(publicArtifact((await ownedArtifact(database, ownerA, artifactId))!).title, "Minuta");
});

test("updateArtifact enforces optimistic version conflicts", async () => {
  const { db, database, userA, officeA } = fixture();
  const owner = { officeId: officeA, userId: userA };
  const runId = randomUUID();
  db.prepare(`INSERT INTO ai_run (id, office_id, user_id, kind, input, lease_token) VALUES (?,?,?,?,?,?)`)
    .run(runId, officeA, userA, "draft", "{}", randomUUID());
  const artifactId = randomUUID();
  db.prepare(`INSERT INTO ai_artifact (id, office_id, user_id, run_id, title, content) VALUES (?,?,?,?,?,?)`)
    .run(artifactId, officeA, userA, runId, "Minuta", "v1");

  const updated = await updateArtifact(database, owner, artifactId, "Minuta revisada", "v2", 1);
  assert.ok(updated);
  assert.equal(updated?.version, 2);
  assert.equal(updated?.status, "needs_review");

  // Stale version (still 1) must be rejected without side effects.
  const stale = await updateArtifact(database, owner, artifactId, "Minuta conflitante", "v3", 1);
  assert.equal(stale, null);
  assert.equal((await ownedArtifact(database, owner, artifactId))?.version, 2);
  assert.equal((await ownedArtifact(database, owner, artifactId))?.content, "v2");

  const history = db.prepare("SELECT version FROM ai_artifact_version WHERE artifact_id = ? ORDER BY version").all(artifactId) as Array<{ version: number }>;
  assert.deepEqual(history.map(h => h.version), [2]);
});

test("updateArtifact rolls back the artifact when history cannot be recorded", async () => {
  const { db, database, userA, officeA } = fixture();
  const owner = { officeId: officeA, userId: userA };
  const runId = randomUUID();
  db.prepare(`INSERT INTO ai_run (id, office_id, user_id, kind, input, lease_token) VALUES (?,?,?,?,?,?)`)
    .run(runId, officeA, userA, "draft", "{}", randomUUID());
  const artifactId = randomUUID();
  db.prepare(`INSERT INTO ai_artifact (id, office_id, user_id, run_id, title, content) VALUES (?,?,?,?,?,?)`)
    .run(artifactId, officeA, userA, runId, "Minuta", "v1");
  db.exec(`CREATE TRIGGER reject_artifact_history BEFORE INSERT ON ai_artifact_version
    BEGIN SELECT RAISE(ABORT, 'history failure'); END;`);

  await assert.rejects(
    () => updateArtifact(database, owner, artifactId, "Minuta revisada", "v2", 1),
    /history failure/,
  );

  const artifact = await ownedArtifact(database, owner, artifactId);
  assert.equal(artifact?.version, 1);
  assert.equal(artifact?.title, "Minuta");
  assert.equal(artifact?.content, "v1");
  assert.equal(db.prepare("SELECT count(*) AS total FROM ai_artifact_version WHERE artifact_id=?").get(artifactId)!.total, 0);
});
