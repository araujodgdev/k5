import { testDatabase as db, testDb } from './test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { feedbackFile, feedbackView, platformFeedback, submitFeedback } from '../src/lib/feedback-core';
import { assertSameOrigin } from '../src/lib/platform-core';
import pilot from '../src/data/feedback-pilot.json';
import { feedbackPair } from '../src/lib/feedback-campaigns';
import { feedbackDataset } from '../src/lib/feedback-dataset';

async function fixture(role = 'reviewer') {
  const userId = randomUUID(), officeId = randomUUID();
  (await testDb.prepare('INSERT INTO user (id,email,name) VALUES (?,?,?)').run(userId, `${userId}@test.local`, 'Pessoa'));
  (await testDb.prepare('INSERT INTO office (id,name) VALUES (?,?)').run(officeId, 'Escritório'));
  (await testDb.prepare('INSERT INTO office_member (id,office_id,user_id,role) VALUES (?,?,?,?)').run(randomUUID(), officeId, userId, role));
  return { userId, officeId };
}
const assessment = { clarity: 4, accuracy: null, completeness: 3, usefulness: 5, comment: 'Bem organizado.' };
const input = { campaignId: pilot.id, a: assessment, b: { ...assessment, comment: '' }, preference: 'a', comment: 'Mais prático.', reviewedBoth: true };

test('feedback hides names/metrics before voting, keeps order and allows reviewer personal feedback', async () => {
  const context = (await fixture());
  const before = await feedbackView(db, context);
  assert.ok(before.responses.every(response => response.identity === null));
  assert.doesNotMatch(JSON.stringify(before), /mercury|deepseek|inception|inputTokens|outputTokens/i);
  assert.deepEqual(await feedbackView(db, context), before);
  const { saved, view } = await submitFeedback(db, context, input);
  assert.equal(saved, true);
  assert.deepEqual(view.responses.map(r => r.memo), before.responses.map(r => r.memo));
  assert.ok(view.responses.every(r => r.identity?.inputTokens));
  assert.equal(view.vote?.a.accuracy, null);
  const admin = (await fixture('administrator'));
  await assert.rejects(platformFeedback(db, admin.userId), { status: 403 });
  (await testDb.prepare('INSERT INTO platform_admin (user_id) VALUES (?)').run(admin.userId));
  const row = (await platformFeedback(db, admin.userId)).votes.find(v => v.userId === context.userId)!;
  const preferred = pilot.results.find(r => r.name === view.responses[0].identity?.name)!;
  assert.equal(row.preferredModel, preferred.key);
  assert.equal(row.assessments.find(a => a.model === preferred.key)?.clarity, 4);
});

test('feedback concurrent duplicates preserve the first blind vote and never inflate counts', async () => {
  const context = (await fixture());
  const results = await Promise.all([submitFeedback(db, context, input), submitFeedback(db, context, { ...input, preference: 'b' })]);
  assert.equal(results.filter(r => r.saved).length, 1);
  const winner = results.find(r => r.saved)!.view.vote!;
  const retry = await submitFeedback(db, context, { ...input, comment: 'overwrite', preference: 'neither' });
  assert.equal(retry.saved, false);
  assert.deepEqual(retry.view.vote, winner);
  assert.equal(((await testDb.prepare('SELECT COUNT(*) AS n FROM model_feedback WHERE user_id=?').get(context.userId)) as { n: number }).n, 1);
});

test('feedback isolates offices/users and rejects revoked memberships and spoofed fields', async () => {
  const a = (await fixture()), b = (await fixture());
  await submitFeedback(db, a, input);
  assert.equal((await feedbackView(db, b)).vote, null);
  await assert.rejects(feedbackView(db, { userId: a.userId, officeId: b.officeId }), { status: 403 });
  for (const bad of [{ ...input, userId: a.userId }, { ...input, model_a: 'mercury' }, { ...input, reviewedBoth: false },
    { ...input, a: { ...assessment, clarity: 6 } }, { ...input, b: { ...assessment, usefulness: '5' } },
    { ...input, comment: 'x'.repeat(3001) }, { ...input, preference: 'invented' }]) {
    await assert.rejects(submitFeedback(db, b, bad), { status: 400 });
  }
  await assert.rejects(submitFeedback(db, b, { ...input, campaignId: 'old' }), { status: 409 });
  (await testDb.prepare('DELETE FROM office_member WHERE user_id = ?').run(a.userId));
  await assert.rejects(feedbackFile(db, a, 'a', 'memo'), { status: 403 });
  await assert.rejects(submitFeedback(db, a, input), { status: 403 });
});

test('feedback downloads match real artifacts, keep blind filenames and reject traversal', async () => {
  const context = (await fixture());
  const before = await feedbackView(db, context);
  for (const side of ['a', 'b'] as const) for (const kind of ['memo', 'tracker'] as const) {
    const file = await feedbackFile(db, context, side, kind);
    assert.match(file.filename, /^resposta-[ab]-/);
    const hash = createHash('sha256').update(file.bytes).digest('hex');
    assert.ok(pilot.results.some(r => r.files[kind].sha256 === hash && r.memo === before.responses[side === 'a' ? 0 : 1].memo));
  }
  assert.equal((await feedbackFile(db, context, 'sources', 'zip')).contentType, 'application/zip');
  await assert.rejects(feedbackFile(db, context, '../mercury', 'memo'), { status: 404 });
  await assert.rejects(feedbackFile(db, context, 'a', 'memo', 'old-round'), { status: 409 });
  await assert.rejects(feedbackFile(db, context, 'sources', 'zip', 'old-round'), { status: 409 });
  assert.throws(() => assertSameOrigin(new Request('https://k5.test/api/feedback', { headers: { origin: 'https://evil.test' } })), { status: 403 });
  assert.throws(() => assertSameOrigin(new Request('https://k5.test/api/feedback')), { status: 403 });
});

test('three-model allocation covers all pairs and both orders without showing a third response', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const pair = feedbackPair(['mercury', 'deepseek', 'meta'], `person-${i}`);
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0], pair[1]);
    assert.deepEqual(pair, feedbackPair(['mercury', 'deepseek', 'meta'], `person-${i}`));
    seen.add(pair.join(','));
  }
  assert.equal(seen.size, 6);
});

test('dataset export requires platform access and consent; preferences are not approved SFT examples', async () => {
  const admin = (await fixture()), optedIn = (await fixture()), legacy = (await fixture());
  await assert.rejects(feedbackDataset(db, admin.userId), { status: 403 });
  (await testDb.prepare('INSERT INTO platform_admin (user_id) VALUES (?)').run(admin.userId));
  await submitFeedback(db, legacy, input);
  await submitFeedback(db, optedIn, { ...input, trainingConsent: true });
  const dataset = await feedbackDataset(db, admin.userId);
  const rowId = ((await testDb.prepare('SELECT id FROM model_feedback WHERE user_id=?').get(optedIn.userId)) as { id: string }).id;
  const annotation = dataset.annotations.find(a => a.id === rowId)!;
  assert.ok(annotation.preferenceCandidate);
  assert.equal(annotation.preferenceCandidate.trainingReady, false);
  assert.equal(annotation.assessments.a.accuracy, null);
  assert.equal(annotation.protocol.priorExposure, false);
  assert.deepEqual(annotation.consent, { purpose: 'prepare_ai_training_data', version: 1 });
  assert.ok(!JSON.stringify(dataset).includes(optedIn.userId));
  assert.ok(!JSON.stringify(dataset).includes(optedIn.officeId));
  const legacyId = (await testDb.prepare('SELECT id FROM model_feedback WHERE user_id=?').get<{id:string}>(legacy.userId))!.id;
  assert.ok(!dataset.annotations.some(a => a.id === legacyId));
  assert.equal(dataset.trainingReady, false);
  assert.deepEqual(dataset.readySftExamples, []);
  const campaign = dataset.campaigns.find(c => c.id === pilot.id)!;
  assert.equal(campaign.splitGroup, pilot.task);
  assert.ok(campaign.candidates.every(c => c.sft.approvedCompletion === null && c.provenance));
  assert.equal(campaign.candidates.find(c => c.model === 'mercury')?.trainingEligibility.status, 'evaluation_only');
  assert.equal(campaign.candidates.find(c => c.model === 'deepseek')?.trainingEligibility.status, 'pending_review');
});

test('ties remain ties and prior-round exposure is recorded in the dataset', async () => {
  const admin = (await fixture()), context = (await fixture());
  (await testDb.prepare('INSERT INTO platform_admin (user_id) VALUES (?)').run(admin.userId));
  (await testDb.prepare(`INSERT INTO model_feedback (id,campaign_id,office_id,user_id,model_a,model_b,preference,assessment_a,assessment_b)
    VALUES (?,?,?,?,?,?,'tie',?,?)`).run(randomUUID(), 'earlier-round', context.officeId, context.userId, 'mercury', 'deepseek', JSON.stringify(assessment), JSON.stringify(assessment)));
  await submitFeedback(db, context, { ...input, preference: 'tie', trainingConsent: true });
  const rowId = ((await testDb.prepare('SELECT id FROM model_feedback WHERE user_id=? AND campaign_id=?').get(context.userId, pilot.id)) as { id: string }).id;
  const row = (await feedbackDataset(db, admin.userId)).annotations.find(a => a.id === rowId)!;
  assert.equal(row.preference, 'tie');
  assert.equal(row.preferenceCandidate, null);
  assert.equal(row.protocol.priorExposure, true);
});

test('consent metadata is stored at submission, preserved on retry and exported from the record', async () => {
  const admin = (await fixture()), context = (await fixture());
  (await testDb.prepare('INSERT INTO platform_admin (user_id) VALUES (?)').run(admin.userId));
  await submitFeedback(db, context, { ...input, trainingConsent: true });
  const stored = async () => (await testDb.prepare('SELECT id, training_consent, training_consent_purpose, training_consent_version FROM model_feedback WHERE user_id=?').get(context.userId))!;
  assert.equal((await stored()).training_consent_purpose, 'prepare_ai_training_data');
  assert.equal((await stored()).training_consent_version, 1);
  // Represent a record captured under different historical terms.
  (await testDb.prepare('UPDATE model_feedback SET training_consent_purpose=?, training_consent_version=? WHERE user_id=?').run('historical-purpose', 2, context.userId));
  const original = (await stored());
  assert.equal((await submitFeedback(db, context, { ...input, trainingConsent: false })).saved, false);
  assert.deepEqual((await stored()), original);
  const exported = async () => (await feedbackDataset(db, admin.userId)).annotations.find(a => a.id === original.id)!.consent;
  assert.deepEqual(await exported(), { purpose: 'historical-purpose', version: 2 });
  // Records predating metadata capture must not acquire fabricated terms on export.
  (await testDb.prepare('UPDATE model_feedback SET training_consent_purpose=NULL, training_consent_version=NULL WHERE user_id=?').run(context.userId));
  assert.deepEqual(await exported(), { purpose: null, version: null });
});
