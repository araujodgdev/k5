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
      db.prepare("INSERT INTO office (id, name) VALUES (?, ?)").bind(officeId, user.officeName),
      db.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, 'administrator')")
        .bind(randomUUID(), officeId, user.id),
    ]);
  } catch {
    // Two concurrent sign-ins can both read "no office". `office_member` is UNIQUE per user, so
    // the loser's batch rolls back whole and the winner's row is the one to read back below.
  }

  const provisioned = await findOfficeForUser(db, user.id);
  if (!provisioned) throw new Error("Não foi possível provisionar o escritório deste usuário.");
  return provisioned;
}
