import type { Database } from './db/types';
import { ApiError } from './api-error';
import { LEGAL_VERSION } from './legal-version';

/** Raise it when the notice's substance changes; everyone then reads it again before using Lume. */
export const AI_NOTICE_VERSION = '1';

export type LegalDocumentKind = 'terms' | 'ai_notice';
export const legalDocumentKinds: readonly LegalDocumentKind[] = ['terms', 'ai_notice'];

/** The version a person has to accept now. Never taken from a request. */
export function currentLegalVersion(document: LegalDocumentKind) {
  return document === 'terms' ? LEGAL_VERSION : AI_NOTICE_VERSION;
}

export async function hasAcceptedCurrent(db: Database, userId: string, document: LegalDocumentKind) {
  return Boolean(await db.prepare('SELECT 1 FROM legal_acceptance WHERE user_id=? AND document=? AND version=?')
    .get(userId, document, currentLegalVersion(document)));
}

/** The API side of the terms gate: until the current terms are accepted, a signed-in person gets 403 instead of data. */
export async function assertTermsAccepted(db: Database, userId: string) {
  if (!await hasAcceptedCurrent(db, userId, 'terms')) throw new ApiError(403, 'Para continuar, aceite os Termos de uso e a Política de privacidade.');
}

/** Whether any version was accepted before: tells a first acceptance from an update. */
export async function hasAcceptedAny(db: Database, userId: string, document: LegalDocumentKind) {
  return Boolean(await db.prepare('SELECT 1 FROM legal_acceptance WHERE user_id=? AND document=? LIMIT 1').get(userId, document));
}

/**
 * Records that the person accepted the current version. The address is the one the edge vouches
 * for (`cf-connecting-ip` on Cloudflare); elsewhere it is not recorded rather than guessed.
 */
export async function recordAcceptance(db: Database, userId: string, document: LegalDocumentKind, headers?: Headers) {
  const ip = process.env.K5_RUNTIME === 'cloudflare' ? headers?.get('cf-connecting-ip')?.slice(0, 64) ?? null : null;
  const userAgent = headers?.get('user-agent')?.slice(0, 300) ?? null;
  await db.prepare(`INSERT INTO legal_acceptance(user_id,document,version,ip_address,user_agent) VALUES(?,?,?,?,?)
    ON CONFLICT (user_id,document,version) DO NOTHING`).run(userId, document, currentLegalVersion(document), ip, userAgent);
}
