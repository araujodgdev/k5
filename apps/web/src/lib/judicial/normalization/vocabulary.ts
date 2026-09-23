import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/database';

/**
 * National vocabulary (TPU/SGT) — A5 of docs/Refinos-MVP/plano-conectores-tribunais.md.
 *
 * Three rules, each one an acceptance criterion:
 * - A version is immutable. Re-importing it is inert; importing different content under the same
 *   version is refused, whole, so the catalog never changes in silence.
 * - Nothing here writes to `judicial_movement`. History stays as it was ingested; a label is
 *   resolved when read.
 * - Resolution is by exact code only. There is no lookup by label and no fuzzy strategy, so two
 *   codes with similar descriptions can never be unified.
 */

export const vocabularyKinds = ['class', 'subject', 'movement'] as const;
export type VocabularyKind = (typeof vocabularyKinds)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The import format. ponytail: Lume's own JSON shape; the official SGT distribution needs a
 * converter into it once the dump is in hand (Onda 0).
 */
export const vocabularyFileSchema = z.object({
  terms: z.array(z.object({
    kind: z.enum(vocabularyKinds),
    code: z.string().trim().min(1).max(20),
    label: z.string().trim().min(1).max(500),
    parentCode: z.string().trim().min(1).max(20).nullish(),
    validFrom: isoDate.nullish(),
    validTo: isoDate.nullish(),
  })).min(1),
}).superRefine((file, ctx) => {
  const seen = new Set<string>();
  file.terms.forEach((term, index) => {
    const key = `${term.kind}:${term.code}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['terms', index, 'code'], message: `Código repetido na mesma versão: ${key}` });
    seen.add(key);
  });
});
export type VocabularyFile = z.infer<typeof vocabularyFileSchema>;

export type ImportOutcome =
  | { ok: true; version: string; inserted: number; unchanged: number }
  | { ok: false; version: string; conflicts: string[] };

type TermRow = { kind: string; code: string; label: string; parent_code: string | null; valid_from: string | null; valid_to: string | null };

export async function importVocabulary(file: VocabularyFile, version: string): Promise<ImportOutcome> {
  const existing = new Map(
    (await database.prepare('SELECT kind, code, label, parent_code, valid_from, valid_to FROM judicial_vocabulary_term WHERE version = ?')
      .all<TermRow>(version)).map((row) => [`${row.kind}:${row.code}`, row]),
  );

  if (existing.size) {
    // A version already in the catalog must come back identical: a changed, added or missing term
    // under the same version would be the catalog changing in silence.
    const keys = new Set(file.terms.map((term) => `${term.kind}:${term.code}`));
    const conflicts = [
      ...file.terms.filter((term) => {
        const row = existing.get(`${term.kind}:${term.code}`);
        return !row || row.label !== term.label || row.parent_code !== (term.parentCode ?? null)
          || row.valid_from !== (term.validFrom ?? null) || row.valid_to !== (term.validTo ?? null);
      }).map((term) => `${term.kind}:${term.code}`),
      ...[...existing.keys()].filter((key) => !keys.has(key)),
    ];
    return conflicts.length
      ? { ok: false, version, conflicts }
      : { ok: true, version, inserted: 0, unchanged: file.terms.length };
  }

  // One batch: a version lands whole or not at all.
  await database.batch(file.terms.map((term) => database.prepare(`
    INSERT INTO judicial_vocabulary_term (id, kind, code, label, parent_code, valid_from, valid_to, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(randomUUID(), term.kind, term.code, term.label, term.parentCode ?? null, term.validFrom ?? null, term.validTo ?? null, version)));
  return { ok: true, version, inserted: file.terms.length, unchanged: 0 };
}

/**
 * The most recently imported version. ponytail: insertion order via rowid, which is exactly
 * "the last catalog someone imported"; add an explicit `current` marker if versions ever need to
 * be rolled back.
 */
export async function currentVocabularyVersion(): Promise<string | null> {
  return (await database.prepare('SELECT version FROM judicial_vocabulary_term ORDER BY rowid DESC LIMIT 1')
    .get<{ version: string }>())?.version ?? null;
}

export type ResolvedTerm = { code: string; label: string; source: 'catalog_exact' };

/**
 * Exact code, in the given version or — without one — the current version first and then the
 * latest version that still had the code, so a term the catalog later dropped still names the
 * historical events that used it. Never anything but `catalog_exact`.
 */
export async function resolveTpu(kind: VocabularyKind, code: string | null, version?: string): Promise<ResolvedTerm | null> {
  if (!code) return null;
  const row = version
    ? await database.prepare('SELECT code, label FROM judicial_vocabulary_term WHERE kind = ? AND code = ? AND version = ?')
      .get<{ code: string; label: string }>(kind, code, version)
    : await database.prepare(`
        SELECT code, label FROM judicial_vocabulary_term WHERE kind = ? AND code = ?
        ORDER BY (version = ?) DESC, rowid DESC LIMIT 1
      `).get<{ code: string; label: string }>(kind, code, await currentVocabularyVersion());
  return row ? { code: row.code, label: row.label, source: 'catalog_exact' } : null;
}

/**
 * Terms a person may pick as a filter today: the current version, still in force. An expired term
 * keeps naming history through `resolveTpu`, but is not offered for new queries.
 */
export async function listCurrentTerms(kind: VocabularyKind, today = new Date().toISOString().slice(0, 10)) {
  const version = await currentVocabularyVersion();
  if (!version) return [];
  return await database.prepare(`
    SELECT code, label, parent_code FROM judicial_vocabulary_term
    WHERE kind = ? AND version = ? AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)
    ORDER BY label
  `).all<{ code: string; label: string; parent_code: string | null }>(kind, version, today, today);
}

export async function describeTerm(kind: VocabularyKind, code: string) {
  return await database.prepare(`
    SELECT version, label, parent_code, valid_from, valid_to FROM judicial_vocabulary_term
    WHERE kind = ? AND code = ? ORDER BY rowid
  `).all<{ version: string; label: string; parent_code: string | null; valid_from: string | null; valid_to: string | null }>(kind, code);
}
