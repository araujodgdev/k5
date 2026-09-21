import 'server-only';
import { getDocumentChunks } from './vault';
import type { SourceChunk } from './ai-policy';

export async function selectedSources(officeId: string, documentIds: string[], query?: string): Promise<SourceChunk[]> {
  if (!documentIds.length) return [];
  return (await getDocumentChunks(officeId, documentIds, query)).map(chunk => ({
    id: chunk.id, documentId: chunk.documentId, text: chunk.content, sourceLabel: chunk.sourceLabel,
  }));
}
