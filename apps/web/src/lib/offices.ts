import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { CapabilityError } from './capabilities/errors';

/** Every lawyer owns exactly one office: the workspace their own data is scoped to. */
export type OfficeMembership = { officeId: string; officeName: string };

// No unscoped office lookup is exposed. The caller supplies a verified session's user ID.
export async function findOfficeForUser(db: Database, userId: string) {
  return await db.prepare(`
    SELECT o.id AS officeId, o.name AS officeName
    FROM office o JOIN office_member m ON m.office_id = o.id
    WHERE m.user_id = ?
  `).get(userId) as OfficeMembership | undefined;
}

export async function ensureOfficeForUser(db: Database, user: { id: string; officeName: string }): Promise<OfficeMembership> {
  const existing = await findOfficeForUser(db, user.id);
  if (existing) return existing;
  const account = await db.prepare('SELECT accountKind FROM "user" WHERE id=?').get<{ accountKind: string }>(user.id);
  if (account?.accountKind === 'client') throw new CapabilityError('FORBIDDEN', 'Esta conta tem acesso ao portal do cliente.');

  // The office and its owner are written together or not at all: an office with no owner cannot
  // be reached or repaired, and a membership pointing at no office is worse.
  try {
    const officeId = randomUUID();
    await db.batch([
      db.prepare('SELECT id FROM "user" WHERE id=? FOR UPDATE').bind(user.id),
      db.prepare("INSERT INTO office (id, name) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM office_member WHERE user_id=?)")
        .bind(officeId, user.officeName, user.id),
      db.prepare("INSERT INTO office_member (id, office_id, user_id) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM office WHERE id=?)")
        .bind(randomUUID(), officeId, user.id, officeId),
    ]);
  } catch {
    // Provisioning serializes on the user row; a concurrent request can already have succeeded.
  }

  const provisioned = await findOfficeForUser(db, user.id);
  if (!provisioned) throw new Error("Não foi possível provisionar o escritório deste usuário.");
  return provisioned;
}
