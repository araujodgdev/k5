import type { VaultDocument } from './vault';

export const documentPageSize = 50;

export async function fetchVaultDocumentPage(query: string, offset: number, signal?: AbortSignal) {
  const response = await fetch(`/api/vault/documents?${query}&limit=${documentPageSize}&offset=${offset}`, { cache: 'no-store', signal });
  const result = await response.json().catch(() => null) as { documents?: VaultDocument[]; total?: number; error?: string } | null;
  if (!response.ok || !Array.isArray(result?.documents) || typeof result.total !== 'number') throw new Error(typeof result?.error === 'string' ? result.error : 'Não foi possível carregar os arquivos.');
  return { documents: result.documents, total: result.total };
}
