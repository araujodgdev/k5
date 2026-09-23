import 'server-only';
import { database, type Database } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { z } from 'zod';

const uuid = z.uuid();
const factList = z.array(z.string().trim().min(2).max(1200)).max(40);
const documentedFact = z.object({ text: z.string().trim().min(2).max(1200), documentIds: z.array(uuid).min(1).max(12), chunkIds: z.array(uuid).max(20).default([]) });
export const researchCaseProfileInput = z.object({
  caseId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  legalQuestion: z.string().trim().min(5).max(1500),
  objective: z.string().trim().min(3).max(1500),
  thesis: z.string().trim().max(1500).nullable().optional(),
  documentedFacts: z.array(documentedFact).max(40),
  allegedFacts: factList,
  gaps: factList,
  documentIds: z.array(uuid).max(60),
});
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
  updated_at: string; updated_by: string;
};
const view = (row: ProfileRow): ResearchCaseProfile => ({
  caseId: row.case_id, version: row.version, legalQuestion: row.legal_question, objective: row.objective,
  thesis: row.thesis, documentedFacts: JSON.parse(row.documented_facts_json), allegedFacts: JSON.parse(row.alleged_facts_json),
  gaps: JSON.parse(row.gaps_json), documentIds: JSON.parse(row.document_ids_json), updatedAt: row.updated_at, updatedBy: row.updated_by,
});

/** Re-checks live membership, session and case ownership at every private case operation. */
export async function assertResearchCaseAccess(context: WorkspaceContext, caseId: string, write = false, db: Database = database) {
  if (context.sessionId && !await db.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>?').get(context.sessionId, context.userId, new Date().toISOString()))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada. Entre novamente.');
  const member = await db.prepare('SELECT role FROM office_member WHERE user_id=? AND office_id=?')
    .get<{ role: string }>(context.userId, context.officeId);
  if (!member || (write && member.role === 'reviewer')) throw new CapabilityError('FORBIDDEN', 'Seu papel permite apenas consultas.');
  const owned = await db.prepare('SELECT id FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get(caseId, context.officeId);
  if (!owned) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
}

export async function getResearchCaseProfile(context: WorkspaceContext, caseId: string, db: Database = database): Promise<ResearchCaseProfile | null> {
  await assertResearchCaseAccess(context, caseId, false, db);
  const row = await db.prepare('SELECT * FROM research_case_profile WHERE case_id=? AND office_id=?').get<ProfileRow>(caseId, context.officeId);
  return row ? view(row) : null;
}

export async function saveResearchCaseProfile(context: WorkspaceContext, raw: SaveResearchCaseProfileInput, db: Database = database): Promise<ResearchCaseProfile> {
  const input = researchCaseProfileInput.parse(raw);
  await assertResearchCaseAccess(context, input.caseId, true, db);
  const ids = [...new Set(input.documentIds)];
  if (input.documentedFacts.some(fact => fact.documentIds.some(id => !ids.includes(id))))
    throw new CapabilityError('INVALID', 'Cada fato documentado precisa apontar documentos selecionados no perfil.');
  if (ids.length) {
    const found = await db.prepare(`SELECT id FROM vault_document WHERE office_id=? AND case_id=? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .all<{ id: string }>(context.officeId, input.caseId, ...ids);
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
  const thesis = input.thesis?.trim() || null;
  const snapshot = { caseId: input.caseId, version: input.expectedVersion + 1, legalQuestion: input.legalQuestion,
    objective: input.objective, thesis, documentedFacts: input.documentedFacts, allegedFacts: input.allegedFacts,
    gaps: input.gaps, documentIds: ids };
  const values = [input.legalQuestion, input.objective, thesis, JSON.stringify(input.documentedFacts),
    JSON.stringify(input.allegedFacts), JSON.stringify(input.gaps), JSON.stringify(ids)];
  let result;
  if (input.expectedVersion === 0) {
    [result] = await db.batch([
      db.prepare(`INSERT INTO research_case_profile(case_id,office_id,legal_question,objective,thesis,documented_facts_json,alleged_facts_json,gaps_json,document_ids_json,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(case_id) DO NOTHING`).bind(input.caseId, context.officeId, ...values, context.userId),
      db.prepare(`INSERT INTO research_case_profile_revision(case_id,office_id,version,snapshot_json,reviewed_by)
        SELECT case_id,office_id,version,?,updated_by FROM research_case_profile WHERE case_id=? AND office_id=? AND version=1 AND updated_by=? ON CONFLICT DO NOTHING`)
        .bind(JSON.stringify(snapshot), input.caseId, context.officeId, context.userId),
    ]);
  } else {
    [result] = await db.batch([
      db.prepare(`UPDATE research_case_profile SET legal_question=?,objective=?,thesis=?,documented_facts_json=?,alleged_facts_json=?,gaps_json=?,document_ids_json=?,
        version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE case_id=? AND office_id=? AND version=?`)
        .bind(...values, context.userId, input.caseId, context.officeId, input.expectedVersion),
      db.prepare(`INSERT INTO research_case_profile_revision(case_id,office_id,version,snapshot_json,reviewed_by)
        SELECT case_id,office_id,version,?,updated_by FROM research_case_profile WHERE case_id=? AND office_id=? AND version=? AND updated_by=? ON CONFLICT DO NOTHING`)
        .bind(JSON.stringify(snapshot), input.caseId, context.officeId, input.expectedVersion + 1, context.userId),
    ]);
  }
  if (!result.changes) throw new CapabilityError('CONFLICT', 'O perfil mudou. Atualize antes de salvar.');
  return (await getResearchCaseProfile(context, input.caseId, db))!;
}

export async function researchCaseSnapshot(officeId: string, caseId: string, db: Database = database) {
  const caseRow = await db.prepare('SELECT id,name,description,updated_at,deleted_at FROM vault_case WHERE id=? AND office_id=?')
    .get<{ id: string; name: string; description: string | null; updated_at: string; deleted_at: string | null }>(caseId, officeId);
  const row = await db.prepare('SELECT * FROM research_case_profile WHERE case_id=? AND office_id=?').get<ProfileRow>(caseId, officeId);
  if (!caseRow || caseRow.deleted_at) return null;
  const profile = row ? view(row) : null;
  const docs = profile?.documentIds.length ? await db.prepare(`SELECT id,sha256,status,updated_at,deleted_at FROM vault_document WHERE office_id=? AND case_id=? AND id IN (${profile.documentIds.map(() => '?').join(',')})`)
    .all<{ id: string; sha256: string; status: string; updated_at: string; deleted_at: string | null }>(officeId, caseId, ...profile.documentIds) : [];
  return { caseRow, profile, docs };
}
