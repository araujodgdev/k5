import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { listOfficeAudit, listPlatformAudit } from '../src/lib/audit';
import { auditActor, auditDetails, officeAuditLine, parseAuditCursor } from '../src/lib/audit-format';

async function office(name: string) {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, `${name} Advocacia`);
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, name);
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  return { officeId, userId };
}
const at = (minute: number) => `2026-10-03T12:${String(minute).padStart(2, '0')}:00.000Z`;

/** One row in each office log, a minute apart, oldest first: judicial, collaboration, ads, knowledge, google. */
async function seedOffice(officeId: string, userId: string, guestId: string) {
  const caseId = randomUUID();
  await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Silva contra Souza', userId);
  await testDb.prepare(`INSERT INTO judicial_access_audit(id,office_id,user_id,actor,action,subject_kind,outcome,created_at)
    VALUES(?,?,NULL,'worker','judicial.collect','job','error',?)`).run(randomUUID(), officeId, at(1));
  await testDb.prepare('INSERT INTO collaboration_audit(id,office_id,case_id,actor_user_id,target_user_id,action,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(), officeId, caseId, userId, guestId, 'participant.added', at(2));
  await testDb.prepare('INSERT INTO ads_connection_audit(id,office_id,actor_user_id,action,account_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), officeId, userId, 'connected', 'act_123', at(3));
  await testDb.prepare(`INSERT INTO knowledge_retrieval_audit(id,office_id,user_id,query,strategy,source_count,created_at)
    VALUES(?,?,?,'hash','hybrid',3,?)`).run(randomUUID(), officeId, userId, at(4));
  const connectionId = randomUUID();
  await testDb.prepare(`INSERT INTO google_connection(id,office_id,user_id,google_subject,email,status) VALUES(?,?,?,?,?,'active')`)
    .run(connectionId, officeId, userId, `sub-${connectionId}`, 'conta@example.test');
  await testDb.prepare(`INSERT INTO google_operation(id,office_id,user_id,connection_id,action,capability_name,invocation,idempotency_key,request_hash,
      encrypted_args,policy_version,policy_mode,status,usage_day,created_at)
    VALUES(?,?,?,?,'gmail.send','k5_gmail_send','agent',?,'h','x',1,'confirmation','succeeded',CURRENT_DATE,?)`)
    .run(randomUUID(), officeId, userId, connectionId, randomUUID(), at(5));
}

test('an office reads every log of its own, newest first, and nothing from another office', async () => {
  const mine = await office('Ana'), guest = await office('Rafael'), other = await office('Outra');
  await seedOffice(mine.officeId, mine.userId, guest.userId);
  await seedOffice(other.officeId, other.userId, guest.userId);

  const { entries, next } = await listOfficeAudit(mine.officeId);
  assert.equal(next, null);
  assert.deepEqual(entries.map(entry => entry.source), ['google', 'knowledge', 'ads', 'collaboration', 'judicial']);
  assert.deepEqual(entries.map(entry => `${auditActor(entry.actorKind, entry.actorName)} ${officeAuditLine(entry)}`), [
    'Ana, pelo Lume, enviou um e-mail',
    'Ana buscou no Cofre e usou 3 fontes',
    'Ana conectou a conta de anúncios act_123',
    'Ana incluiu Rafael no caso Silva contra Souza',
    'Rotina automática consultou o tribunal',
  ]);
  assert.deepEqual(entries.map(entry => entry.outcome), ['ok', 'ok', 'ok', 'ok', 'error']);

  const collaboration = await listOfficeAudit(mine.officeId, { source: 'collaboration' });
  assert.deepEqual(collaboration.entries.map(entry => entry.action), ['participant.added']);
  assert.equal((await listOfficeAudit(mine.officeId, { source: 'unknown' })).entries.length, 0);
});

test('pages never skip or repeat rows written in the same instant', async () => {
  const { officeId, userId } = await office('Página');
  // Five rows sharing a microsecond, then two older ones.
  for (const created of [...Array(5).fill('2026-10-03T12:00:00.123456Z'), '2026-10-03T11:00:00Z', '2026-10-03T10:00:00Z']) {
    await testDb.prepare('INSERT INTO ads_connection_audit(id,office_id,actor_user_id,action,account_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), officeId, userId, 'verified', 'act', created);
  }
  const seen: string[] = [];
  let before: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof listOfficeAudit>> = await listOfficeAudit(officeId, { before, limit: 2 });
    seen.push(...page.entries.map(entry => entry.id));
    before = page.next;
  } while (before);
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
  assert.match(String((await listOfficeAudit(officeId, { limit: 2 })).next), /^2026-10-03T12:00:00\.123456Z_/);
});

test('the platform log filters by group and office, reading underscores literally', async () => {
  const admin = await office('Admin'), client = await office('Cliente');
  const rows: [string, string | null, object][] = [
    ['credits.granted', client.officeId, { credits: 50, requestId: 'r1' }],
    ['ai_connection.created', null, { name: 'Principal', provider: 'openai' }],
    ['aiXconnection.created', null, {}],
    ['billing.refund_requested', client.officeId, { targetId: 't1' }],
  ];
  for (const [index, [action, officeId, details]] of rows.entries()) {
    await testDb.prepare('INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), admin.userId, officeId, action, JSON.stringify(details), at(30 + index));
  }
  const all = await listPlatformAudit(testDb, {});
  assert.ok(all.entries.length >= 4);
  const ai = await listPlatformAudit(testDb, { group: 'ai' });
  assert.ok(ai.entries.every(entry => entry.action.startsWith('ai_connection.') || entry.action.startsWith('ai_assignment.')));
  assert.ok(ai.entries.some(entry => entry.action === 'ai_connection.created'));

  const forClient = await listPlatformAudit(testDb, { officeId: client.officeId });
  assert.deepEqual(forClient.entries.map(entry => entry.action), ['billing.refund_requested', 'credits.granted']);
  assert.equal(forClient.entries[1].officeName, 'Cliente Advocacia');
  assert.equal(forClient.entries[1].actorName, 'Admin');
  assert.equal(auditDetails(forClient.entries[1].details), 'credits: 50 · requestId: r1');
  assert.deepEqual((await listPlatformAudit(testDb, { officeId: client.officeId, group: 'credits' })).entries.map(entry => entry.action), ['credits.granted']);
});

test('cursors that were not issued by a page are ignored', () => {
  assert.equal(parseAuditCursor("2026-10-03T12:00:00Z_x'; DROP TABLE office"), null);
  assert.equal(parseAuditCursor('qualquer coisa'), null);
  assert.deepEqual(parseAuditCursor('2026-10-03T12:00:00.123456Z_abc-1'), { at: '2026-10-03T12:00:00.123456Z', id: 'abc-1' });
  assert.equal(auditDetails('não é json'), '');
});
