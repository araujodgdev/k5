import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import {
  installationRefSchema,
  type AuthKind,
  type CourtSystem,
  type Degree,
  type DiscoveryStatus,
  type InstallationRef,
  type PermissionState,
  type SourceKind,
  type SourcePurpose,
} from '../contracts';

/**
 * Source installations are public configuration, so this is the one judicial table that is not
 * scoped by office. It holds no credential and no collected evidence: reaching either still goes
 * through an office-scoped table.
 */

type InstallationRow = {
  id: string;
  kind: string;
  court_code: string;
  court_name: string;
  degree: string;
  system: string;
  purpose: string;
  coverage_from: string | null;
  coverage_to: string | null;
  base_url: string | null;
  contract_version: string | null;
  auth_kind: string;
  discovery_status: string;
  capabilities_json: string;
  permission_query: string;
  permission_cache: string;
  permission_documents: string;
  permission_redistribution: string;
  permission_ai: string;
  permission_evidence: string | null;
  allowed_hosts: string;
  enabled: number;
  live_transport_enabled: number;
  rate_limit_per_minute: number;
  daily_request_budget: number;
  notes: string | null;
  documentation_url: string | null;
  documentation_reviewed_at: string | null;
};

const SELECT_COLUMNS = `
  id, kind, court_code, court_name, degree, system, purpose, coverage_from, coverage_to,
  base_url, contract_version, auth_kind, discovery_status, capabilities_json,
  permission_query, permission_cache, permission_documents, permission_redistribution,
  permission_ai, permission_evidence, allowed_hosts, enabled, live_transport_enabled,
  rate_limit_per_minute, daily_request_budget, notes, documentation_url, documentation_reviewed_at
`;

/** A malformed JSON column must not take down a listing; an empty allowlist just blocks egress. */
function parseHosts(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function toInstallationRef(row: InstallationRow): InstallationRef {
  return installationRefSchema.parse({
    id: row.id,
    kind: row.kind as SourceKind,
    courtCode: row.court_code,
    courtName: row.court_name,
    degree: row.degree as Degree,
    system: row.system as CourtSystem,
    purpose: row.purpose as SourcePurpose,
    baseUrl: row.base_url,
    contractVersion: row.contract_version,
    authKind: row.auth_kind as AuthKind,
    discoveryStatus: row.discovery_status as DiscoveryStatus,
    permissions: {
      query: row.permission_query as PermissionState,
      cache: row.permission_cache as PermissionState,
      documents: row.permission_documents as PermissionState,
      redistribution: row.permission_redistribution as PermissionState,
      ai: row.permission_ai as PermissionState,
    },
    allowedHosts: parseHosts(row.allowed_hosts),
    enabled: row.enabled === 1,
    liveTransportEnabled: row.live_transport_enabled === 1,
    rateLimitPerMinute: row.rate_limit_per_minute,
    dailyRequestBudget: row.daily_request_budget,
    coverage: { from: row.coverage_from, to: row.coverage_to },
  });
}

export function findInstallation(id: string): InstallationRef | undefined {
  const row = database.prepare(`SELECT ${SELECT_COLUMNS} FROM judicial_source_installation WHERE id = ?`).get(id) as InstallationRow | undefined;
  return row ? toInstallationRef(row) : undefined;
}

export function listInstallations(filter: { purpose?: SourcePurpose; enabledOnly?: boolean } = {}): InstallationRef[] {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.purpose) { clauses.push('purpose = ?'); params.push(filter.purpose); }
  if (filter.enabledOnly) clauses.push('enabled = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(
    `SELECT ${SELECT_COLUMNS} FROM judicial_source_installation ${where} ORDER BY court_code, degree, purpose`,
  ).all(...params) as InstallationRow[];
  return rows.map(toInstallationRef);
}

export type InstallationInput = {
  kind: SourceKind;
  courtCode: string;
  courtName: string;
  degree: Degree;
  system: CourtSystem;
  purpose: SourcePurpose;
  baseUrl?: string | null;
  contractVersion?: string | null;
  authKind?: AuthKind;
  discoveryStatus?: DiscoveryStatus;
  permissions?: Partial<Record<'query' | 'cache' | 'documents' | 'redistribution' | 'ai', PermissionState>>;
  permissionEvidence?: string | null;
  allowedHosts?: string[];
  enabled?: boolean;
  liveTransportEnabled?: boolean;
  rateLimitPerMinute?: number;
  dailyRequestBudget?: number;
  coverageFrom?: string | null;
  coverageTo?: string | null;
  notes?: string | null;
  documentationUrl?: string | null;
};

/**
 * Registers or updates an installation. Both switches default to off: an operator turns a source
 * on deliberately after the discovery routine, and enabling live egress is a second, separate act.
 */
export function upsertInstallation(input: InstallationInput): InstallationRef {
  const permissions = {
    query: input.permissions?.query ?? 'nao_esclarecido',
    cache: input.permissions?.cache ?? 'nao_esclarecido',
    documents: input.permissions?.documents ?? 'nao_esclarecido',
    redistribution: input.permissions?.redistribution ?? 'nao_esclarecido',
    ai: input.permissions?.ai ?? 'nao_esclarecido',
  };

  database.prepare(`
    INSERT INTO judicial_source_installation (
      id, kind, court_code, court_name, degree, system, purpose, coverage_from, coverage_to,
      base_url, contract_version, auth_kind, discovery_status,
      permission_query, permission_cache, permission_documents, permission_redistribution, permission_ai,
      permission_evidence, allowed_hosts, enabled, live_transport_enabled,
      rate_limit_per_minute, daily_request_budget, notes, documentation_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, court_code, degree, system, purpose) DO UPDATE SET
      court_name = excluded.court_name,
      coverage_from = excluded.coverage_from,
      coverage_to = excluded.coverage_to,
      base_url = excluded.base_url,
      contract_version = excluded.contract_version,
      auth_kind = excluded.auth_kind,
      discovery_status = excluded.discovery_status,
      permission_query = excluded.permission_query,
      permission_cache = excluded.permission_cache,
      permission_documents = excluded.permission_documents,
      permission_redistribution = excluded.permission_redistribution,
      permission_ai = excluded.permission_ai,
      permission_evidence = excluded.permission_evidence,
      allowed_hosts = excluded.allowed_hosts,
      enabled = excluded.enabled,
      live_transport_enabled = excluded.live_transport_enabled,
      rate_limit_per_minute = excluded.rate_limit_per_minute,
      daily_request_budget = excluded.daily_request_budget,
      notes = excluded.notes,
      documentation_url = excluded.documentation_url,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    randomUUID(), input.kind, input.courtCode, input.courtName, input.degree, input.system, input.purpose,
    input.coverageFrom ?? null, input.coverageTo ?? null, input.baseUrl ?? null, input.contractVersion ?? null,
    input.authKind ?? 'none', input.discoveryStatus ?? 'candidate',
    permissions.query, permissions.cache, permissions.documents, permissions.redistribution, permissions.ai,
    input.permissionEvidence ?? null, JSON.stringify(input.allowedHosts ?? []),
    input.enabled ? 1 : 0, input.liveTransportEnabled ? 1 : 0,
    input.rateLimitPerMinute ?? 10, input.dailyRequestBudget ?? 500,
    input.notes ?? null, input.documentationUrl ?? null,
  );

  const row = database.prepare(
    `SELECT ${SELECT_COLUMNS} FROM judicial_source_installation
     WHERE kind = ? AND court_code = ? AND degree = ? AND system = ? AND purpose = ?`,
  ).get(input.kind, input.courtCode, input.degree, input.system, input.purpose) as InstallationRow;
  return toInstallationRef(row);
}

/**
 * Suspends a source. Section 13: a rollback turns the source off and keeps the records; it never
 * deletes what was already collected and never pretends to undo an external act.
 */
export function setInstallationStatus(id: string, status: DiscoveryStatus, enabled: boolean, liveTransportEnabled: boolean): void {
  database.prepare(
    `UPDATE judicial_source_installation
     SET discovery_status = ?, enabled = ?, live_transport_enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(status, enabled ? 1 : 0, enabled && liveTransportEnabled ? 1 : 0, id);
}
