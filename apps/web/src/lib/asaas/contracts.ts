import { z } from 'zod';

export const asaasEnvironment = z.enum(['sandbox', 'production']);
export type AsaasEnvironment = z.infer<typeof asaasEnvironment>;

/** What the Lume keeps about the connected account: enough to recognise it, with the document masked. */
export const asaasAccount = z.object({
  name: z.string().min(1).max(500), email: z.string().max(320).nullable(),
  document: z.string().max(40).nullable(), personType: z.string().max(40).nullable(), status: z.string().max(60).nullable(),
});
export type AsaasAccount = z.infer<typeof asaasAccount>;
export const asaasConnection = z.object({
  environment: asaasEnvironment, walletId: z.string(), account: asaasAccount, version: z.string().uuid(), verifiedAt: z.string(),
});
export const asaasStatus = z.object({ canManage: z.boolean(), connection: asaasConnection.nullable() });
export type AsaasStatus = z.infer<typeof asaasStatus>;

export const asaasConnectInput = z.object({
  apiKey: z.string().trim().max(400).refine(value => /^\$aact_[\x21-\x7e]{10,}$/.test(value),
    'Cole a chave de API completa do Asaas. Ela começa com $aact_.'),
  expectedVersion: z.string().uuid().nullable(),
}).strict();
export const asaasVersionInput = z.object({ expectedVersion: z.string().uuid() }).strict();

export function asaasAccountStatusLabel(value: string | null): string {
  switch (value) {
    case 'APPROVED': return 'Aprovada';
    case 'PENDING': return 'Em análise no Asaas';
    case 'DENIED': return 'Reprovada no Asaas';
    case 'AWAITING_ACTION_AUTHORIZATION': return 'Aguardando autorização no Asaas';
    default: return 'Não informada';
  }
}

export function asaasEnvironmentLabel(value: AsaasEnvironment): string {
  return value === 'production' ? 'Produção' : 'Sandbox (testes, sem dinheiro real)';
}
