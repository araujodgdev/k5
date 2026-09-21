import { z } from 'zod';
import type { Capability } from './contracts';
import { verificationReport } from '@/lib/typesafe/verification-contracts';
export const verificationCapabilities = {
  k5_artifacts_get_verification: { module: 'artifacts', effect: 'read', roles: ['administrator', 'lawyer', 'reviewer'],
    description: 'Consulta a verificação semântica da versão do documento. Não representa aprovação jurídica.',
    input: z.object({ artifactId: z.string().min(1).max(64) }), output: z.object({ verification: verificationReport.nullable() }) },
  k5_artifacts_verify: { module: 'artifacts', effect: 'write', roles: ['administrator', 'lawyer'],
    description: 'Enfileira a verificação semântica do documento salvo. Novos parágrafos sem evidências exigem revisão.',
    input: z.object({ artifactId: z.string().min(1).max(64), idempotencyKey: z.string().min(8).max(128).optional() }),
    output: z.object({ verificationId: z.string() }) },
} as const satisfies Record<string, Capability>;
