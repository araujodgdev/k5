import { z } from 'zod';

export const signatureMethod = z.enum(['email', 'certificate']);
export const signatureState = z.enum(['creating', 'uncertain', 'pending', 'signed', 'cancelled']);
export const signatureConnectionDto = z.object({ connected: z.boolean(), enabled: z.boolean(), environment: z.enum(['sandbox', 'production']), version: z.number().int(), webhookUrl: z.url().nullable() });
export const signatureConnectionInput = z.object({ apiKey: z.string().trim().min(16).max(512).regex(/^[A-Za-z0-9._-]+$/).optional(),
  environment: z.enum(['sandbox', 'production']), enabled: z.boolean(), version: z.number().int().nonnegative() });
export const requestSignatureInput = z.object({ clientId: z.string().uuid(), fileId: z.string().uuid(), method: signatureMethod, idempotencyKey: z.string().uuid() });
export const signatureDto = z.object({ id: z.string().uuid(), fileId: z.string().uuid(), name: z.string(), recipientEmail: z.email(), method: signatureMethod,
  environment: z.enum(['sandbox', 'production']), state: signatureState, createdAt: z.string(), checkedAt: z.string().nullable(), signedAt: z.string().nullable(),
  signUrl: z.string().nullable(), downloadUrl: z.string().nullable(), evidenceUrl: z.string(), providerToken: z.string().nullable() });
export type Signature = z.output<typeof signatureDto>;
export const signatureLabels = { creating: 'Envio em andamento', uncertain: 'Envio sem confirmação', pending: 'Aguardando assinatura', signed: 'Assinado no provedor', cancelled: 'Solicitação cancelada' } satisfies Record<Signature['state'], string>;
