import { getPage } from './case-pages/service';
import { documentHref } from './document-ref';
import 'server-only';
import { database } from './database';
import { ownedArtifact } from './ai-store';
import { caseAccess, documentAccess } from './collaboration/access';
import { findVaultCase, findVaultDocument, findVaultFolder } from './vault';
import { CapabilityError } from './capabilities/errors';
import { assertCapabilityAllowed, type WorkspaceContext } from './application/context';
import { isPlatformAdmin } from './platform-core';
import { isWhatsAppEnabled } from './whatsapp/rollout';
import { isAdsEnabled } from './ads/rollout';
import { canonicalCanvasHref, moduleResource, type CanvasResource } from './lume-workspace';

export async function authorizedCanvasResource(context: WorkspaceContext, requested: string): Promise<CanvasResource> {
  const href = canonicalCanvasHref(requested);
  if (!href) throw new CapabilityError('INVALID', 'Destino inválido para o canvas.');
  await assertCapabilityAllowed(context, 'k5_ui_open_resource');
  const url = new URL(href, 'https://lume.invalid');
  const artifact = /^\/app\/documents\/([^/]+)$/.exec(url.pathname);
  if (artifact) {
    const artifactId = decodeURIComponent(artifact[1]);
    const row = await ownedArtifact(database, context, artifactId);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Documento não encontrado.');
    return { kind: 'document', document: { kind: 'artifact', id: artifactId }, href: `/app/documents/${encodeURIComponent(artifactId)}`, title: row.title };
  }
  const pageMatch = /^\/app\/vault\/cases\/([^/]+)\/pages\/([^/]+)$/.exec(url.pathname);
  if (pageMatch) {
    const { page } = await getPage(context, { caseId: decodeURIComponent(pageMatch[1]), pageId: decodeURIComponent(pageMatch[2]) });
    const document = { kind: 'case-page' as const, caseId: page.caseId, id: page.id };
    return { kind: 'document', document, href: documentHref(document), title: page.title };
  }
  const file = /^\/app\/vault\/files\/([^/]+)$/.exec(url.pathname);
  const fileId = file ? decodeURIComponent(file[1]) : url.searchParams.get('documentId');
  if (fileId) {
    const access = await documentAccess(context, fileId);
    const row = await findVaultDocument(access.officeId, fileId, context.userId);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Arquivo não encontrado.');
    return { kind: 'file', documentId: fileId, caseId: row.caseId, href: `/app/vault/files/${encodeURIComponent(fileId)}`, title: row.name };
  }
  const match = /^\/app\/vault\/cases\/([^/]+)$/.exec(url.pathname);
  if (match) {
    const caseId = decodeURIComponent(match[1]);
    const access = await caseAccess(context.userId, caseId);
    const row = await findVaultCase(access.officeId, caseId, context.userId);
    if (!row) throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
    const folderId = url.searchParams.get('folder');
    const folder = folderId ? await findVaultFolder(access.officeId, folderId, context.userId) : null;
    if (folderId && (!folder || folder.caseId !== caseId)) throw new CapabilityError('NOT_FOUND', 'Pasta não encontrada.');
    return { kind: 'case', caseId, folderId, href, title: folder ? `${row.name} · ${folder.name}` : row.name };
  }
  const resource = moduleResource(href);
  if (!resource || resource.kind !== 'module') throw new CapabilityError('NOT_FOUND', 'Destino não encontrado.');
  if (resource.slug === 'admin' && !await isPlatformAdmin(database, context.userId)) throw new CapabilityError('FORBIDDEN', 'Acesso restrito à administração.');
  if (resource.slug === 'whatsapp' && !await isWhatsAppEnabled(context.officeId)) throw new CapabilityError('NOT_FOUND', 'Módulo não disponível.');
  if (resource.slug === 'ads' && !await isAdsEnabled(context)) throw new CapabilityError('NOT_FOUND', 'Módulo não disponível.');
  return resource;
}
