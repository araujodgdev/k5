import 'server-only';
import { database } from './database';
import { ApiError } from './api-error';
import { ownedArtifact } from './ai-store';
import { selectedResearchSources } from './ai-sources';
import { authorizedCanvasResource } from './canvas-resources';
import { caseAccess } from './collaboration/access';
import { scopeCapability } from './collaboration/capability-access';
import { assertCapabilityAllowed, type WorkspaceContext } from './application/context';
import { findVaultCase } from './vault';
import type { MessageScope, StoredMessageScope } from './lume-workspace';
import { documentKey } from './document-ref';
import { getPage } from './case-pages/service';

export async function authorizeMessageScope(context: WorkspaceContext, input: MessageScope): Promise<StoredMessageScope> {
  const resource = input.canvasHref ? await authorizedCanvasResource(context, input.canvasHref) : null;
  const document = resource?.kind === 'document' ? resource.document : input.document;
  const caseId = resource?.kind === 'case' || resource?.kind === 'file' ? resource.caseId ?? undefined : document?.kind === 'case-page' ? document.caseId : input.caseId;
  const documentIds = [...new Set([...input.documentIds, ...(resource?.kind === 'file' ? [resource.documentId] : [])])];
  if (input.caseId && caseId !== input.caseId) throw new ApiError(400, 'O contexto não corresponde ao caso aberto.');
  if (input.document && (!document || documentKey(document) !== documentKey(input.document))) throw new ApiError(400, 'O contexto não corresponde ao documento aberto.');
  if (input.researchReferenceIds.length && !caseId) throw new ApiError(400, 'Selecione o caso das referências.');
  await assertCapabilityAllowed(await scopeCapability(context, 'k5_knowledge_search', { caseId, documentIds }), 'k5_knowledge_search');
  if (input.researchReferenceIds.length) await selectedResearchSources(context, caseId!, input.researchReferenceIds);
  let label = resource?.title ?? 'Escritório';
  if (caseId && resource?.kind !== 'case' && resource?.kind !== 'file') {
    const access = await caseAccess(context.userId, caseId);
    const caseLabel = (await findVaultCase(access.officeId, caseId, context.userId))?.name ?? 'Caso';
    label = resource ? `${resource.title} · ${caseLabel}` : caseLabel;
  }
  if (document) {
    const record = document.kind === 'case-page' ? (await getPage(context, { caseId: document.caseId, pageId: document.id })).page : await ownedArtifact(database, context, document.id);
    if (!record) throw new ApiError(404, 'Documento não encontrado ou acesso removido.');
    if (!resource) label = record.title;
  }
  if (input.selection && (!document || documentKey(input.selection.document) !== documentKey(document))) throw new ApiError(400, 'Selecione um trecho do documento aberto.');
  const count = documentIds.length + input.researchReferenceIds.length;
  if (count) label += ` · ${count} fonte${count === 1 ? '' : 's'}`;
  return { version: 2, label, canvasHref: resource?.href, caseId, documentIds, researchReferenceIds: [...input.researchReferenceIds], document,
    ...(input.selection ? { selection: { ...input.selection } } : {}) };
}
