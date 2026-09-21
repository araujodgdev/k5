import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { Degree } from '../contracts';

/**
 * Links between a Vault case and a proceeding. A case may hold several proceedings and a
 * proceeding may exist in several installations, so nothing here assumes a one-to-one shape and
 * nothing derives a proceeding number from the case name.
 */

export type CaseLink = {
  id: string;
  caseId: string;
  caseName: string;
  installationId: string;
  courtCode: string;
  courtName: string;
  cnjNumber: string | null;
  nativeNumber: string | null;
  degree: Degree;
  confirmation: 'confirmed' | 'pending_review' | 'rejected';
  status: 'active' | 'archived' | 'unlinked';
  createdAt: string;
};

type LinkRow = {
  id: string; case_id: string; case_name: string; installation_id: string;
  court_code: string; court_name: string; cnj_number: string | null; native_number: string | null;
  degree: string; confirmation: string; status: string; created_at: string;
};

const SELECT_LINK = `
  SELECT l.id, l.case_id, c.name AS case_name, l.installation_id,
         i.court_code, i.court_name, l.cnj_number, l.native_number,
         l.degree, l.confirmation, l.status, l.created_at
  FROM judicial_case_link l
  JOIN vault_case c ON c.id = l.case_id
  JOIN judicial_source_installation i ON i.id = l.installation_id
`;

function toLink(row: LinkRow): CaseLink {
  return {
    id: row.id,
    caseId: row.case_id,
    caseName: row.case_name,
    installationId: row.installation_id,
    courtCode: row.court_code,
    courtName: row.court_name,
    cnjNumber: row.cnj_number,
    nativeNumber: row.native_number,
    degree: row.degree as Degree,
    confirmation: row.confirmation as CaseLink['confirmation'],
    status: row.status as CaseLink['status'],
    createdAt: row.created_at,
  };
}

export async function findCaseLink(officeId: string, linkId: string): Promise<CaseLink | undefined> {
  const row = await database.prepare(`${SELECT_LINK} WHERE l.id = ? AND l.office_id = ?`).get(linkId, officeId) as LinkRow | undefined;
  return row ? toLink(row) : undefined;
}

export async function listCaseLinks(
  officeId: string,
  filter: { caseId?: string; activeOnly?: boolean; limit?: number; cursor?: string } = {},
): Promise<CaseLink[]> {
  const clauses = ['l.office_id = ?'];
  const params: (string | number | null)[] = [officeId];
  if (filter.caseId) { clauses.push('l.case_id = ?'); params.push(filter.caseId); }
  if (filter.activeOnly) clauses.push("l.status = 'active'");
  if (filter.cursor) {
    clauses.push(`(l.created_at, l.id) < (
      SELECT cursor_link.created_at, cursor_link.id
      FROM judicial_case_link cursor_link
      WHERE cursor_link.id = ? AND cursor_link.office_id = ?
    )`);
    params.push(filter.cursor, officeId);
  }
  // Callers may request one extra row to determine whether a bounded page has a continuation.
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 51));
  const rows = await database.prepare(
    `${SELECT_LINK} WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
  ).all(...params, limit) as LinkRow[];
  return rows.map(toLink);
}

/**
 * CNJ numbers of the proceedings a sweep may ask about. Only confirmed, active links: an
 * unreviewed guess must not become a query sent to a court on the office's behalf.
 */
export async function confirmedCnjNumbers(officeId: string, installationId: string): Promise<string[]> {
  const rows = await database.prepare(
    `SELECT DISTINCT cnj_number FROM judicial_case_link
     WHERE office_id = ? AND installation_id = ? AND status = 'active'
       AND confirmation = 'confirmed' AND cnj_number IS NOT NULL`,
  ).all(officeId, installationId) as Array<{ cnj_number: string }>;
  return rows.map((row) => row.cnj_number);
}

export type CreateLinkInput = {
  officeId: string;
  userId: string;
  caseId: string;
  installationId: string;
  cnjNumber: string | null;
  nativeNumber: string | null;
  degree: Degree;
  /** True only when a person confirmed this exact proceeding belongs to this case. */
  confirmed: boolean;
};

/**
 * Creates the link, or returns the existing one. Re-linking the same proceeding to the same case
 * is not an error and must not produce a second row; a link previously unlinked comes back active.
 */
export async function createCaseLink(input: CreateLinkInput): Promise<{ link: CaseLink; created: boolean }> {
  const existing = await database.prepare(
    `SELECT id, status FROM judicial_case_link
     WHERE office_id = ? AND case_id = ? AND installation_id = ?
       AND COALESCE(cnj_number, '') = ? AND COALESCE(native_number, '') = ?`,
  ).get(input.officeId, input.caseId, input.installationId, input.cnjNumber ?? '', input.nativeNumber ?? '') as
    { id: string; status: string } | undefined;

  if (existing) {
    if (existing.status !== 'active') {
      await database.prepare("UPDATE judicial_case_link SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
    }
    return { link: (await findCaseLink(input.officeId, existing.id))!, created: false };
  }

  const id = randomUUID();
  await database.prepare(`
    INSERT INTO judicial_case_link (
      id, office_id, case_id, installation_id, cnj_number, native_number, degree,
      confirmation, confirmed_by, confirmed_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.officeId, input.caseId, input.installationId, input.cnjNumber, input.nativeNumber, input.degree,
    input.confirmed ? 'confirmed' : 'pending_review',
    input.confirmed ? input.userId : null,
    input.confirmed ? new Date().toISOString() : null,
    input.userId,
  );
  return { link: (await findCaseLink(input.officeId, id))!, created: true };
}

export async function confirmCaseLink(officeId: string, linkId: string, userId: string, confirmation: 'confirmed' | 'rejected'): Promise<CaseLink | undefined> {
  await database.prepare(
    `UPDATE judicial_case_link
     SET confirmation = ?, confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND office_id = ?`,
  ).run(confirmation, userId, linkId, officeId);
  return findCaseLink(officeId, linkId);
}

/**
 * Unlinking stops future collection and hides the link, and deliberately leaves the publications
 * already collected in place: they are evidence of what a gazette actually published, and erasing
 * them because a link was corrected would destroy the record rather than fix it.
 */
export async function unlinkCase(officeId: string, linkId: string): Promise<boolean> {
  const result = await database.prepare(
    "UPDATE judicial_case_link SET status = 'unlinked', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ? AND status <> 'unlinked'",
  ).run(linkId, officeId);
  if (result.changes) {
    // Recurring collection is authorized by the link; withdrawing the link withdraws it.
    await database.prepare(
      "UPDATE judicial_subscription SET status = 'cancelled', suspended_reason = 'Vínculo removido', updated_at = CURRENT_TIMESTAMP WHERE office_id = ? AND link_id = ? AND status <> 'cancelled'",
    ).run(officeId, linkId);
    await database.prepare(
      "UPDATE judicial_sync_job SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE office_id = ? AND link_id = ? AND status IN ('queued','running')",
    ).run(officeId, linkId);
  }
  return result.changes > 0;
}
