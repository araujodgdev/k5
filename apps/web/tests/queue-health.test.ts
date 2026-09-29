import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Database } from '../src/lib/db/types';
import { inspectQueueHealth, type QueueHealthAlert } from '../src/lib/observability/queue-health';
import { postgresFixture } from './postgres-fixture';

const now = Date.parse('2026-09-29T12:00:00.000Z');
const minutesAgo = (minutes: number) => now - minutes * 60_000;
const iso = (minutes: number) => new Date(minutesAgo(minutes)).toISOString();

async function seedQueues(db: Database) {
  await db.exec(`
    INSERT INTO "user"(id,email,name) VALUES('user','private@example.test','Private name');
    INSERT INTO office(id,name) VALUES('office','Private office');
    INSERT INTO office_member(id,office_id,user_id,role) VALUES('member','office','user','administrator');
    INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,enabled)
      VALUES('source','jurisprudence_api','fixture','Fixture','superior','not_applicable','jurisprudence',1);
    INSERT INTO google_connection(id,office_id,user_id,google_subject,email,status)
      VALUES('connection','office','user','private-subject','private@example.test','active');
    INSERT INTO knowledge_index_generation(id,office_id,profile_name,model_id,dimension,chunker)
      VALUES('generation','office','embedding','fixture',8,'structural');
  `);
  await db.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,
    byte_size,sha256,status,created_by,created_at,updated_at)
    VALUES('document','office','library','Private name.pdf','private-storage-key','application/pdf',1,'hash',
      'queued','user',?,?)`).run(iso(45), iso(45));
  await db.prepare(`INSERT INTO knowledge_index_job(id,office_id,document_id,generation_id,created_at,updated_at)
    VALUES('index','office','document','generation',?,?)`).run(iso(45), iso(45));
  for (const runtime of ['edge', 'node']) {
    await db.prepare(`INSERT INTO google_job(id,office_id,user_id,connection_id,kind,runtime,status,
      run_after,created_at,updated_at) VALUES(?,'office','user','connection','calendar_sync',?,'queued',?,?,?)`)
      .run(`google-${runtime}`, runtime, iso(45), iso(45), iso(45));
  }
  await db.prepare(`INSERT INTO research_job(id,office_id,user_id,installation_id,kind,idempotency_key,
    created_at,updated_at) VALUES('research','office','user','source','search_page','private-key',?,?)`)
    .run(iso(45), iso(45));
  await db.prepare(`INSERT INTO judicial_sync_job(id,office_id,installation_id,kind,operation,created_at,updated_at)
    VALUES('judicial','office','source','manual','fixture',?,?)`).run(iso(45), iso(45));
  await db.prepare(`INSERT INTO notification_event(id,office_id,event_type,source_kind,intended_recipients_json,
    data_json,dedupe_key,created_at)
    VALUES('event','office','system.fixture','system','["user"]','{"private":"content"}','private-key',?)`)
    .run(iso(45));
  await db.prepare(`INSERT INTO notification_recipient(event_id,office_id,user_id,created_at)
    VALUES('event','office','user',?)`).run(iso(45));
  await db.prepare(`INSERT INTO push_subscription(id,office_id,user_id,device_id,endpoint_hash,
    encrypted_subscription,vapid_key_id,auth_generation,subscribed_at,last_reconciled_at)
    VALUES('subscription','office','user','private-device','private-endpoint','private-secret','fixture',1,?,?)`)
    .run(iso(45), iso(45));
  await db.prepare(`INSERT INTO notification_delivery(id,event_id,office_id,user_id,subscription_id,
    group_key,next_attempt_at,expires_at,created_at,updated_at)
    VALUES('delivery','event','office','user','subscription','private-group',?,?,?,?)`)
    .run(iso(45), iso(-60), iso(45), iso(45));
  await db.prepare(`INSERT INTO ai_run(id,office_id,user_id,kind,input,created_at,updated_at)
    VALUES('run','office','user','draft','private prompt',?,?)`).run(iso(45), iso(45));
  await db.prepare(`INSERT INTO ai_conversation(id,office_id,user_id,title,messages,busy_until,created_at,updated_at)
    VALUES('conversation','office','user','Private title','[]',?,?,?)`)
    .run(minutesAgo(45), iso(50), iso(50));
}

const queueNames: QueueHealthAlert['queue'][] = [
  'ai.documents', 'chat', 'google.edge', 'google.node', 'judicial', 'notifications.delivery',
  'notifications.projection', 'research', 'vault.indexing', 'vault.ingestion',
];

test('queue health returns no alerts for an empty database', async () => {
  const { db } = await postgresFixture();
  assert.deepEqual(await inspectQueueHealth(db, now), []);
});

test('queue health detects abandoned work across queues and returns aggregates without private content', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare(`INSERT INTO ai_run(id,office_id,user_id,kind,input,created_at,updated_at)
    VALUES('older-run','office','user','draft','another private prompt',?,?)`).run(iso(60), iso(60));
  assert.deepEqual(await inspectQueueHealth(db, now), queueNames.map(queue => ({
    queue, reason: 'stale', count: queue === 'ai.documents' ? 2 : 1,
    oldestAgeMinutes: queue === 'ai.documents' ? 60 : 45,
  })));
});

test('queue health ignores live leases, scheduled future work, and recently expired leases', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare("UPDATE vault_document SET status='processing',lease_expires_at=?").run(iso(-5));
  await db.prepare("UPDATE knowledge_index_job SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare("UPDATE google_job SET status='running',lease_until=?").run(iso(-5));
  await db.prepare("UPDATE research_job SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare("UPDATE judicial_sync_job SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare("UPDATE notification_event SET projection_state='leased',lease_until=?").run(iso(-5));
  await db.prepare("UPDATE notification_delivery SET state='leased',lease_until=?").run(iso(-5));
  await db.prepare("UPDATE ai_run SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare('UPDATE ai_conversation SET busy_until=?').run(minutesAgo(-5));
  assert.deepEqual(await inspectQueueHealth(db, now), []);

  await db.prepare("UPDATE google_job SET status='queued',lease_until=NULL,run_after=?").run(iso(-60));
  await db.prepare("UPDATE research_job SET status='queued',lease_until=0,run_after=?").run(minutesAgo(-60));
  await db.prepare("UPDATE judicial_sync_job SET status='queued',lease_until=0,run_after=?").run(minutesAgo(-60));
  await db.prepare("UPDATE notification_delivery SET state='retry',lease_until=NULL,next_attempt_at=?").run(iso(-60));
  assert.deepEqual(await inspectQueueHealth(db, now), []);

  await db.prepare('UPDATE vault_document SET lease_expires_at=?').run(iso(2));
  await db.prepare('UPDATE knowledge_index_job SET lease_until=?').run(minutesAgo(2));
  await db.prepare('UPDATE notification_event SET lease_until=?').run(iso(2));
  await db.prepare('UPDATE ai_run SET lease_until=?').run(minutesAgo(2));
  await db.prepare('UPDATE ai_conversation SET busy_until=?').run(minutesAgo(2));
  assert.deepEqual(await inspectQueueHealth(db, now), []);
});

test('queue health measures overdue work from its due time and renewed progress', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare('UPDATE vault_document SET updated_at=?').run(iso(1));
  await db.prepare('UPDATE knowledge_index_job SET updated_at=?').run(iso(1));
  await db.prepare('UPDATE google_job SET run_after=?').run(iso(1));
  await db.prepare('UPDATE research_job SET run_after=?').run(minutesAgo(1));
  await db.prepare('UPDATE judicial_sync_job SET run_after=?').run(minutesAgo(1));
  await db.prepare('UPDATE notification_delivery SET next_attempt_at=?').run(iso(1));
  await db.prepare('UPDATE notification_event SET created_at=?').run(iso(1));
  await db.prepare('UPDATE ai_run SET updated_at=?').run(iso(1));
  await db.exec('UPDATE ai_conversation SET busy_until=0');
  assert.deepEqual(await inspectQueueHealth(db, now), []);
  const atThreshold = now + 14 * 60_000;
  assert.deepEqual(await inspectQueueHealth(db, atThreshold), queueNames.filter(queue => queue !== 'chat').map(queue => ({
    queue, reason: 'stale', count: 1, oldestAgeMinutes: 15,
  })));
});

test('queue health reports recent terminal failures and stops paging historical failures', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare("UPDATE vault_document SET status='failed',error_message='private error',updated_at=?").run(iso(10));
  await db.prepare("UPDATE knowledge_index_job SET status='failed',error='private error',updated_at=?").run(iso(10));
  await db.prepare("UPDATE google_job SET status=CASE runtime WHEN 'edge' THEN 'dead' ELSE 'failed' END,updated_at=?").run(iso(10));
  await db.prepare("UPDATE research_job SET status='failed',updated_at=?").run(iso(10));
  await db.prepare("UPDATE judicial_sync_job SET status='quarantined',updated_at=?").run(iso(10));
  await db.exec("UPDATE notification_event SET projection_state='dead',last_error='private error'");
  await db.prepare('UPDATE notification_event SET projection_failed_at=?').run(iso(10));
  await db.prepare("UPDATE notification_delivery SET state='dead',updated_at=?").run(iso(10));
  await db.prepare("UPDATE ai_run SET status='failed',error='private error',updated_at=?").run(iso(10));
  await db.exec('UPDATE ai_conversation SET busy_until=0');
  assert.deepEqual(await inspectQueueHealth(db, now), queueNames.filter(queue => queue !== 'chat').map(queue => ({
    queue, reason: 'failed', count: 1, oldestAgeMinutes: 10,
  })));
  assert.deepEqual(await inspectQueueHealth(db, now + 25 * 60 * 60_000), []);
});

test('notification failure age starts when an old event exhausts retries and clears on recovery', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare("UPDATE notification_event SET created_at=?,projection_state='dead'").run(iso(48 * 60));
  const recorded = await db.prepare('SELECT projection_failed_at FROM notification_event').get<{ projection_failed_at: string }>();
  assert.ok(recorded?.projection_failed_at);
  const failureTime = Date.parse(recorded.projection_failed_at);
  assert.ok(failureTime > Date.parse(iso(48 * 60)));
  const failed = (await inspectQueueHealth(db, failureTime + 1_000)).find(item => item.queue === 'notifications.projection' && item.reason === 'failed');
  assert.equal(failed?.count, 1);
  assert.equal(failed?.oldestAgeMinutes, 0);
  await db.exec("UPDATE notification_event SET projection_state='projected'");
  assert.equal((await db.prepare('SELECT projection_failed_at FROM notification_event').get())?.projection_failed_at, null);
});

test('queue health ignores deleted, completed, cancelled, expired, and intentionally disabled work', async () => {
  const { db } = await postgresFixture();
  await seedQueues(db);
  await db.prepare('UPDATE vault_document SET deleted_at=?').run(iso(1));
  await db.exec(`
    UPDATE google_connection SET status='disconnected';
    UPDATE judicial_source_installation SET enabled=0;
    UPDATE research_job SET status='cancelled';
    INSERT INTO notification_rollout(office_id,capture_enabled) VALUES('office',0);
    UPDATE notification_delivery SET state='expired';
    UPDATE ai_run SET status='completed';
    UPDATE ai_conversation SET busy_until=0;
  `);
  assert.deepEqual(await inspectQueueHealth(db, now), []);
  await db.exec(`UPDATE google_job SET status='failed'; UPDATE judicial_sync_job SET status='quarantined';
    UPDATE notification_event SET projection_state='dead'`);
  await db.prepare('UPDATE notification_event SET projection_failed_at=?').run(iso(10));
  assert.deepEqual(await inspectQueueHealth(db, now), []);
  await db.prepare("UPDATE notification_delivery SET state='pending',expires_at=?").run(iso(1));
  await db.exec(`
    UPDATE google_connection SET status='active';
    UPDATE google_job SET status='cancelled';
    UPDATE knowledge_index_job SET status='completed';
    UPDATE judicial_source_installation SET enabled=1;
    UPDATE judicial_sync_job SET status='completed';
    UPDATE notification_rollout SET capture_enabled=1;
    UPDATE notification_event SET projection_state='projected';
  `);
  assert.deepEqual(await inspectQueueHealth(db, now), []);
});

const additionalQueues: QueueHealthAlert['queue'][] = ['artifacts.verification', 'personal.email', 'research.assessment', 'vault.deletion', 'whatsapp'];

async function seedAdditionalQueues(db: Database) {
  await seedQueues(db);
  await db.exec(`
    INSERT INTO whatsapp_connection(id,office_id,status) VALUES('whatsapp','office','connected');
    INSERT INTO whatsapp_job(id,office_id,connection_id,kind,dedupe_key,generation)
      VALUES('whatsapp-job','office','whatsapp','history','unique',1);
    INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content) VALUES('artifact','office','user','run','Fixture','Synthetic');
    INSERT INTO artifact_verification(id,office_id,user_id,artifact_id,artifact_version,content_hash,source_fingerprint,units,question_version,total)
      VALUES('verification','office','user','artifact',1,'hash','fingerprint','[]','v1',1);
    INSERT INTO vault_case(id,office_id,name,created_by) VALUES('case','office','Fixture','user');
    INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at)
      VALUES('judgment','source','remote','Fixture','Fixture','hash',CURRENT_TIMESTAMP);
    INSERT INTO research_material(id,judgment_id,kind) VALUES('material','judgment','full_text');
    INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,metadata_revision,collected_at)
      VALUES('material-version','material','hash','text/plain',10,'Synthetic','v1',1,CURRENT_TIMESTAMP);
    INSERT INTO research_case_assessment(id,office_id,case_id,material_version_id,requested_by,input_fingerprint,status,mode,question_version)
      VALUES('assessment','office','case','material-version','user','hash','queued','enabled','v1');
    INSERT INTO vault_deletion_queue(id,office_id,target_kind,target_ref) VALUES('deletion','office','object','fixture');
    INSERT INTO personal_thread(id,created_by) VALUES('thread','user');
    INSERT INTO personal_thread_invitation(id,thread_id,normalized_email,token_hash,encrypted_token,invited_by,expires_at)
      VALUES('invitation','thread','fixture@example.test','hash','encrypted','user',CURRENT_TIMESTAMP+INTERVAL '1 day');
    INSERT INTO personal_message(id,thread_id,sequence,sender_user_id,client_message_id,input_hash,body_kind,body_json)
      VALUES('message','thread',1,'user','message','hash','text','{}');
    INSERT INTO personal_email_outbox(id,message_id,thread_id,invitation_id,recipient_email,encrypted_action_token)
      VALUES('email','message','thread','invitation','fixture@example.test','encrypted');
  `);
  await db.prepare('UPDATE whatsapp_job SET updated_at=?,available_at=?').run(iso(45), iso(45));
  await db.prepare('UPDATE artifact_verification SET updated_at=?').run(iso(45));
  await db.prepare('UPDATE research_case_assessment SET updated_at=?').run(iso(45));
  await db.prepare('UPDATE vault_deletion_queue SET updated_at=?').run(iso(45));
  await db.prepare('UPDATE personal_email_outbox SET updated_at=?,next_attempt_at=?').run(iso(45), iso(45));
}

test('integration, verification, assessment and deletion queues respect progress and terminal outcomes', async () => {
  const { db } = await postgresFixture();
  await seedAdditionalQueues(db);
  const alerts = async (time = now) => (await inspectQueueHealth(db, time)).filter(row => additionalQueues.includes(row.queue));
  assert.deepEqual(await alerts(), additionalQueues.map(queue => ({ queue, reason: 'stale', count: 1, oldestAgeMinutes: 45 })));
  await db.prepare("UPDATE whatsapp_job SET status='running',locked_until=?").run(iso(-5));
  await db.prepare("UPDATE artifact_verification SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare("UPDATE research_case_assessment SET status='running',lease_until=?").run(minutesAgo(-5));
  await db.prepare('UPDATE vault_deletion_queue SET attempts=1').run();
  await db.prepare("UPDATE personal_email_outbox SET state='leased',lease_until=?").run(iso(-5));
  assert.deepEqual(await alerts(), []);
  await db.prepare("UPDATE whatsapp_job SET status='failed',updated_at=?").run(iso(10));
  await db.prepare("UPDATE artifact_verification SET status='incomplete',attempts=5,updated_at=?").run(iso(10));
  await db.prepare("UPDATE research_case_assessment SET status='unavailable',updated_at=?").run(iso(10));
  await db.exec('UPDATE vault_deletion_queue SET attempts=5');
  await db.prepare('UPDATE vault_deletion_queue SET updated_at=?').run(iso(10));
  await db.prepare("UPDATE personal_email_outbox SET state='unknown',updated_at=?").run(iso(10));
  assert.deepEqual(await alerts(), additionalQueues.map(queue => ({ queue, reason: 'failed', count: 1, oldestAgeMinutes: 10 })));
  assert.deepEqual(await alerts(now + 25 * 60 * 60_000), []);
  await db.exec(`UPDATE whatsapp_connection SET status='disconnected';
    UPDATE artifact_verification SET attempts=1; UPDATE research_case_assessment SET mode='off';
    UPDATE vault_deletion_queue SET completed_at=CURRENT_TIMESTAMP; UPDATE personal_email_outbox SET state='cancelled'`);
  assert.deepEqual(await alerts(), []);
});
