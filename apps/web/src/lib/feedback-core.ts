import 'server-only';
import { randomUUID } from 'node:crypto';
import { activeCampaign as pilot, feedbackPair, feedbackCampaigns } from './feedback-campaigns';
import type { Database } from './database';
import { feedbackSchema, type Assessment, type FeedbackSide, type FeedbackView, type FeedbackInput } from './feedback-contract';
import { assertPlatformAdmin, isPlatformAdmin, PlatformRequestError } from './platform-core';

export type FeedbackContext = { officeId: string; userId: string };
type FeedbackRow = {
  id: string; campaign_id: string; office_id: string; user_id: string; model_a: string; model_b: string;
  preference: FeedbackInput['preference']; preferred_model: string | null;
  assessment_a: string; assessment_b: string; comment: string; created_at: string;
};

async function assertMember(db: Database, context: FeedbackContext) {
  const member = await db.prepare('SELECT role FROM office_member WHERE office_id = ? AND user_id = ?').get<{ role: string }>(context.officeId, context.userId);
  // All office roles may evaluate their own feedback, including reviewers. This grants no business writes.
  if (!member || !['administrator', 'lawyer', 'reviewer'].includes(member.role)) throw new PlatformRequestError(403, 'Seu acesso ao escritório não está disponível.');
}

function ordered(context: FeedbackContext) {
  const seed = JSON.stringify([pilot.id, context.officeId, context.userId]);
  return feedbackPair(pilot.results, seed);
}

async function ownVote(db: Database, context: FeedbackContext) {
  return db.prepare('SELECT * FROM model_feedback WHERE campaign_id = ? AND office_id = ? AND user_id = ?')
    .get<FeedbackRow>(pilot.id, context.officeId, context.userId);
}

export async function feedbackView(db: Database, context: FeedbackContext): Promise<FeedbackView> {
  await assertMember(db, context);
  const row = await ownVote(db, context);
  const results = ordered(context);
  return {
    campaignId: pilot.id, title: pilot.title, instructions: pilot.instructions,
    responses: results.map((result, index) => ({
      side: index === 0 ? 'a' : 'b', memo: result.memo, sheets: result.sheets,
      identity: row ? { name: result.name, seconds: result.metrics.wall_clock_seconds, turns: result.metrics.turn_count,
        inputTokens: result.metrics.input_tokens, outputTokens: result.metrics.output_tokens } : null,
    })),
    vote: row ? { preference: row.preference, a: JSON.parse(row.assessment_a), b: JSON.parse(row.assessment_b), comment: row.comment, createdAt: row.created_at } : null,
  };
}

export async function submitFeedback(db: Database, context: FeedbackContext, input: unknown) {
  await assertMember(db, context);
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) throw new PlatformRequestError(400, 'Confira a preferência, as notas e os comentários.');
  const data = parsed.data;
  if (data.campaignId !== pilot.id) throw new PlatformRequestError(409, 'Esta avaliação mudou. Recarregue a página.');
  const [a, b] = ordered(context);
  const priorExposure = await isPlatformAdmin(db, context.userId) || await db.prepare('SELECT 1 FROM model_feedback WHERE user_id = ? AND campaign_id <> ? LIMIT 1').get(context.userId, pilot.id);
  // Immutable after reveal. Concurrent retries never replace the first blind vote.
  const result = await db.prepare(`INSERT INTO model_feedback
    (id, campaign_id, office_id, user_id, model_a, model_b, preference, preferred_model, assessment_a, assessment_b, comment, training_consent, prior_exposure, training_consent_purpose, training_consent_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, office_id, user_id) DO NOTHING`).run(
    randomUUID(), pilot.id, context.officeId, context.userId, a.key, b.key, data.preference,
    data.preference === 'a' ? a.key : data.preference === 'b' ? b.key : null,
    JSON.stringify(data.a), JSON.stringify(data.b), data.comment, data.trainingConsent ? 1 : 0, priorExposure ? 1 : 0,
    'prepare_ai_training_data', 1,
  );
  return { saved: result.changes > 0, view: await feedbackView(db, context) };
}

export async function feedbackFile(db: Database, context: FeedbackContext, side: string, kind: string, campaignId = pilot.id) {
  await assertMember(db, context);
  if (campaignId !== pilot.id) throw new PlatformRequestError(409, 'Esta avaliação mudou. Recarregue a página para baixar os arquivos desta rodada.');
  if (side === 'sources' && kind === 'zip') return { bytes: Buffer.from(pilot.sourceFiles, 'base64'), filename: 'documentos-de-origem.zip', contentType: 'application/zip' };
  if (!['a', 'b'].includes(side) || !['memo', 'tracker'].includes(kind)) throw new PlatformRequestError(404, 'Arquivo não encontrado.');
  const result = ordered(context)[side === 'a' ? 0 : 1];
  const file = result.files[kind as 'memo' | 'tracker'];
  return { bytes: Buffer.from(file.base64, 'base64'), filename: `resposta-${side}-${kind === 'memo' ? 'memorando.docx' : 'riscos.xlsx'}`,
    contentType: kind === 'memo' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

export async function platformFeedback(db: Database, userId: string, campaignId = pilot.id) {
  await assertPlatformAdmin(db, userId);
  const campaign = feedbackCampaigns.find(c => c.id === campaignId);
  if (!campaign) throw new PlatformRequestError(404, 'Rodada não encontrada.');
  const rows = await db.prepare(`SELECT f.*, u.name AS user_name, o.name AS office_name
    FROM model_feedback f JOIN user u ON u.id = f.user_id JOIN office o ON o.id = f.office_id
    WHERE f.campaign_id = ? ORDER BY f.created_at DESC, f.id`).all<FeedbackRow & { user_name: string; office_name: string }>(campaign.id);
  return { campaignId: campaign.id, title: campaign.title, models: campaign.results.map(({ key, name }) => ({ key, name })),
    votes: rows.map(row => ({ id: row.id, userId: row.user_id, officeId: row.office_id, userName: row.user_name, officeName: row.office_name,
      preference: row.preference, preferredModel: row.preferred_model, comment: row.comment, createdAt: row.created_at,
      assessments: ([['a', row.model_a, row.assessment_a], ['b', row.model_b, row.assessment_b]] as const)
        .map(([side, model, assessment]) => ({ side: side as FeedbackSide, model, ...JSON.parse(assessment) as Assessment })),
    })) };
}
