import { createHash } from 'node:crypto';
import type { NormalizedPublication } from '../contracts';

/**
 * Deduplication identities (section 6). Prefer the identity the source gave; fall back to a
 * deterministic print over documented stable fields, and record which strategy was used so a
 * collision is investigable instead of invisible.
 */

export type FingerprintStrategy = 'source_id' | 'stable_fields';

export type Fingerprint = { value: string; strategy: FingerprintStrategy };

function digest(parts: Array<string | null>): string {
  // NUL separates the fields so ["ab","c"] and ["a","bc"] cannot print the same.
  return createHash('sha256').update(parts.map((part) => part ?? '').join('\u0000')).digest('hex').slice(0, 40);
}

/** Collapses the whitespace a court portal varies between requests without changing the text. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A republication is a new row related to the old one, never an overwrite, so `revisionKind` is
 * part of the print: the errata and the original must not collapse into a single publication.
 */
export function publicationFingerprint(publication: NormalizedPublication): Fingerprint {
  if (publication.sourcePublicationId) {
    return {
      value: digest(['pub:id', publication.sourcePublicationId, publication.revisionKind]),
      strategy: 'source_id',
    };
  }
  // The official hash, when the court publishes one, is a stronger key than anything derived.
  if (publication.officialHash) {
    return {
      value: digest(['pub:hash', publication.officialHash, publication.revisionKind]),
      strategy: 'source_id',
    };
  }
  return {
    value: digest([
      'pub:fields',
      publication.cnjNumber,
      publication.madeAvailableOn,
      publication.publishedOn,
      publication.edition,
      publication.page,
      publication.revisionKind,
      normalizeText(publication.body),
    ]),
    strategy: 'stable_fields',
  };
}

/** Content hash of a raw payload, used to skip re-persisting a byte-identical snapshot. */
export function payloadHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Stable key for an outbox row. A replayed job produces the same key and the unique index turns
 * the second insert into a no-op, which is how retrying stays free of duplicate alerts.
 */
export function alertDedupeKey(eventKind: string, subjectKind: string, subjectId: string): string {
  return digest(['alert', eventKind, subjectKind, subjectId]);
}
