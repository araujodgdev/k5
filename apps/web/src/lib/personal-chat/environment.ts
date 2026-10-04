import { AsyncLocalStorage } from 'node:async_hooks';

export type PersonalChatEnvironment = Partial<Record<
  | 'CLOUDFLARE_ACCOUNT_ID'
  | 'CLOUDFLARE_EMAIL_API_TOKEN'
  | 'TISES_MESSAGES_FROM'
  | 'BETTER_AUTH_URL'
  | 'K5_CREDENTIALS_KEY'
  | 'K5_CREDENTIALS_PREVIOUS_KEYS'
  | 'K5_CREDENTIALS_NEXT_KEY',
  string
>> & {
  INTEGRATIONS_QUEUE?: { send(message: { kind: 'sweep' }): Promise<void> };
  /** Cloudflare Email Service `send_email` binding of the web Worker; no API token involved. */
  EMAIL?: SendEmailBinding;
};

export type SendEmailBinding = {
  send(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ messageId?: string }>;
};

const environment = new AsyncLocalStorage<PersonalChatEnvironment>();

export function personalChatEnvironment(): PersonalChatEnvironment {
  return environment.getStore() ?? process.env;
}

export function withPersonalChatEnvironment<T>(values: PersonalChatEnvironment, action: () => T): T {
  return environment.run(values, action);
}
