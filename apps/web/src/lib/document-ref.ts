import { z } from 'zod';

export const documentRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), id: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('case-page'), caseId: z.string().min(1).max(128), id: z.string().min(1).max(128) }),
]);
export type DocumentRef = z.infer<typeof documentRefSchema>;
export function documentKey(ref: DocumentRef) {
  return ref.kind === 'artifact' ? `artifact:${ref.id}` : `case-page:${ref.caseId}:${ref.id}`;
}
export function documentHref(ref: DocumentRef) {
  return ref.kind === 'artifact' ? `/app/documents/${encodeURIComponent(ref.id)}`
    : `/app/vault/cases/${encodeURIComponent(ref.caseId)}/pages/${encodeURIComponent(ref.id)}`;
}
export function documentApi(ref: DocumentRef) {
  return ref.kind === 'artifact' ? `/api/artifacts/${encodeURIComponent(ref.id)}`
    : `/api/cases/${encodeURIComponent(ref.caseId)}/pages/${encodeURIComponent(ref.id)}`;
}
