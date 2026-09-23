import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import { objectStorage, storageKey } from '@/lib/storage';
import {
  ConnectorError, permits, precedentContentKinds,
  type InstallationRef, type PermissionDimension, type PrecedentContentKind, type SourcePermissions,
} from '@/lib/judicial/contracts';
import { connectorFor, currentTransport, type Transport } from '@/lib/judicial/connectors';

/**
 * Synchronizes one jurisprudence dataset into the shared collection (B1).
 *
 * Per resource: an unchanged declared checksum is not downloaded again; a changed one is
 * downloaded, kept as a new version next to the old one, and its documents are versioned the
 * same way. A run stops at `maxDownloads` and hands back a cursor, so the next run resumes where
 * this one stopped instead of starting over.
 *
 * ponytail: requests are capped per run and spaced by the installation's rate, but not charged
 * to `judicial_rate_budget`, which is keyed by office and this collection has none. Give the
 * ledger a platform scope before scheduling this unattended.
 */

export type SyncDatasetInput = {
  datasetId: string;
  contentKind: PrecedentContentKind;
  /** The `sourceResourceId` to resume from, as returned by a truncated run. */
  cursor?: string | null;
  maxDownloads?: number;
};

export type SyncOutcome = {
  resourcesListed: number;
  resourcesUnchanged: number;
  resourcesDownloaded: number;
  documentsInserted: number;
  documentsUnchanged: number;
  documentsRejected: number;
  truncated: boolean;
  cursor: string | null;
};

type LatestResource = { id: string; version: number; declared_checksum: string; sha256: string };

export async function syncDataset(
  installation: InstallationRef,
  input: SyncDatasetInput,
  options: { transport?: Transport; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SyncOutcome> {
  if (!installation.enabled || installation.purpose !== 'jurisprudence') {
    throw new ConnectorError('unsupported', 'Esta instalação não é um acervo de jurisprudência habilitado.');
  }
  if (!permits(installation.permissions, 'query') || !permits(installation.permissions, 'cache')) {
    throw new ConnectorError('human_action_required', 'A condição de uso desta fonte não autoriza consultar e armazenar o acervo.');
  }
  if (!precedentContentKinds.includes(input.contentKind)) throw new ConnectorError('unsupported', 'Tipo de conteúdo desconhecido.');

  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const spacing = Math.ceil(60_000 / installation.rateLimitPerMinute);
  const connector = connectorFor(installation, options.transport ?? currentTransport());
  if (!connector.listPrecedents || !connector.fetchPrecedent) {
    throw new ConnectorError('unsupported', 'Este conector não sincroniza acervos.');
  }

  const listing = await connector.listPrecedents(installation, { datasetId: input.datasetId });
  const resources = listing.items;
  const outcome: SyncOutcome = {
    resourcesListed: resources.length, resourcesUnchanged: 0, resourcesDownloaded: 0,
    documentsInserted: 0, documentsUnchanged: 0, documentsRejected: 0, truncated: false, cursor: null,
  };

  // Resume at the resource the previous run stopped on. An unknown cursor (the listing changed)
  // restarts the sweep, which is safe: unchanged resources are skipped without a download.
  const start = input.cursor ? Math.max(0, resources.findIndex((item) => item.sourceResourceId === input.cursor)) : 0;
  const maxDownloads = Math.max(1, input.maxDownloads ?? 20);

  for (const resource of resources.slice(start)) {
    const latest = await database.prepare(`
      SELECT id, version, declared_checksum, sha256 FROM jurisprudence_resource
      WHERE installation_id = ? AND source_resource_id = ? ORDER BY version DESC LIMIT 1
    `).get<LatestResource>(installation.id, resource.sourceResourceId);
    if (latest?.declared_checksum === resource.declaredChecksum) { outcome.resourcesUnchanged += 1; continue; }

    if (outcome.resourcesDownloaded >= maxDownloads) {
      outcome.truncated = true;
      outcome.cursor = resource.sourceResourceId;
      break;
    }
    await sleep(spacing);
    const fetched = await connector.fetchPrecedent(installation, { resource, contentKind: input.contentKind });
    outcome.resourcesDownloaded += 1;
    outcome.documentsRejected += fetched.coverage.rejected;

    // The declaration changed but the bytes did not: nothing new to keep, only the marker moves.
    if (latest?.sha256 === fetched.original.sha256) {
      await database.prepare('UPDATE jurisprudence_resource SET declared_checksum = ? WHERE id = ?').run(resource.declaredChecksum, latest.id);
      outcome.documentsUnchanged += fetched.items.length;
      continue;
    }

    const resourceId = randomUUID();
    const key = storageKey(installation.id, resourceId, extensionOf(resource.format, fetched.original.bytes));
    await (await objectStorage()).put(key, fetched.original.bytes);

    const statements = [database.prepare(`
      INSERT INTO jurisprudence_resource (
        id, installation_id, dataset_id, source_resource_id, name, url, format, content_kind,
        declared_checksum, sha256, byte_size, storage_key, license_title, license_url, attribution,
        version, supersedes_id, documents_count, rejected_count, parser_version, source_updated_at, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      resourceId, installation.id, resource.datasetId, resource.sourceResourceId, resource.name, resource.url, resource.format,
      input.contentKind, resource.declaredChecksum, fetched.original.sha256, fetched.original.bytes.length, key,
      resource.license?.title ?? null, resource.license?.url ?? null, resource.license?.attribution ?? null,
      (latest?.version ?? 0) + 1, latest?.id ?? null, fetched.items.length, fetched.coverage.rejected,
      fetched.source.parserVersion, resource.sourceUpdatedAt, fetched.source.collectedAt,
    )];

    const permissions = JSON.stringify(installation.permissions);
    for (const document of fetched.items) {
      const previous = await database.prepare(`
        SELECT id, version, checksum FROM jurisprudence_document
        WHERE installation_id = ? AND source_document_id = ? ORDER BY version DESC LIMIT 1
      `).get<{ id: string; version: number; checksum: string }>(installation.id, document.sourceDocumentId);
      if (previous?.checksum === document.checksum) { outcome.documentsUnchanged += 1; continue; }
      outcome.documentsInserted += 1;
      statements.push(database.prepare(`
        INSERT INTO jurisprudence_document (
          id, installation_id, resource_id, source_document_id, court, organ, content_kind, cnj_number, native_number,
          title, rapporteur, judged_on, published_on, headnote, full_text_ref, citation_label, checksum, version,
          supersedes_id, related_source_document_id, license_title, license_url, attribution, permissions,
          source_updated_at, collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        randomUUID(), installation.id, resourceId, document.sourceDocumentId, document.court, document.organ, document.contentKind,
        document.caseIdentity?.cnjNumber ?? null, document.caseIdentity?.nativeNumber ?? null,
        document.title, document.rapporteur, document.judgedOn, document.publishedOn, document.headnote, document.fullTextRef,
        document.citationLabel, document.checksum, (previous?.version ?? 0) + 1, previous?.id ?? null,
        document.relatedSourceDocumentId, document.license?.title ?? null, document.license?.url ?? null,
        document.license?.attribution ?? null, permissions, document.sourceUpdatedAt, fetched.source.collectedAt,
      ));
    }
    // A declared relation is resolved to the latest version of the document the source named, in
    // either arrival order. Nothing is related that the source did not relate.
    statements.push(database.prepare(`
      UPDATE jurisprudence_document SET related_document_id = (
        SELECT target.id FROM jurisprudence_document target
        WHERE target.installation_id = jurisprudence_document.installation_id
          AND target.source_document_id = jurisprudence_document.related_source_document_id
        ORDER BY target.version DESC LIMIT 1
      )
      WHERE installation_id = ? AND related_source_document_id IS NOT NULL AND related_document_id IS NULL
    `).bind(installation.id));
    // The resource row, its documents and the relations land together or not at all.
    await database.batch(statements);
  }

  return outcome;
}

function extensionOf(format: string | null, bytes: Buffer): string {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return 'zip';
  return (format ?? 'json').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
}

export type UsePolicy = { indexable: boolean; exportable: boolean; reasons: string[] };

/**
 * What a stored document may be used for. Storing is not permission to index or to hand out: an
 * undeclared license, or a source that did not clear AI use or redistribution, keeps the document
 * readable inside Lume and nothing more. B3 reads `indexable` before creating a chunk.
 */
export function documentUsePolicy(document: { license_title: string | null; permissions: string | SourcePermissions }): UsePolicy {
  const permissions: SourcePermissions = typeof document.permissions === 'string' ? JSON.parse(document.permissions) : document.permissions;
  const reasons: string[] = [];
  const denied = (dimension: PermissionDimension, reason: string) => {
    if (!permits(permissions, dimension)) reasons.push(reason);
    return !permits(permissions, dimension);
  };
  if (!document.license_title) reasons.push('Documento sem licença declarada pela fonte.');
  const noAi = denied('ai', 'A condição de uso da fonte não autoriza uso por IA.');
  const noRedistribution = denied('redistribution', 'A condição de uso da fonte não autoriza redistribuição.');
  return {
    indexable: Boolean(document.license_title) && !noAi,
    exportable: Boolean(document.license_title) && !noRedistribution,
    reasons,
  };
}

export class JurisprudenceUseError extends Error {}

/** Called by every export path. The message names the condition, so the refusal is actionable. */
export async function assertExportable(documentId: string): Promise<void> {
  const row = await database.prepare('SELECT license_title, permissions FROM jurisprudence_document WHERE id = ?')
    .get<{ license_title: string | null; permissions: string }>(documentId);
  if (!row) throw new JurisprudenceUseError('Documento de jurisprudência não encontrado.');
  const policy = documentUsePolicy(row);
  if (!policy.exportable) {
    throw new JurisprudenceUseError(`Exportação recusada: ${policy.reasons.join(' ')} O documento continua disponível para leitura interna.`);
  }
}
