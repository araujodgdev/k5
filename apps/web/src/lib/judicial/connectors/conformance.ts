import { createHash } from 'node:crypto';
import { ConnectorError, type ConnectorOperation, type FieldManifest, type JudicialConnector } from '../contracts';

/**
 * Confronts one response from a source with what the parser actually reads (A1 of
 * docs/Refinos-MVP/plano-conectores-tribunais.md). Pure: no network, no database. HTTP 200 is not
 * acceptance; an empty `unknownFields` and `missingExpected` is.
 */

export type ConformanceReport = {
  installationId: string;
  operation: ConnectorOperation;
  parserVersion: string;
  payloadSha256: string;
  /** Paths present in the payload that the parser reads or has explicitly chosen to ignore. */
  knownFields: string[];
  /** Paths present in the payload that the parser has never accounted for. Never silenced. */
  unknownFields: string[];
  /** Paths the parser requires and the payload does not carry. */
  missingExpected: string[];
  items: number;
  /** Hash of the normalized items, so a re-read of a recorded fixture can be compared exactly. */
  itemsSha256: string;
  rejected: number;
  /** `code: message` when the parser refused the payload outright. */
  parseError: string | null;
  requestSummary: Record<string, unknown>;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function describeExpectedFields(connector: JudicialConnector, operation: ConnectorOperation): FieldManifest {
  const manifest = connector.expectedFields?.(operation);
  if (!manifest) {
    throw new ConnectorError('unsupported', `O conector ${connector.kind} não declara campos para ${operation}.`);
  }
  return manifest;
}

// ponytail: top-level envelope and item keys only; nested objects under a known key are not
// walked. Extend to dotted paths when a source nests fields the parser reads.
function diffFields(manifest: FieldManifest, payload: unknown) {
  const known = new Set<string>();
  const unknown = new Set<string>();
  const missing = new Set<string>();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    missing.add(manifest.listKeys.join('|'));
    return { known, unknown, missing };
  }

  const envelope = payload as Record<string, unknown>;
  const listKey = manifest.listKeys.find((key) => Array.isArray(envelope[key]));
  const envelopeKnown = new Set([...manifest.listKeys, ...manifest.envelope, ...manifest.ignored.envelope]);
  for (const key of Object.keys(envelope)) (envelopeKnown.has(key) ? known : unknown).add(key);
  if (!listKey) {
    missing.add(manifest.listKeys.join('|'));
    return { known, unknown, missing };
  }

  const itemKnown = new Set([...manifest.item.flatMap((group) => group.keys), ...manifest.ignored.item]);
  for (const entry of envelope[listKey] as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) (itemKnown.has(key) ? known : unknown).add(`${listKey}[].${key}`);
    for (const group of manifest.item) {
      if (group.required && !group.keys.some((key) => item[key] !== undefined && item[key] !== null)) {
        missing.add(`${listKey}[].${group.keys.join('|')}`);
      }
    }
  }
  return { known, unknown, missing };
}

export function compareToParser(
  connector: JudicialConnector,
  operation: ConnectorOperation,
  payload: string,
  context: { installationId: string; requestSummary?: Record<string, unknown> } = { installationId: 'fixture' },
): ConformanceReport {
  const manifest = describeExpectedFields(connector, operation);

  let parsedJson: unknown = null;
  try { parsedJson = JSON.parse(payload); } catch { /* reported through parseError below */ }
  const { known, unknown, missing } = diffFields(manifest, parsedJson);

  let items: unknown[] = [];
  let rejected = 0;
  let parseError: string | null = null;
  try {
    const result = connector.normalize(operation, payload) as { items?: unknown[]; rejected?: number };
    items = Array.isArray(result.items) ? result.items : [];
    rejected = typeof result.rejected === 'number' ? result.rejected : 0;
  } catch (error) {
    parseError = error instanceof ConnectorError ? `${error.code}: ${error.message}` : 'Falha inesperada no parser.';
  }

  return {
    installationId: context.installationId,
    operation,
    parserVersion: connector.parserVersion,
    payloadSha256: sha256(payload),
    knownFields: [...known].sort(),
    unknownFields: [...unknown].sort(),
    missingExpected: [...missing].sort(),
    items: items.length,
    itemsSha256: sha256(JSON.stringify(items)),
    rejected,
    parseError,
    requestSummary: context.requestSummary ?? {},
  };
}

/** Exit code the probe returns: divergence is 2 so a script can tell it apart from a refusal. */
export function conformanceExitCode(report: ConformanceReport): 0 | 2 {
  return report.unknownFields.length || report.missingExpected.length || report.parseError ? 2 : 0;
}
