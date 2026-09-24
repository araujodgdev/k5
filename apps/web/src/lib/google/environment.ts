import { AsyncLocalStorage } from 'node:async_hooks';

type GoogleEnvironment = Partial<Record<'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'GOOGLE_OAUTH_REDIRECT_URI' | 'GOOGLE_PICKER_API_KEY' | 'GOOGLE_PICKER_APP_ID' | 'GOOGLE_CALENDAR_WEBHOOK_URL' | 'K5_CREDENTIALS_KEY' | 'K5_CREDENTIALS_PREVIOUS_KEYS' | 'K5_CREDENTIALS_NEXT_KEY' | 'K5_GOOGLE_USAGE_TIMEZONE' | 'BETTER_AUTH_URL', string>>;
const environment = new AsyncLocalStorage<GoogleEnvironment>();
export function googleEnvironment(): GoogleEnvironment { return environment.getStore() ?? process.env; }
export function withGoogleEnvironment<T>(values: GoogleEnvironment, action: () => Promise<T>) { return environment.run(values, action); }
