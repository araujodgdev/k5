import 'server-only';
import { createHash } from 'node:crypto';
import provenance from '@/data/feedback-provenance.json';
import { feedbackCampaigns } from './feedback-campaigns';
import type { Database } from './database';
import type { Assessment, FeedbackInput } from './feedback-contract';
import { ratingCriteria } from './feedback-contract';
import { assertPlatformAdmin } from './platform-core';

type AnnotationRow = {
  id: string; campaign_id: string; user_id: string; model_a: string; model_b: string;
  preference: FeedbackInput['preference']; assessment_a: string; assessment_b: string;
  comment: string; created_at: string; rubric_version: string; prior_exposure: number;
};
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const artifactId = (r: { files: { memo: { sha256: string }; tracker: { sha256: string } } }) => sha256(JSON.stringify([r.files.memo.sha256, r.files.tracker.sha256]));
export function trainingEligibility(model: string) {
  return model === 'deepseek'
    ? { status: 'pending_review', reason: 'Revisar direitos das fontes, privacidade e destino do treinamento.' }
    : { status: 'evaluation_only', reason: 'Revisar restrições contratuais do provedor e eventual autorização para o destino do treinamento.' };
}

// Evaluation archive, deliberately not a trainer-ready JSONL. Artifacts are file-based
// tasks, not full agent trajectories. Neither a vote nor consent approves an SFT target.
export async function feedbackDataset(db: Database, userId: string) {
  await assertPlatformAdmin(db, userId);
  const rows = await db.prepare('SELECT * FROM model_feedback WHERE training_consent = 1 ORDER BY created_at, id').all<AnnotationRow>();
  const annotations = rows.flatMap(row => {
    const campaign = feedbackCampaigns.find(c => c.id === row.campaign_id);
    if (!campaign) return [];
    const a = campaign.results.find(r => r.key === row.model_a), b = campaign.results.find(r => r.key === row.model_b);
    if (!a || !b) return [];
    const decisive = row.preference === 'a' || row.preference === 'b';
    const chosen = row.preference === 'a' ? a : b;
    const rejected = row.preference === 'a' ? b : a;
    return [{
      id: row.id, campaignId: row.campaign_id,
      annotator: sha256(`feedback-annotator-v1:${row.user_id}`),
      createdAt: row.created_at, rubricVersion: row.rubric_version,
      consent: { purpose: 'prepare_ai_training_data', version: 1 },
      protocol: { assignment: 'stable_pair_and_order', identitiesHiddenUntilVote: true, priorExposure: Boolean(row.prior_exposure) },
      presented: { a: artifactId(a), b: artifactId(b) },
      preference: row.preference,
      assessments: { a: JSON.parse(row.assessment_a) as Assessment, b: JSON.parse(row.assessment_b) as Assessment },
      comment: row.comment,
      preferenceCandidate: decisive ? {
        chosen: artifactId(chosen), rejected: artifactId(rejected),
        status: 'pending_review', trainingReady: false,
        reasons: [trainingEligibility(chosen.key), trainingEligibility(rejected.key),
          ...(row.prior_exposure ? [{ status: 'prior_exposure', reason: 'Pode ter visto a identidade dos modelos antes da avaliação.' }] : [])],
      } : null,
    }];
  });
  return {
    schemaVersion: 'k5.feedback-dataset.v1', purpose: 'evaluation_and_curation', exportedAt: new Date().toISOString(),
    trainingReady: false,
    rubric: { version: 'legal-artifacts-v1', criteria: ratingCriteria, minimum: 1, maximum: 5, missing: null },
    notes: 'Votos não aprovam respostas para SFT. Revise conteúdo, direitos e dados pessoais. Não separar votos da mesma tarefa entre treino e teste. Comentários livres podem conter dados pessoais; pseudônimos não tornam o arquivo anônimo.',
    campaigns: feedbackCampaigns.map(c => ({
      id: c.id, task: c.task, commit: c.commit, prompt: c.instructions,
      splitGroup: c.task, split: 'unassigned',
      sources: { format: 'zip_base64', sha256: sha256(Buffer.from(c.sourceFiles, 'base64')), content: c.sourceFiles },
      candidates: c.results.map(r => ({
        id: artifactId(r), model: r.key, name: r.name, metrics: r.metrics,
        preview: { memo: r.memo, sheets: r.sheets }, artifacts: r.files,
        provenance: (provenance as Record<string, unknown>)[r.files.memo.sha256] ?? null,
        trainingEligibility: trainingEligibility(r.key),
        sft: { status: 'needs_expert_review', approvedCompletion: null },
      })),
    })),
    annotations,
    readyPreferenceExamples: [], readySftExamples: [],
  };
}
