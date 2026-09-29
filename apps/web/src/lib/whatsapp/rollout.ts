import { evaluateBooleanFlag } from '@/lib/flagship';
import { whatsappEnvironment } from './environment';
import { whatsappTransport } from './transport';

export function isWhatsAppEnabled(officeId: string): Promise<boolean> {
  if (!officeId) return Promise.resolve(false);
  return evaluateBooleanFlag('whatsapp-integration', { office_id: officeId, targetingKey: officeId }, whatsappEnvironment(), whatsappTransport());
}
