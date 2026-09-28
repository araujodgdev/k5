import { AsyncLocalStorage } from 'node:async_hooks';

export type WhatsAppFlagBinding = {
  getBooleanValue(key: string, fallback: boolean, context: Record<string, string>): Promise<boolean>;
};

export type WhatsAppEnvironment = Partial<Record<
  | 'ZERNIO_API_KEY'
  | 'ZERNIO_WEBHOOK_SECRET'
  | 'FLAGSHIP_APP_ID'
  | 'FLAGSHIP_EVALUATE_TOKEN'
  | 'CLOUDFLARE_ACCOUNT_ID'
  | 'BETTER_AUTH_URL'
  | 'K5_CREDENTIALS_KEY'
  | 'K5_CREDENTIALS_PREVIOUS_KEYS'
  | 'K5_CREDENTIALS_NEXT_KEY'
  | 'K5_WHATSAPP_REQUESTS_PER_MINUTE'
  | 'K5_WHATSAPP_OFFICE_REQUESTS_PER_MINUTE',
  string
>> & { FLAGS?: WhatsAppFlagBinding; INTEGRATIONS_QUEUE?: { send(message: { kind: 'sweep' }): Promise<void> } };

const environment = new AsyncLocalStorage<WhatsAppEnvironment>();

export function whatsappEnvironment(): WhatsAppEnvironment {
  return environment.getStore() ?? process.env;
}

export function withWhatsAppEnvironment<T>(values: WhatsAppEnvironment, action: () => T): T {
  return environment.run(values, action);
}
