import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type OfficeRole = "administrator" | "lawyer" | "reviewer";
export type OfficeMembership = { officeId: string; officeName: string; role: OfficeRole };

// No unscoped office lookup is exposed. The caller supplies a verified session's user ID.
export function findOfficeForUser(db: DatabaseSync, userId: string, officeId?: string) {
  return db.prepare(`
    SELECT o.id AS officeId, o.name AS officeName, m.role
    FROM office o JOIN office_member m ON m.office_id = o.id
    WHERE m.user_id = ? AND (? IS NULL OR o.id = ?)
  `).get(userId, officeId ?? null, officeId ?? null) as OfficeMembership | undefined;
}

export function ensureOfficeForUser(db: DatabaseSync, user: { id: string; officeName: string }) {
  db.exec("SAVEPOINT provision_office");
  try {
    const existing = findOfficeForUser(db, user.id);
    if (!existing) {
      const officeId = randomUUID();
      db.prepare("INSERT INTO office (id, name) VALUES (?, ?)").run(officeId, user.officeName);
      db.prepare("INSERT INTO office_member (id, office_id, user_id, role) VALUES (?, ?, ?, 'administrator')")
        .run(randomUUID(), officeId, user.id);
    }
    db.exec("RELEASE provision_office");
  } catch (error) {
    db.exec("ROLLBACK TO provision_office; RELEASE provision_office");
    throw error;
  }
  return findOfficeForUser(db, user.id)!;
}
