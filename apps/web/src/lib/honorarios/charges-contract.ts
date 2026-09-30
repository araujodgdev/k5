import { z } from 'zod';
import { honorarioInstallmentDto } from './contracts';

const id = z.string().min(1).max(64);
export const getChargeInput = z.object({ installmentId: id });
export const prepareChargeInput = getChargeInput.extend({
  version: z.number().int().nonnegative(), pixKey: z.string().trim().max(140).default(''),
  instructions: z.string().trim().max(2000).default(''), boletoDocumentId: id.nullable().default(null),
  remindersEnabled: z.boolean().default(true), idempotencyKey: z.string().min(8).max(128),
}).refine(v => v.pixKey.length > 0 || v.instructions.length > 0 || v.boletoDocumentId !== null,
  'Informe uma chave PIX, instruções de pagamento ou um boleto.');
export const sentChargeInput = getChargeInput.extend({
  version: z.number().int().positive(), channel: z.enum(['whatsapp','email','other']),
  notes: z.string().trim().max(1000).default(''), idempotencyKey: z.string().min(8).max(128),
});
export const chargeDto = z.object({
  installment: honorarioInstallmentDto, officeName: z.string(), beneficiaryName: z.string(),
  version: z.number().int().nonnegative(), pixKey: z.string(), instructions: z.string(),
  boleto: z.object({ id, name: z.string() }).nullable(), remindersEnabled: z.boolean(),
  message: z.string(), pdfUrl: z.string().nullable(),
  history: z.array(z.object({ id, operation: z.enum(['prepare','sent']), channel: z.enum(['whatsapp','email','other']).nullable(),
    notes: z.string(), createdAt: z.iso.datetime({ offset: true }), createdByName: z.string() })),
});
export type HonorarioCharge = z.output<typeof chargeDto>;
