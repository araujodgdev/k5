import 'server-only';
import { createHash } from 'node:crypto';
import { database, withTransaction } from './database';
import { ownedArtifact, type ArtifactRow, type Owner } from './ai-store';
import { storedCitationReview } from './citations/artifact-review';
import { citationLabel } from './citations/labels';
import { findCitationSpans } from './citations/detect';
import { CapabilityError } from './capabilities/errors';
import { humanReviewItem, type humanReviewInput, type HumanReviewItem } from './document-human-review-contract';
import { z } from 'zod';

async function checklist(artifact: ArtifactRow, owner: Owner): Promise<HumanReviewItem[]> {
  const issues = z.array(z.unknown()).parse(JSON.parse(artifact.validation_issues));
  const review = await storedCitationReview(owner, artifact.id);
  const citations = review?.artifactVersion === artifact.version ? review.items : findCitationSpans(artifact.content).map(span => ({ ...span, status: 'unchecked' as const, kind: null, confidence: null, source: null }));
  const items = [{ label: 'Conferir conteúdo e condições do documento', excerpt: 'Confira dados das partes, percentuais, aportes, valores, prazos, propostas de negociação e informações em aberto antes do uso.', automaticStatus: 'Decisão humana necessária' },
    ...citations.map(item => ({ label: item.text, excerpt: item.paragraph, automaticStatus: citationLabel(item), evidence: JSON.stringify(item.source) })),
    ...issues.map(issue => ({ label: typeof issue === 'string' ? issue : issue && typeof issue === 'object' && 'message' in issue && typeof issue.message === 'string' ? issue.message : JSON.stringify(issue) ?? 'Pendência de conteúdo', excerpt: '', automaticStatus: 'Pendência registrada pelo agente' }))];
  return [...new Map(items.map(item => {
    const key = createHash('sha256').update(JSON.stringify(item)).digest('hex');
    return [key, { key, label: item.label, excerpt: item.excerpt, automaticStatus: item.automaticStatus, decision: 'pending' as const, note: '', revision: 0, updatedAt: null }];
  })).values()];
}

export async function humanChecklist(owner: Owner, artifact: ArtifactRow) {
  const items = await checklist(artifact, owner);
  const saved = await database.prepare('SELECT item_key AS key,decision,note,revision,updated_at AS "updatedAt" FROM artifact_human_review WHERE artifact_id=? AND artifact_version=? AND user_id=?')
    .all<{ key: string; decision: string; note: string; revision: number; updatedAt: string }>(artifact.id, artifact.version, owner.userId);
  return { version: artifact.version, items: items.map(item => humanReviewItem.parse({ ...item, ...saved.find(row => row.key === item.key) })) };
}

export async function decideHumanReview(owner: Owner, artifact: ArtifactRow, input: z.infer<typeof humanReviewInput>) {
  const items = await checklist(artifact, owner);
  if (input.version !== artifact.version || !items.some(item => item.key === input.itemKey)) throw new CapabilityError('CONFLICT', 'A revisão mudou. Reabra a versão atual.');
  await withTransaction(async tx => {
    const current = await tx.prepare('SELECT version FROM ai_artifact WHERE id=? AND office_id=? AND user_id=? FOR UPDATE').get<{ version: number }>(artifact.id, owner.officeId, owner.userId);
    if (!current || current.version !== input.version) throw new CapabilityError('CONFLICT', 'O documento mudou. Salve e confira a versão atual.');
    const row = await tx.prepare('SELECT revision FROM artifact_human_review WHERE artifact_id=? AND artifact_version=? AND item_key=? FOR UPDATE').get<{ revision: number }>(artifact.id, input.version, input.itemKey);
    if ((row?.revision ?? 0) !== input.revision) throw new CapabilityError('CONFLICT', 'Este item foi alterado em outra aba. Atualize a revisão.');
    await tx.prepare(`INSERT INTO artifact_human_review(artifact_id,artifact_version,item_key,decision,note,user_id,revision) VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(artifact_id,artifact_version,item_key) DO UPDATE SET decision=excluded.decision,note=excluded.note,user_id=excluded.user_id,revision=artifact_human_review.revision+1,updated_at=CURRENT_TIMESTAMP`)
      .run(artifact.id, input.version, input.itemKey, input.decision, input.note, owner.userId);
  });
  const current = await ownedArtifact(database, owner, artifact.id);
  if (!current) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
  return humanChecklist(owner, current);
}
