import { mapContentResult } from '@/lib/content-result';
import 'server-only';
import { database, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { z } from 'zod';
import { documentTransaction } from '@/lib/documents/service';
import { personProfileText, projectProfile, profilePartsForSave, prepareResearchChange, consumedResearchResult, consumeResearchChange, type ProfileView } from './case-content';
import type { ResearchTextChange } from './case-content-contract';
import { caseAccess } from '@/lib/collaboration/access';

export const researchCaseProfileInput = personProfileText.extend({ caseId: z.uuid(), expectedVersion: z.number().int().nonnegative(),
  change: z.object({ kind: z.enum(['person','request','confirm']), generationAttemptId: z.uuid().optional() }).optional(), approvalId: z.uuid().optional() });
export type SaveResearchCaseProfileInput = z.input<typeof researchCaseProfileInput>;
export type ResearchCaseProfile = {
  caseId: string; version: number; legalQuestion: string; objective: string; thesis: string | null;
  documentedFacts: Array<{ text: string; documentIds: string[]; chunkIds: string[] }>;
  allegedFacts: string[]; gaps: string[]; documentIds: string[];
  updatedAt: string; updatedBy: string;
};

type ProfileRow = {
  case_id: string; version: number; legal_question: string; objective: string; thesis: string | null;
  documented_facts_json: string; alleged_facts_json: string; gaps_json: string; document_ids_json: string;
  updated_at: string; updated_by: string; content_parts: unknown;
};
const view = (row: ProfileRow): ResearchCaseProfile => ({
  caseId: row.case_id, version: row.version, legalQuestion: row.legal_question, objective: row.objective,
  thesis: row.thesis, documentedFacts: JSON.parse(row.documented_facts_json), allegedFacts: JSON.parse(row.alleged_facts_json),
  gaps: JSON.parse(row.gaps_json), documentIds: JSON.parse(row.document_ids_json), updatedAt: row.updated_at, updatedBy: row.updated_by,
});

/** Re-checks live membership, session and case ownership at every private case operation. */
export async function assertResearchCaseAccess(context: WorkspaceContext, caseId: string, db: Transaction = database) {
  context.signal?.throwIfAborted();
  if (context.sessionId && !await db.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>clock_timestamp()').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente.');
  if (context.caseScope) {
    const access = await caseAccess(context.userId, caseId, db);
    if (context.caseScope.caseId !== caseId || access.officeId !== context.officeId)
      throw new CapabilityError('FORBIDDEN', 'Seu acesso não permite esta operação.');
    return;
  }
  const member = await db.prepare('SELECT 1 FROM office_member WHERE user_id=? AND office_id=?').get(context.userId, context.officeId);
  if (!member) throw new CapabilityError('FORBIDDEN', 'Seu acesso a este escritório foi removido.');
  const owned = await db.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get(caseId, context.officeId);
  if (!owned) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
}

export async function getResearchCaseProfile(context: WorkspaceContext, caseId: string, db: Transaction = database): Promise<ProfileView | null> {
  await assertResearchCaseAccess(context, caseId, db);
  const row = await db.prepare('SELECT * FROM research_case_profile WHERE case_id=? AND office_id=?').get<ProfileRow>(caseId, context.officeId);
  if (!row) return null;
  const profile = view(row);
  return projectProfile(context, { caseId, version: profile.version, updatedAt: profile.updatedAt, updatedBy: profile.updatedBy }, profile, row.content_parts, db);
}

export async function saveResearchCaseProfile(context: WorkspaceContext, raw: SaveResearchCaseProfileInput, db: Transaction = database): Promise<ProfileView> {
  const command = raw as SaveResearchCaseProfileInput & { change?: ResearchTextChange };
  if (context.invocation && ['legalQuestion','objective','thesis','documentedFacts','allegedFacts','gaps'].some(field => field in command))
    throw new CapabilityError('FORBIDDEN', 'O texto compartilhado deve vir do pedido registrado.');
  const prepared = context.invocation ? await prepareResearchChange(context, 'k5_research_save_profile', { caseId: command.caseId, expectedVersion: command.expectedVersion },
    { kind: 'profile', caseId: command.caseId, expectedVersion: command.expectedVersion }, command.approvalId, command.change) : undefined;
  if (db === database) return documentTransaction(context, tx => saveProfileInTransaction(context, command, prepared, tx));
  return saveProfileInTransaction(context, command, prepared, db);
}

async function saveProfileInTransaction(context: WorkspaceContext, command: SaveResearchCaseProfileInput,
  prepared: Awaited<ReturnType<typeof prepareResearchChange>> | undefined, db: Transaction): Promise<ProfileView> {
  if (prepared) {
    const replay = await consumedResearchResult(context, prepared.approval, db);
    if (replay) return replay as ProfileView;
  }
  const raw = prepared ? { ...prepared.receipt.output, caseId: command.caseId, expectedVersion: command.expectedVersion } : command;
  const input = researchCaseProfileInput.parse(raw);
  await assertResearchCaseAccess(context, input.caseId, db);
  const currentRow = await db.prepare('SELECT * FROM research_case_profile WHERE case_id=? AND office_id=?').get<ProfileRow>(input.caseId,context.officeId);
  if ((currentRow?.version ?? 0) !== input.expectedVersion) throw new CapabilityError('CONFLICT', 'O perfil mudou. Reabra antes de salvar.');
  const contribution = await profilePartsForSave(context,input.caseId,input.expectedVersion,input,currentRow ? view(currentRow) : null,currentRow?.content_parts,
    prepared?.receipt.fieldPolicy,db);
  const merged = contribution.profile;
  const parts = contribution.parts;
  const ids = [...new Set(input.documentIds)];
  if (input.documentedFacts.some(fact => fact.documentIds.some(id => !ids.includes(id))))
    throw new CapabilityError('INVALID', 'Cada fato documentado precisa apontar documentos selecionados no perfil.');
  if (ids.length) {
    const found = await db.prepare(`SELECT id FROM vault_document WHERE office_id=? AND case_id=? AND deleted_at IS NULL AND lume_vault_visible(id, ?) AND id IN (${ids.map(() => '?').join(',')})`)
      .all<{ id: string }>(context.officeId, input.caseId, context.userId, ...ids);
    if (found.length !== ids.length) throw new CapabilityError('NOT_FOUND', 'Um documento do perfil não pertence a este caso.');
  }
  if (input.documentedFacts.length && !ids.length)
    throw new CapabilityError('INVALID', 'Associe ao menos um documento aos fatos documentados.');
  const chunkIds = [...new Set(input.documentedFacts.flatMap(fact => fact.chunkIds))];
  if (chunkIds.length) {
    const chunks = await db.prepare(`SELECT id,document_id FROM vault_document_chunk WHERE office_id=? AND id IN (${chunkIds.map(() => '?').join(',')})`)
      .all<{ id: string; document_id: string }>(context.officeId, ...chunkIds);
    if (chunks.length !== chunkIds.length || input.documentedFacts.some(fact => fact.chunkIds.some(id =>
      !chunks.some(chunk => chunk.id === id && fact.documentIds.includes(chunk.document_id)))))
      throw new CapabilityError('INVALID', 'Um trecho não pertence ao documento citado no fato.');
  }
  const thesis = merged.thesis?.trim() || null;
  const snapshot = { caseId: input.caseId, version: input.expectedVersion + 1, legalQuestion: merged.legalQuestion,
    objective: merged.objective, thesis, documentedFacts: merged.documentedFacts, allegedFacts: merged.allegedFacts,
    gaps: merged.gaps, documentIds: merged.documentIds };
  const values = [merged.legalQuestion, merged.objective, thesis, JSON.stringify(merged.documentedFacts),
    JSON.stringify(merged.allegedFacts), JSON.stringify(merged.gaps), JSON.stringify(merged.documentIds), JSON.stringify(parts)];
  let result;
  if (input.expectedVersion === 0) {
    result = await db.prepare(`INSERT INTO research_case_profile(case_id,office_id,legal_question,objective,thesis,documented_facts_json,alleged_facts_json,gaps_json,document_ids_json,content_parts,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?::jsonb,?) ON CONFLICT(case_id) DO NOTHING`).run(input.caseId, context.officeId, ...values, context.userId);
    await db.prepare(`INSERT INTO research_case_profile_revision(case_id,office_id,version,snapshot_json,content_parts,reviewed_by)
        SELECT case_id,office_id,version,?,content_parts,updated_by FROM research_case_profile WHERE case_id=? AND office_id=? AND version=1 AND updated_by=? ON CONFLICT DO NOTHING`)
        .run(JSON.stringify(snapshot), input.caseId, context.officeId, context.userId);
  } else {
    result = await db.prepare(`UPDATE research_case_profile SET legal_question=?,objective=?,thesis=?,documented_facts_json=?,alleged_facts_json=?,gaps_json=?,document_ids_json=?,
        content_parts=?::jsonb,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND version=?`)
        .run(...values, context.userId, input.caseId, context.officeId, input.expectedVersion);
    await db.prepare(`INSERT INTO research_case_profile_revision(case_id,office_id,version,snapshot_json,content_parts,reviewed_by)
        SELECT case_id,office_id,version,?,content_parts,updated_by FROM research_case_profile WHERE case_id=? AND office_id=? AND version=? AND updated_by=? ON CONFLICT DO NOTHING`)
        .run(JSON.stringify(snapshot), input.caseId, context.officeId, input.expectedVersion + 1, context.userId);
  }
  if (!result.changes) throw new CapabilityError('CONFLICT', 'O perfil mudou. Atualize antes de salvar.');
  const saved = (await getResearchCaseProfile(context, input.caseId, db))!;
  if (prepared) await consumeResearchChange(prepared.approval, saved, db);
  return saved;
}

export async function researchCaseSnapshot(context: WorkspaceContext, caseId: string, db: Transaction = database) {
  const { officeId, userId } = context;
  const caseRow = await db.prepare('SELECT id,name,description,updated_at,deleted_at FROM vault_case WHERE id=? AND office_id=?')
    .get<{ id: string; name: string; description: string | null; updated_at: string; deleted_at: string | null }>(caseId, officeId);
  const row = await db.prepare('SELECT * FROM research_case_profile WHERE case_id=? AND office_id=?').get<ProfileRow>(caseId, officeId);
  if (!caseRow || caseRow.deleted_at) return null;
  const projected = row ? await projectProfile(context, { caseId, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by }, view(row), row.content_parts, db) : null;
  const profile = projected?.kind === 'complete' ? mapContentResult({caseId:projected.caseId,version:projected.version,legalQuestion:projected.legalQuestion,objective:projected.objective,thesis:projected.thesis,documentedFacts:projected.documentedFacts,allegedFacts:projected.allegedFacts,gaps:projected.gaps,documentIds:projected.documentIds,updatedAt:projected.updatedAt,updatedBy:projected.updatedBy}, projected) : null;
  const docs = profile?.documentIds.length ? await db.prepare(`SELECT id,sha256,status,updated_at,deleted_at FROM vault_document WHERE office_id=? AND case_id=? AND lume_vault_visible(id, ?) AND id IN (${profile.documentIds.map(() => '?').join(',')})`)
    .all<{ id: string; sha256: string; status: string; updated_at: string; deleted_at: string | null }>(officeId, caseId, userId, ...profile.documentIds) : [];
  return { caseRow, profile, docs, restricted: projected?.kind === 'restricted' };
}
