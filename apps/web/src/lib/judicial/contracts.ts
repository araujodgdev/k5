import { z } from 'zod';

/**
 * Normalized vocabulary shared by every judicial connector, the services above them and the
 * tests. No server import belongs here: the browser reads the same enums to label a status.
 *
 * Section 5.2 of docs/plano-infra-judicial.md. The shapes are deliberately narrow — a connector
 * never receives a URL, a free-text filter or a credential, only typed ids the server resolved.
 */

export const sourceKinds = ['djen', 'mni', 'ckan', 'jurisprudence_api', 'vocabulary', 'court_portal'] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const degrees = ['first', 'second', 'superior', 'panel', 'not_applicable'] as const;
export type Degree = (typeof degrees)[number];

export const courtSystems = ['pje', 'eproc', 'esaj', 'projudi', 'saj', 'sei', 'proprietary', 'not_applicable'] as const;
export type CourtSystem = (typeof courtSystems)[number];

export const sourcePurposes = ['publications', 'case_tracking', 'jurisprudence', 'vocabulary'] as const;
export type SourcePurpose = (typeof sourcePurposes)[number];

/**
 * How access is granted. `delegated_lawyer` and `recipient` are called out because the plan
 * refuses to assume an individual lawyer's password authorizes a third party to act, and because
 * a recipient credential is what makes Domicílio a separate, later delivery.
 */
export const authKinds = ['none', 'public_key', 'institutional', 'delegated_lawyer', 'recipient'] as const;
export type AuthKind = (typeof authKinds)[number];

/**
 * Section 4.2 step 10. An installation only advances with evidence, and "no documentation found"
 * is `candidate`, never a conclusion that the court has no interface.
 */
export const discoveryStatuses = [
  'candidate', 'documented', 'access_pending', 'spike_approved', 'pilot', 'production', 'degraded', 'suspended',
] as const;
export type DiscoveryStatus = (typeof discoveryStatuses)[number];

/**
 * Section 4.3. Five permissions, each answered on its own. A source that allows a query may still
 * forbid caching its response or sending it to a model, so this is never one boolean.
 */
export const permissionStates = ['permitido', 'restrito', 'proibido', 'nao_esclarecido'] as const;
export type PermissionState = (typeof permissionStates)[number];

export const permissionDimensions = ['query', 'cache', 'documents', 'redistribution', 'ai'] as const;
export type PermissionDimension = (typeof permissionDimensions)[number];

export type SourcePermissions = Record<PermissionDimension, PermissionState>;

/** A dimension is usable only when it was explicitly cleared. Silence is not authorization. */
export function permits(permissions: SourcePermissions, dimension: PermissionDimension): boolean {
  return permissions[dimension] === 'permitido';
}

/**
 * Section 8: `GET` is not a safety classification. Resolução CNJ 455/2022 describes access to the
 * content of a communication — including through an API — as capable of perfecting service of
 * process. Only `neutral_query` may run inside the generic worker.
 */
export const operationEffects = ['neutral_query', 'possible_notice', 'filing', 'unknown'] as const;
export type OperationEffect = (typeof operationEffects)[number];

export function isWorkerSafe(effect: OperationEffect): effect is 'neutral_query' {
  return effect === 'neutral_query';
}

export const connectorOperations = [
  'describeCapabilities', 'lookupCase', 'listChanges', 'fetchPublication', 'fetchDocument', 'health',
  // Jurisprudence collections (trilha B): list what a dataset offers, then fetch one resource.
  'listPrecedents', 'fetchPrecedent',
] as const;
export type ConnectorOperation = (typeof connectorOperations)[number];

/** Structured failures from section 5.2. A connector never throws a provider error upwards. */
export const connectorErrorCodes = [
  'unauthorized', 'forbidden', 'rate_limited', 'source_unavailable', 'schema_changed',
  'not_found_in_source', 'partial', 'unsupported', 'human_action_required',
] as const;
export type ConnectorErrorCode = (typeof connectorErrorCodes)[number];

export class ConnectorError extends Error {
  public rawPayload?: { contentType: string; body: string };
  public rawPayloads?: Array<{ contentType: string; body: string }>;

  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    /** Seconds the source asked us to wait, when it said so. */
    public readonly retryAfterSeconds?: number,
    rawPayload?: { contentType: string; body: string },
    rawPayloads?: Array<{ contentType: string; body: string }>,
  ) {
    super(message);
    this.name = 'ConnectorError';
    this.rawPayload = rawPayload;
    this.rawPayloads = rawPayloads;
  }
}

/** Transient by nature. Anything else needs a person, not another attempt. */
export function isRetryable(code: ConnectorErrorCode): boolean {
  return code === 'rate_limited' || code === 'source_unavailable' || code === 'partial';
}

export const installationRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(sourceKinds),
  courtCode: z.string().min(1),
  courtName: z.string().min(1),
  degree: z.enum(degrees),
  system: z.enum(courtSystems),
  purpose: z.enum(sourcePurposes),
  baseUrl: z.string().nullable(),
  contractVersion: z.string().nullable(),
  authKind: z.enum(authKinds),
  discoveryStatus: z.enum(discoveryStatuses),
  permissions: z.object({
    query: z.enum(permissionStates),
    cache: z.enum(permissionStates),
    documents: z.enum(permissionStates),
    redistribution: z.enum(permissionStates),
    ai: z.enum(permissionStates),
  }),
  allowedHosts: z.array(z.string()),
  enabled: z.boolean(),
  liveTransportEnabled: z.boolean(),
  rateLimitPerMinute: z.number().int().positive(),
  dailyRequestBudget: z.number().int().positive(),
  coverage: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
});
export type InstallationRef = z.infer<typeof installationRefSchema>;

/** What one installation can actually do, declared per operation with its legal effect. */
export const connectorCapabilitiesSchema = z.object({
  installationId: z.string().min(1),
  parserVersion: z.string().min(1),
  operations: z.array(z.object({
    operation: z.enum(connectorOperations),
    supported: z.boolean(),
    effect: z.enum(operationEffects),
    /** Typed filters the operation accepts. A filter absent from this list is refused upstream. */
    filters: z.array(z.string()),
    /** Absent when the source does not paginate; `null` page size means it never said. */
    maxPageSize: z.number().int().positive().nullable(),
    notes: z.string().optional(),
  })),
  /** Longest window the source documents for an incremental query, in days. */
  maxWindowDays: z.number().int().positive().nullable(),
  requiresConnection: z.boolean(),
});
export type ConnectorCapabilities = z.infer<typeof connectorCapabilitiesSchema>;

/**
 * Six distinct moments (section 6). They are kept apart because conflating them is how a system
 * ends up reporting a backfilled 2019 publication as today's news.
 */
export const provenanceSchema = z.object({
  /** When the fact or movement happened, per the source. */
  eventAt: z.string().nullable(),
  /** Disponibilização: when the court made it available. */
  madeAvailableOn: z.string().nullable(),
  /** Publicação: the legally operative publication date. */
  publishedOn: z.string().nullable(),
  /** Last change the source itself declares. */
  sourceUpdatedAt: z.string().nullable(),
  /** When Lume asked. */
  collectedAt: z.string(),
  /** When Lume committed it. */
  ingestedAt: z.string(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const caseIdentitySchema = z.object({
  /** 20 digits, punctuation stripped. Null when the source only has a native identity. */
  cnjNumber: z.string().regex(/^\d{20}$/).nullable(),
  /** Exactly as the source writes it, including legacy formats. */
  nativeNumber: z.string().nullable(),
  degree: z.enum(degrees),
}).refine((value) => value.cnjNumber !== null || value.nativeNumber !== null, {
  message: 'Um processo precisa de número CNJ ou de identidade nativa da fonte.',
});
export type CaseIdentity = z.infer<typeof caseIdentitySchema>;

export const normalizedMovementSchema = z.object({
  sourceMovementId: z.string().nullable(),
  sourceCode: z.string().nullable(),
  sourceText: z.string().min(1),
  /** Only when the source stated it. Never inferred from a description that merely looks alike. */
  tpuCode: z.string().nullable(),
  tpuSource: z.enum(['source_declared', 'catalog_exact']).nullable(),
  eventAt: z.string().min(1),
  eventPrecision: z.enum(['date', 'minute', 'second']),
  eventTimezone: z.string().nullable(),
});
export type NormalizedMovement = z.infer<typeof normalizedMovementSchema>;

export const normalizedPublicationSchema = z.object({
  sourcePublicationId: z.string().nullable(),
  cnjNumber: z.string().regex(/^\d{20}$/).nullable(),
  edition: z.string().nullable(),
  page: z.string().nullable(),
  officialHash: z.string().nullable(),
  body: z.string().min(1),
  madeAvailableOn: z.string().nullable(),
  publishedOn: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  revisionKind: z.enum(['original', 'republication', 'errata']),
  rawPayloadIndex: z.number().int().nonnegative().optional(),
});
export type NormalizedPublication = z.infer<typeof normalizedPublicationSchema>;

export const normalizedCaseSchema = z.object({
  sourceRecordId: z.string().min(1),
  identity: caseIdentitySchema,
  title: z.string().nullable(),
  classCode: z.string().nullable(),
  subjectCodes: z.array(z.string()),
  sourceUpdatedAt: z.string().nullable(),
  movements: z.array(normalizedMovementSchema),
});
export type NormalizedCase = z.infer<typeof normalizedCaseSchema>;

export const normalizedDocumentSchema = z.object({
  sourceDocumentId: z.string().min(1),
  title: z.string().min(1),
  documentType: z.string().nullable(),
  mimeType: z.string().nullable(),
  byteSize: z.number().int().nonnegative(),
  /** Resolved by the connector against its own allowlist; never taken from the model. */
  downloadUrl: z.string().nullable(),
});
export type NormalizedDocument = z.infer<typeof normalizedDocumentSchema>;

/**
 * What a jurisprudence document is. An ementa is not the decision: the kind travels with every
 * record, every search result and every citation, so a summary is never presented as the text.
 */
export const precedentContentKinds = ['ementa', 'espelho', 'inteiro_teor', 'sumula', 'tema', 'decisao_monocratica'] as const;
export type PrecedentContentKind = (typeof precedentContentKinds)[number];

/** Read per resource (or its own dataset), never extended from a catalog. Null when undeclared. */
export const precedentLicenseSchema = z.object({
  title: z.string().min(1),
  url: z.string().nullable(),
  attribution: z.string().nullable(),
}).nullable();
export type PrecedentLicense = z.infer<typeof precedentLicenseSchema>;

export const normalizedPrecedentSchema = z.object({
  sourceDocumentId: z.string().min(1),
  court: z.string().min(1),
  organ: z.string().nullable(),
  contentKind: z.enum(precedentContentKinds),
  caseIdentity: z.object({ cnjNumber: z.string().regex(/^\d{20}$/).nullable(), nativeNumber: z.string().nullable() }).nullable(),
  title: z.string().nullable(),
  rapporteur: z.string().nullable(),
  judgedOn: z.string().nullable(),
  publishedOn: z.string().nullable(),
  headnote: z.string().nullable(),
  /** Where the full text lives when the source provides it; null for an ementa or espelho alone. */
  fullTextRef: z.string().nullable(),
  citationLabel: z.string().min(1),
  license: precedentLicenseSchema,
  sourceUpdatedAt: z.string().nullable(),
  /** sha256 of the record as the source wrote it; a changed record is a new version. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  /** Only when the source itself relates two documents. Never inferred from similar text. */
  relatedSourceDocumentId: z.string().nullable(),
});
export type NormalizedPrecedent = z.infer<typeof normalizedPrecedentSchema>;

/** One downloadable file in a dataset. A resource is not a judgment: one ZIP may hold thousands. */
export type PrecedentResource = {
  sourceResourceId: string;
  datasetId: string;
  name: string | null;
  url: string;
  format: string | null;
  /** What the source declares (hash, or last change and size); a change here triggers a download. */
  declaredChecksum: string;
  sourceUpdatedAt: string | null;
  license: PrecedentLicense;
};

export type ListPrecedentsRequest = { datasetId: string };
export type FetchPrecedentRequest = { resource: PrecedentResource; contentKind: PrecedentContentKind };
/** The normalized documents plus the exact bytes, which are kept as the evidence they came from. */
export type PrecedentFetch = ConnectorResult<NormalizedPrecedent> & {
  original: { contentType: string; bytes: Buffer; sha256: string };
};

/**
 * Common envelope for every connector result. `coverage` is what makes a short answer honest:
 * a page limit that stopped the sweep is reported, not silently treated as "that was all".
 */
export type ConnectorResult<T> = {
  items: T[];
  /** Opaque to everything above the connector. Never a URL handed to a caller. */
  cursor: string | null;
  coverage: {
    /** True when the source had more and this call stopped early. */
    truncated: boolean;
    /** Pages actually walked in this call. */
    pagesFetched: number;
    /** What the source claims exists for the query, when it says so. */
    totalReported: number | null;
    /** Window actually covered, which may be narrower than the one requested. */
    windowFrom: string | null;
    windowTo: string | null;
    /** Anything the connector could not parse, counted rather than dropped in silence. */
    rejected: number;
  };
  source: {
    installationId: string;
    operation: ConnectorOperation;
    parserVersion: string;
    /** Instant of the query, in ISO 8601 UTC. */
    collectedAt: string;
  };
  /** Raw payloads to persist before anything normalized is published (section 7 step 4). */
  rawPayloads: Array<{ contentType: string; body: string }>;
};

/** Typed, server-resolved arguments. A connector never accepts a host, a path or a credential. */
export type LookupCaseRequest = {
  identity: CaseIdentity;
  /** Decrypted at the call site only when the installation requires it; never logged. */
  credential?: string;
};

export type ListChangesRequest = {
  /** Inclusive ISO date. The caller deliberately overlaps the previous watermark. */
  windowFrom: string;
  windowTo: string;
  cursor?: string | null;
  /** Restricts the sweep to proceedings the office already linked. */
  cnjNumbers?: string[];
  maxPages?: number;
  credential?: string;
  onRawPayload?: (payload: { contentType: string; body: string }) => void | Promise<void>;
};

/**
 * What a parser reads from a JSON response, declared by the connector so the conformance harness
 * can say which fields of a real response nobody reads. Paths: envelope keys as-is, item keys
 * under `listKeys` compared by name. `ignored` is a reviewed decision, not a place to hide noise.
 */
export type FieldManifest = {
  /** One of these envelope keys holds the list of items. */
  listKeys: string[];
  envelope: string[];
  /** Aliases for one logical field; a `required` group must match at least one key on every item. */
  item: Array<{ keys: string[]; required?: boolean }>;
  ignored: { envelope: string[]; item: string[] };
};

/**
 * The interface every source adapter implements. `normalize` is deliberately separate and pure:
 * a parser fix re-reads stored snapshots instead of asking the court again.
 */
export type JudicialConnector = {
  readonly kind: SourceKind;
  readonly parserVersion: string;
  describeCapabilities(installation: InstallationRef): ConnectorCapabilities;
  health?(installation: InstallationRef): Promise<{ ok: boolean; detail: string }>;
  lookupCase?(installation: InstallationRef, request: LookupCaseRequest): Promise<ConnectorResult<NormalizedCase>>;
  listChanges?(installation: InstallationRef, request: ListChangesRequest): Promise<ConnectorResult<NormalizedPublication>>;
  fetchPublication?(installation: InstallationRef, sourcePublicationId: string): Promise<ConnectorResult<NormalizedPublication>>;
  fetchDocument?(installation: InstallationRef, sourceDocumentId: string): Promise<ConnectorResult<NormalizedDocument>>;
  listPrecedents?(installation: InstallationRef, request: ListPrecedentsRequest): Promise<ConnectorResult<PrecedentResource>>;
  fetchPrecedent?(installation: InstallationRef, request: FetchPrecedentRequest): Promise<PrecedentFetch>;
  /** Null when the operation has no JSON parser to confront (see conformance.ts). */
  expectedFields?(operation: ConnectorOperation): FieldManifest | null;
  /** Pure: same bytes in, same records out, no network, version pinned by `parserVersion`. */
  normalize(operation: ConnectorOperation, payload: string): unknown;
};

export function emptyCoverage(): ConnectorResult<never>['coverage'] {
  return { truncated: false, pagesFetched: 0, totalReported: null, windowFrom: null, windowTo: null, rejected: 0 };
}
