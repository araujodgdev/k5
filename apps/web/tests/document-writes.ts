import './test-setup';
import type { Database } from '../src/lib/database';
import type { Owner } from '../src/lib/ai-store';
import { updatePrivateDocument } from '../src/lib/documents/service';

export function updateArtifact(_db: Database, owner: Owner, id: string, title: string, content: string, version: number, options: { snapshot?: boolean } = {}) {
  return updatePrivateDocument(owner, { id, title, content, version, ...options });
}
