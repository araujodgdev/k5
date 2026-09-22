import type { InstallationRef, PermissionDimension } from '@/lib/judicial/contracts';

export type ResearchAction = 'local_read' | 'search_source' | 'store_public' | 'store_document' | 'fetch_document' | 'send_to_ai';

/** Only this connector can fetch one judgment's material on demand. STJ is imported by CKAN resource. */
export function supportsDirectResearchMaterial(installation: {kind:string;courtCode:string}): boolean {
  return installation.kind === 'jurisprudence_api' && installation.courtCode === 'TJDFT';
}

const requiredPermissions: Record<ResearchAction, PermissionDimension[]> = {
  local_read: ['query', 'cache', 'redistribution'],
  search_source: ['query', 'cache', 'redistribution'],
  store_public: ['query', 'cache', 'redistribution'],
  store_document: ['query', 'cache', 'documents', 'redistribution'],
  fetch_document: ['query', 'cache', 'documents', 'redistribution'],
  send_to_ai: ['query', 'cache', 'redistribution', 'ai'],
};

/** Each right has to be recorded explicitly. A successful HTTP response establishes no right. */
export function canUseResearchSource(installation: InstallationRef, action: ResearchAction): boolean {
  return installation.purpose === 'jurisprudence'
    && installation.authKind === 'none'
    && installation.enabled
    && installation.discoveryStatus !== 'suspended'
    && requiredPermissions[action].every((dimension) => installation.permissions[dimension] === 'permitido')
    && (action !== 'search_source' && action !== 'fetch_document' || installation.liveTransportEnabled);
}
