import { z } from 'zod';
const id = z.string().uuid();
export const portalFileDto = z.object({ id, name: z.string(), kind: z.enum(['published','upload','proof']), mimeType: z.string(), byteSize: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }), installmentId: z.string().nullable(), createdByName: z.string(), url: z.string() });
export const portalAccessDto = z.object({ id, email: z.email(), state: z.enum(['invited','active','expired','revoked']), version: z.number().int(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(), acceptedAt: z.iso.datetime({ offset: true }).nullable() });
export const portalChargeDto = z.object({ id: z.string(), title: z.string(), number: z.number().int(), dueOn: z.iso.date(), pendingCents: z.number().int(),
  status: z.enum(['pending','partial','received','cancelled']), message: z.string(), pdfUrl: z.string().nullable(), boletoUrl: z.string().nullable() });
export const portalViewDto = z.object({ accessId: id, officeName: z.string(), clientName: z.string(), files: z.array(portalFileDto), charges: z.array(portalChargeDto) });
export const portalChoicesDto = z.object({ accesses: z.array(z.object({ id, officeName: z.string(), clientName: z.string() })) });
export const portalManageDto = z.object({ access: portalAccessDto.nullable(), files: z.array(portalFileDto), artifacts: z.array(z.object({ id: z.string(), title: z.string(), version: z.number().int() })) });
export const invitePortalInput = z.object({ clientId: id, email: z.string().trim().toLowerCase().max(254).pipe(z.email()), version: z.number().int().nonnegative() });
export const revokePortalInput = z.object({ clientId: id, version: z.number().int().positive() });
export const publishChargeInput = z.object({ clientId: id, installmentId: z.string().min(1).max(64), version: z.number().int().positive() });
export const publishArtifactInput = z.object({ clientId: id, artifactId: z.string().min(1).max(64), version: z.number().int().positive(), idempotencyKey: id });
export type PortalView = z.output<typeof portalViewDto>;
export type PortalManage = z.output<typeof portalManageDto>;
