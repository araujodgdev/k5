import 'server-only';
import { getDocumentChunks } from './vault';
import type { SourceChunk } from './ai-policy';

export function selectedSources(officeId: string, documentIds: string[], query?: string): SourceChunk[] {
  if (!documentIds.length) return [];
  return getDocumentChunks(officeId, documentIds, query).map(chunk => ({
    id: chunk.id, documentId: chunk.documentId, text: chunk.content, sourceLabel: chunk.sourceLabel,
  }));
}
