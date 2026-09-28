import 'server-only';
import { withTransaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { whatsappEnvironment } from './environment';

function budget(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function reserveWhatsAppApiCall(officeId: string) {
  const env = whatsappEnvironment();
  await withTransaction(async tx => {
    for (const { bucket, limit } of [
      { bucket: 'team', limit: budget(env.K5_WHATSAPP_REQUESTS_PER_MINUTE, 60) },
      { bucket: `office:${officeId}`, limit: budget(env.K5_WHATSAPP_OFFICE_REQUESTS_PER_MINUTE, 15) },
    ]) {
      const admitted = await tx.prepare(`INSERT INTO whatsapp_api_budget(bucket,starts_at,used)
        VALUES(?,date_trunc('minute',CURRENT_TIMESTAMP),1)
        ON CONFLICT(bucket) DO UPDATE SET
          starts_at=date_trunc('minute',CURRENT_TIMESTAMP),
          used=CASE WHEN whatsapp_api_budget.starts_at<date_trunc('minute',CURRENT_TIMESTAMP) THEN 1 ELSE whatsapp_api_budget.used+1 END
        WHERE whatsapp_api_budget.starts_at<date_trunc('minute',CURRENT_TIMESTAMP) OR whatsapp_api_budget.used<?
        RETURNING bucket`).get(bucket, limit);
      if (!admitted) throw new CapabilityError('RATE_LIMITED', 'O WhatsApp está processando outras solicitações. Aguarde um minuto.');
    }
  });
}
