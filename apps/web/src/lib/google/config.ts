import { googleEnvironment } from './environment';

/**
 * Google integration settings. Everything here comes from the server environment; the browser
 * only ever learns whether a feature is available, never a secret.
 */
export const googleModules = ['gmail', 'calendar', 'drive', 'docs'] as const;
export type GoogleModule = (typeof googleModules)[number];

export const moduleLabels: Record<GoogleModule, string> = {
  gmail: 'E-mails (Gmail)', calendar: 'Agenda (Google Calendar)', drive: 'Arquivos (Google Drive)', docs: 'Documentos (Google Docs)',
};

/** Minimal scopes per module, as listed in the plan. Docs edits use drive.file on files the person picked. */
export const moduleScopes: Record<GoogleModule, readonly string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
  calendar: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'],
  drive: ['https://www.googleapis.com/auth/drive.file'],
  docs: ['https://www.googleapis.com/auth/drive.file'],
};
export const identityScopes = ['openid', 'email'] as const;
export const pickerScope = 'https://www.googleapis.com/auth/drive.file';

export function modulesForScopes(granted: readonly string[]): GoogleModule[] {
  const set = new Set(granted);
  return googleModules.filter(module => moduleScopes[module].every(scope => set.has(scope)));
}

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

function publicOrigin() {
  return (googleEnvironment().BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** Null when this environment has no OAuth client: the interface says so instead of failing later. */
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = googleEnvironment().GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = googleEnvironment().GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri = googleEnvironment().GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${publicOrigin()}/api/integrations/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

/** The Picker needs a browser API key restricted by HTTP referrer and the Cloud project number. */
export function googlePickerConfig(): { developerKey: string; appId: string } | null {
  const developerKey = googleEnvironment().GOOGLE_PICKER_API_KEY?.trim();
  const appId = googleEnvironment().GOOGLE_PICKER_APP_ID?.trim();
  return developerKey && appId ? { developerKey, appId } : null;
}

/** Calendar push needs a public HTTPS address; without it the sync falls back to periodic reconciliation. */
export function calendarWebhookUrl(): string | null {
  const value = googleEnvironment().GOOGLE_CALENDAR_WEBHOOK_URL?.trim();
  if (!value) return null;
  try { return new URL(value).protocol === 'https:' ? value : null; } catch { return null; }
}

/** Civil day for daily limits. Offices are in Brazil for now; the counter key is the date string. */
export const usageTimeZone = 'America/Sao_Paulo';
export function usageDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: googleEnvironment().K5_GOOGLE_USAGE_TIMEZONE?.trim() || usageTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
