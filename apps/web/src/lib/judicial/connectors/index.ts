import { ConnectorError, type InstallationRef, type JudicialConnector, type SourceKind } from '../contracts';
import { createDjenConnector } from './djen';
import { createMniConnector } from './mni';
import { createCkanConnector } from './ckan';
import { fixtureTransport, liveTransport, type FixtureEntry, type Transport } from './transport';

export { createDjenConnector, normalizeCommunications, DJEN_PARSER_VERSION } from './djen';
export { createMniConnector, MNI_PARSER_VERSION } from './mni';
export { createCkanConnector, CKAN_PARSER_VERSION } from './ckan';
export { fixtureTransport, fixtureKey, liveTransport, isPrivateAddress, TransportBlockedError } from './transport';
export type { FixtureEntry, Transport, TransportResponse, TransportRequestInit } from './transport';

/**
 * Resolves the adapter for an installation. Only kinds with a real implementation are listed:
 * the plan is explicit that a tool is published once it exists, and that "no API found" must not
 * be dressed up as a working connector. The jurisprudence APIs and court portals have contracts
 * in `contracts.ts` and no adapter here yet.
 */
const factories: Partial<Record<SourceKind, (transport: Transport) => JudicialConnector>> = {
  djen: createDjenConnector,
  mni: createMniConnector,
  ckan: createCkanConnector,
};

/**
 * Test and development runs supply their own fixture map. Nothing else may substitute the
 * transport: an installation that has not been cleared for live egress simply has no way to
 * reach the network, whichever caller asks.
 */
let transportOverride: Transport | null = null;

// Not named `use*`: that prefix marks a React hook, and these are module-level switches.
export function setFixtureTransport(
  fixtures: Map<string, FixtureEntry>,
  onRequest?: () => Promise<void> | void,
): void {
  transportOverride = fixtureTransport(fixtures, onRequest);
}

export function resetTransport(): void {
  transportOverride = null;
}

export function currentTransport(): Transport {
  return transportOverride ?? liveTransport;
}

export function connectorFor(installation: InstallationRef, transport?: Transport): JudicialConnector {
  const factory = factories[installation.kind];
  if (!factory) {
    throw new ConnectorError('unsupported', `Ainda não há conector implementado para fontes do tipo ${installation.kind}.`);
  }
  return factory(transport ?? currentTransport());
}

export function hasConnectorFor(kind: SourceKind): boolean {
  return Boolean(factories[kind]);
}

export const implementedConnectorKinds = Object.keys(factories) as SourceKind[];
