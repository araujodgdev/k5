import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { imageMatchesType } from '@/lib/image-signature';
import { avatarMaxBytes, avatarTypes, avatarUrl, profileInput, type AvatarType, type ProfileCard, type ProfileInput } from './profile-contract';

type ProfileRow = { id: string; name: string; email: string; createdAt: string; headline: string | null; oab: string | null;
  location: string | null; bio: string | null; avatarVersion: string | null };

const cardSelect = `SELECT u.id,u.name,u.email,u."createdAt" AS "createdAt",p.headline,p.oab,p.location,p.bio,p.avatar_version AS "avatarVersion"
  FROM "user" u LEFT JOIN user_profile p ON p.user_id=u.id`;

function card(row: ProfileRow): ProfileCard {
  return { id: row.id, name: row.name, email: row.email, headline: row.headline ?? '', oab: row.oab ?? '', location: row.location ?? '',
    bio: row.bio ?? '', avatarUrl: avatarUrl(row.id, row.avatarVersion), memberSince: new Date(row.createdAt).toISOString() };
}

export async function ownProfile(userId: string): Promise<ProfileCard> {
  const row = await database.prepare(`${cardSelect} WHERE u.id=?`).get<ProfileRow>(userId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Conta não encontrada.');
  return card(row);
}

export async function updateProfile(userId: string, raw: unknown): Promise<ProfileCard> {
  const input: ProfileInput = profileInput.parse(raw);
  await withTransaction(async tx => {
    // Better Auth reads the name from its own table; the session is not cached, so it shows at once.
    await tx.prepare('UPDATE "user" SET name=?,"updatedAt"=CURRENT_TIMESTAMP WHERE id=?').run(input.name, userId);
    await tx.prepare(`INSERT INTO user_profile(user_id,headline,oab,location,bio) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET headline=excluded.headline,oab=excluded.oab,location=excluded.location,bio=excluded.bio,updated_at=CURRENT_TIMESTAMP`)
      .run(userId, input.headline, input.oab, input.location, input.bio);
  });
  return ownProfile(userId);
}

export async function setAvatar(userId: string, bytes: Buffer, type: string): Promise<ProfileCard> {
  if (!(avatarTypes as readonly string[]).includes(type)) throw new CapabilityError('INVALID', 'Envie uma foto em PNG, JPEG ou WebP.');
  if (!bytes.length || bytes.length > avatarMaxBytes) throw new CapabilityError('INVALID', 'A foto precisa ter até 512 KB.');
  if (!imageMatchesType(bytes, type)) throw new CapabilityError('INVALID', 'O arquivo não é uma imagem válida.');
  await database.prepare(`INSERT INTO user_profile(user_id,avatar,avatar_type,avatar_version) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET avatar=excluded.avatar,avatar_type=excluded.avatar_type,avatar_version=excluded.avatar_version,updated_at=CURRENT_TIMESTAMP`)
    .run(userId, bytes, type, randomUUID());
  return ownProfile(userId);
}

export async function removeAvatar(userId: string): Promise<ProfileCard> {
  await database.prepare('UPDATE user_profile SET avatar=NULL,avatar_type=NULL,avatar_version=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(userId);
  return ownProfile(userId);
}

export async function readAvatar(userId: string) {
  const row = await database.prepare('SELECT avatar,avatar_type AS type FROM user_profile WHERE user_id=? AND avatar IS NOT NULL')
    .get<{ avatar: Buffer; type: AvatarType }>(userId);
  return row ?? null;
}

const lookupWindowSeconds = 600;
const lookupLimit = 60;

/**
 * The card for an exact e-mail, or null when nobody uses it. Inviting already tells whether the
 * address has an account, so this reveals nothing new, but a person gets a bounded number of
 * lookups per window so the card cannot be used to sweep a list of addresses.
 */
export async function profileCardForEmail(viewerId: string, rawEmail: string): Promise<ProfileCard | null> {
  const email = z.email().max(254).parse(rawEmail.trim()).toLowerCase();
  const admitted = await database.prepare(`INSERT INTO profile_lookup_window(user_id,window_start,lookups) VALUES(?,CURRENT_TIMESTAMP,1)
    ON CONFLICT(user_id) DO UPDATE SET
      window_start=CASE WHEN profile_lookup_window.window_start<=CURRENT_TIMESTAMP-make_interval(secs=>?) THEN CURRENT_TIMESTAMP ELSE profile_lookup_window.window_start END,
      lookups=CASE WHEN profile_lookup_window.window_start<=CURRENT_TIMESTAMP-make_interval(secs=>?) THEN 1 ELSE profile_lookup_window.lookups+1 END
    RETURNING lookups`).get<{ lookups: number }>(viewerId, lookupWindowSeconds, lookupWindowSeconds);
  if (!admitted || admitted.lookups > lookupLimit) throw new CapabilityError('RATE_LIMITED', 'Muitas consultas seguidas. Aguarde alguns minutos.');
  const row = await database.prepare(`${cardSelect} WHERE lower(u.email)=?`).get<ProfileRow>(email);
  return row ? card(row) : null;
}
