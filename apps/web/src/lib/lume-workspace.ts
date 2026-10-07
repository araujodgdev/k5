import { documentKey, type DocumentRef } from './document-ref';
import { adminNavigation, appNavigation, profileNavigation, tutorialNavigation, type NavSlug } from './navigation';

export type PanelMode = 'floating' | 'focused' | 'collapsed';
export type MobileSurface = 'chat' | 'canvas';
export type CanvasResource = { href: string; title: string } & (
  | { kind: 'module'; slug: NavSlug | 'admin' | 'profile' | 'tutorial' }
  | { kind: 'case'; caseId: string; folderId: string | null }
  | { kind: 'document'; document: DocumentRef }
  | { kind: 'file'; documentId: string; caseId: string | null }
);
export type SourceSelection = { caseId: string | null; caseLabel?: string; documentIds: string[]; researchReferenceIds: string[] };
export type MessageScope = {
  canvasHref?: string;
  caseId?: string;
  documentIds: string[];
  researchReferenceIds: string[];
  document?: DocumentRef;
  selection?: { document: DocumentRef; excerpt: string };
};
export type StoredMessageScope = MessageScope & { version: 2; label: string };
export type WorkspaceState = {
  tabs: CanvasResource[];
  href: string;
  resource: CanvasResource | null;
  revokedHref: string | null;
  mode: PanelMode;
  mobile: MobileSurface;
  navigation: number;
  sources: SourceSelection;
  revisions: Readonly<Record<string, number>>;
};
export class CanvasResourceReadError extends Error {
  constructor(readonly status: number) { super('Não foi possível abrir este recurso. Confira seu acesso e tente novamente.'); }
}
export type ResourceAccess = { resource: CanvasResource; authorization: number };
type ResourceResolution =
  | { status: 'authorized'; resource: CanvasResource }
  | { status: 'revoked'; resource: CanvasResource | null }
  | { status: 'stale' };
const emptySources = (): SourceSelection => ({ caseId: null, documentIds: [], researchReferenceIds: [] });

/** Only application destinations can become canvas tabs. Utility intents are not resource identity. */
export function canonicalCanvasHref(value: string): string | null {
  if (!value.startsWith('/app/') || /[\\\u0000-\u001f]/.test(value)) return null;
  const url = new URL(value, 'https://lume.invalid');
  if (url.origin !== 'https://lume.invalid') return null;
  const root = url.pathname.split('/')[2];
  if (!appNavigation.some(item => item.slug === root) && !['documents', 'admin', 'profile', 'tutorial'].includes(root)) return null;
  if (root === 'documents' && !/^\/app\/documents\/[^/]+$/.test(url.pathname)) return null;
  for (const key of ['conversationId', 'lume', 'feedback', 'notificacoes']) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '');
}

export function moduleResource(href: string): CanvasResource | null {
  const canonical = canonicalCanvasHref(href);
  if (!canonical) return null;
  const url = new URL(canonical, 'https://lume.invalid');
  if (url.pathname.startsWith('/app/documents/') || url.pathname.startsWith('/app/vault/cases/') || url.pathname.startsWith('/app/vault/files/') || url.searchParams.has('documentId')) return null;
  const slug = url.pathname.split('/')[2];
  const item = appNavigation.find(item => item.slug === slug);
  if (item) return { kind: 'module', slug: item.slug, href: canonical, title: item.label };
  const utility = [adminNavigation, profileNavigation, tutorialNavigation].find(item => item.href === `/app/${slug}`);
  return utility ? { kind: 'module', slug: slug as 'admin' | 'profile' | 'tutorial', href: canonical, title: utility.label } : null;
}

export function resourceKey(resource: CanvasResource): string {
  switch (resource.kind) {
    case 'case': return `case:${resource.caseId}:${resource.folderId ?? ''}`;
    case 'document': return documentKey(resource.document);
    case 'file': return `file:${resource.documentId}`;
    case 'module': return `module:${new URL(resource.href, 'https://lume.invalid').pathname}`;
  }
}

function resourceCase(resource: CanvasResource | null) {
  return resource?.kind === 'case' || resource?.kind === 'file' ? resource.caseId : resource?.kind === 'document' && resource.document.kind === 'case-page' ? resource.document.caseId : null;
}

export function copyMessageScope(resource: CanvasResource | null, sources: SourceSelection, selection?: MessageScope['selection']): MessageScope {
  if (!resource) throw new Error('Aguarde o contexto do canvas carregar antes de enviar.');
  const caseId = resourceCase(resource) ?? sources.caseId ?? undefined;
  return {
    canvasHref: resource.href,
    caseId,
    documentIds: [...new Set([...sources.documentIds, ...(resource.kind === 'file' ? [resource.documentId] : [])])],
    researchReferenceIds: [...sources.researchReferenceIds],
    ...(resource.kind === 'document' ? { document: { ...resource.document } } : {}),
    ...(selection ? { selection: { ...selection, document: { ...selection.document } } } : {}),
  };
}

type WorkspaceAction =
  | { type: 'destination'; href: string; resource: CanvasResource | null; explicit?: boolean }
  | { type: 'authorized'; resource: CanvasResource }
  | { type: 'unavailable'; href: string }
  | { type: 'revoked'; href: string; resource: CanvasResource | null }
  | { type: 'tab'; resource: CanvasResource }
  | { type: 'close'; key: string }
  | { type: 'mode'; mode: PanelMode }
  | { type: 'mobile'; mobile: MobileSurface }
  | { type: 'sources'; sources: SourceSelection }
  | { type: 'changed'; key: string };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'destination': {
      if (state.href === action.href && !action.explicit) return state;
      return { ...state, href: action.href, resource: action.resource, revokedHref: null, navigation: state.navigation + 1,
        sources: emptySources(), mobile: 'canvas' };
    }
    case 'authorized':
      if (action.resource.href !== state.href) return state;
      return { ...workspaceReducer(state, { type: 'tab', resource: action.resource }), resource: action.resource, revokedHref: null };
    case 'unavailable': return state.href === action.href ? { ...state, resource: null } : state;
    case 'revoked': {
      const denied = action.resource;
      const matches = (resource: CanvasResource) => denied?.kind === 'case' && !denied.folderId
        ? resourceCase(resource) === denied.caseId
        : denied ? resourceKey(resource) === resourceKey(denied) : resource.href === action.href;
      const active = state.href === action.href || !!state.resource && matches(state.resource);
      let sources = state.sources;
      if (active || action.resource?.kind === 'case' && !action.resource.folderId && sources.caseId === action.resource.caseId) sources = emptySources();
      else if (action.resource?.kind === 'file') {
        const documentId = action.resource.documentId;
        sources = { ...sources, documentIds: sources.documentIds.filter(id => id !== documentId) };
      }
      return { ...state, tabs: state.tabs.filter(tab => !matches(tab)), sources,
        ...(active ? { resource: null, revokedHref: state.href, navigation: state.navigation + 1 } : {}) };
    }
    case 'tab': {
      const key = resourceKey(action.resource);
      const index = state.tabs.findIndex(item => resourceKey(item) === key);
      const tabs = [...state.tabs];
      if (index < 0) tabs.push(action.resource);
      else tabs[index] = action.resource;
      return { ...state, tabs: tabs.slice(-20) };
    }
    case 'close': return { ...state, tabs: state.tabs.filter(item => resourceKey(item) !== action.key) };
    case 'mode': return { ...state, mode: action.mode, mobile: action.mode === 'collapsed' ? 'canvas' : 'chat' };
    case 'mobile': return { ...state, mobile: action.mobile };
    case 'sources': return { ...state, sources: { ...action.sources, documentIds: [...action.sources.documentIds], researchReferenceIds: [...action.sources.researchReferenceIds] } };
    case 'changed': return { ...state, revisions: { ...state.revisions, [action.key]: (state.revisions[action.key] ?? 0) + 1 } };
  }
}

/** One owner for navigation intent and synchronous send snapshots, independent of React's render scheduling. */
export class LumeWorkspaceController {
  private listeners = new Set<() => void>();
  private selection: MessageScope['selection'];
  private value: WorkspaceState;
  private resolutions = new Map<string, number>();
  private authorizations = new Map<string, number>();
  private resolutionSerial = 0;
  private revokedCases = new Map<string, number>();
  constructor(href: string, mobile: MobileSurface) {
    this.value = { href, resource: moduleResource(href), revokedHref: null, tabs: [], mode: 'floating', mobile, navigation: 0, sources: emptySources(), revisions: {} };
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispatch = (action: WorkspaceAction) => {
    const next = workspaceReducer(this.value, action);
    if (next === this.value) return;
    if (action.type === 'destination') this.selection = undefined;
    if (action.type === 'revoked' && (next.revokedHref === next.href || action.resource?.kind === 'document' && this.selection && documentKey(this.selection.document) === documentKey(action.resource.document))) this.selection = undefined;
    if (action.type === 'authorized' || action.type === 'tab') {
      for (const key of this.resolutionKeys(action.resource)) this.advanceResolution(key);
      this.authorizations.set(resourceKey(action.resource), this.resolutionSerial);
    }
    if (action.type === 'revoked') {
      if (action.resource) {
        for (const key of [resourceKey(action.resource), `href:${action.resource.href}`]) this.advanceResolution(key);
        this.authorizations.set(resourceKey(action.resource), this.resolutionSerial);
      }
      for (const tab of this.value.tabs) if (!next.tabs.includes(tab)) {
        this.advanceResolution(resourceKey(tab));
        this.advanceResolution(`href:${tab.href}`);
        this.authorizations.set(resourceKey(tab), this.resolutionSerial);
      }
      if (action.resource?.kind === 'case' && !action.resource.folderId) this.revokedCases.set(action.resource.caseId, ++this.resolutionSerial);
    }
    this.value = next;
    for (const listener of this.listeners) listener();
  };
  takeScope = (): MessageScope => {
    const snapshot = copyMessageScope(this.value.resource, this.value.sources, this.selection);
    this.selection = undefined;
    return snapshot;
  };
  selectExcerpt(selection: MessageScope['selection']) { this.selection = selection ? { ...selection, document: { ...selection.document } } : undefined; }
  canPresentResult(navigation: number) { return this.value.navigation === navigation; }
  captureResourceAccess(resource: CanvasResource): ResourceAccess {
    return { resource, authorization: this.authorizations.get(resourceKey(resource)) ?? 0 };
  }
  invalidateResource(access: ResourceAccess) {
    if ((this.authorizations.get(resourceKey(access.resource)) ?? 0) !== access.authorization) return false;
    this.dispatch({ type: 'revoked', href: access.resource.href, resource: access.resource });
    return true;
  }
  private advanceResolution(key: string) {
    const version = ++this.resolutionSerial;
    this.resolutions.set(key, version);
    return version;
  }
  private resolutionKeys(resource: CanvasResource) {
    const caseId = resourceCase(resource);
    return [...new Set([resourceKey(resource), `href:${resource.href}`, ...(caseId ? [`case:${caseId}:`] : [])])];
  }
  async resolveResource(href: string, read: () => Promise<CanvasResource>): Promise<ResourceResolution> {
    const destination = new URL(href, 'https://lume.invalid');
    const matches = (resource: CanvasResource) => {
      const fileId = destination.searchParams.get('documentId');
      if (fileId) return resource.kind === 'file' && resource.documentId === fileId;
      return new URL(resource.href, 'https://lume.invalid').pathname === destination.pathname
        && (resource.kind !== 'case' || resource.folderId === destination.searchParams.get('folder'));
    };
    const known = this.value.tabs.find(matches) ?? (this.value.resource && matches(this.value.resource) ? this.value.resource : null);
    const key = known ? resourceKey(known) : `href:${href}`;
    const version = this.advanceResolution(key);
    try {
      const resource = await read();
      const caseId = resourceCase(resource);
      if (this.resolutions.get(key) !== version || (this.resolutions.get(resourceKey(resource)) ?? 0) > version || caseId && (this.revokedCases.get(caseId) ?? 0) > version) return { status: 'stale' };
      this.dispatch({ type: 'tab', resource });
      return { status: 'authorized', resource };
    } catch (error) {
      if (this.resolutions.get(key) !== version) return { status: 'stale' };
      if (!(error instanceof CanvasResourceReadError) || error.status !== 403 && error.status !== 404) throw error;
      this.dispatch({ type: 'revoked', href, resource: known });
      return { status: 'revoked', resource: known };
    }
  }
}

export function tabStorageKey(userId: string, officeId: string) { return `lume:canvas:v1:${userId}:${officeId}`; }

export function restoreTabHrefs(raw: string | null): string[] {
  try {
    const values: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(values) ? [...new Set(values.flatMap(value => {
      const href = typeof value === 'string' ? canonicalCanvasHref(value) : null;
      return href ? [href] : [];
    }))].slice(-20) : [];
  } catch { return []; }
}
