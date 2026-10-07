import { z } from 'zod';
import type { UIMessage } from 'ai';
import type { MessageScope } from './lume-workspace';
import { documentRefSchema } from './document-ref';

export const messageScopeSchema = z.object({
  canvasHref: z.string().max(2048).optional(),
  caseId: z.string().min(1).max(128).optional(),
  documentIds: z.array(z.string()).max(100),
  researchReferenceIds: z.array(z.string()).max(30),
  document: documentRefSchema.optional(),
  selection: z.object({ document: documentRefSchema, excerpt: z.string().trim().min(1).max(4000) }).optional(),
});
const legacyScope = messageScopeSchema.omit({ document: true, selection: true }).extend({
  version: z.literal(1), label: z.string().max(1000), openDocumentId: z.string().optional(),
  selection: z.object({ artifactId: z.string(), excerpt: z.string().max(4000) }).optional(),
}).transform(({ openDocumentId, selection, ...rest }) => ({ ...rest, version: 2 as const,
  ...(openDocumentId ? { document: { kind: 'artifact' as const, id: openDocumentId } } : {}),
  ...(selection ? { selection: { document: { kind: 'artifact' as const, id: selection.artifactId }, excerpt: selection.excerpt } } : {}),
}));
export const storedMessageScopeSchema = z.union([messageScopeSchema.extend({ version: z.literal(2), label: z.string().max(1000) }), legacyScope]);

export function storedMessageScope(message: UIMessage | undefined) {
  const metadata = message?.metadata;
  const parsed = storedMessageScopeSchema.safeParse(metadata && typeof metadata === 'object' && 'lumeScope' in metadata ? metadata.lumeScope : undefined);
  return parsed.success ? parsed.data : null;
}

/** A retry or regeneration answers the original stored user turn, never the currently visible canvas. */
export function requestedMessageScope(stored: UIMessage[], incomingId: string, trigger: string | undefined, requested: MessageScope): MessageScope {
  const original = stored.find(message => message.id === incomingId && message.role === 'user');
  if (original) {
    const scope = storedMessageScope(original);
    if (!scope) throw new Error('Esta mensagem é anterior ao contexto por envio. Envie um novo pedido para escolher o contexto.');
    return messageScopeSchema.parse(scope);
  }
  if (trigger === 'regenerate-message') throw new Error('A mensagem original não foi encontrada. Reabra a conversa.');
  return messageScopeSchema.parse(requested);
}

export function accessLost(status: number) { return status === 401 || status === 403 || status === 404; }

export class ConversationReadError extends Error {
  constructor(readonly status: number) { super(status === 401 ? 'Entre novamente para continuar.' : 'Não foi possível abrir esta conversa.'); }
}
