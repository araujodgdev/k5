import { randomUUID } from "node:crypto";
import type { Database } from "./database";

export type OfficeRole = "administrator" | "lawyer" | "reviewer";
export type OfficeMembership = { officeId: string; officeName: string; role: OfficeRole };

// No unscoped office lookup is exposed. The caller supplies a verified session's user ID.
export async function findOfficeForUser(db: Database, userId: string, officeId?: string) {
  return await db.prepare(`
    SELECT o.id AS officeId, o.name AS officeName, m.role
    FROM office o JOIN office_member m ON m.office_id = o.id
    WHERE m.user_id = ? AND (?::text IS NULL OR o.id = ?)
    ORDER BY m.created_at, m.id LIMIT 1
  `).get(userId, officeId ?? null, officeId ?? null) as OfficeMembership | undefined;
}

export async function ensureOfficeForUser(db: Database, user: { id: string; officeName: string }): Promise<OfficeMembership> {
  const existing = await findOfficeForUser(db, user.id);
  if (existing) return existing;

  // The office and its first membership are written together or not at all: an office with no
  // administrator cannot be joined or repaired, and a membership pointing at no office is worse.
  try {
    const officeId = randomUUID();
    await db.batch([
      db.prepare('SELECT id FROM "user" WHERE id=? FOR UPDATE').bind(user.id),
      db.prepare("INSERT INTO office (id, name) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM office_member WHERE user_id=?)")
        .bind(officeId, user.officeName, user.id),
      db.prepare("INSERT INTO office_member (id, office_id, user_id, role) SELECT ?, ?, ?, 'administrator' WHERE EXISTS (SELECT 1 FROM office WHERE id=?)")
        .bind(randomUUID(), officeId, user.id, officeId),
    ]);
  } catch {
    // Provisioning serializes on the user row; a concurrent request can already have succeeded.
  }

  const provisioned = await findOfficeForUser(db, user.id);
  if (!provisioned) throw new Error("Não foi possível provisionar o escritório deste usuário.");
  return provisioned;
}

export const ACTIVE_OFFICE_COOKIE = 'k5-office';

export async function selectedOfficeForUser(db: Database, user: { id: string; officeName: string }, officeId?: string) {
  return (officeId ? await findOfficeForUser(db, user.id, officeId) : undefined) ?? ensureOfficeForUser(db, user);
}

export async function listOfficesForUser(db: Database, userId: string) {
  return db.prepare(`SELECT o.id AS officeId,o.name AS officeName,m.role FROM office_member m
    JOIN office o ON o.id=m.office_id WHERE m.user_id=? ORDER BY m.created_at,m.id`).all<OfficeMembership>(userId);
}
