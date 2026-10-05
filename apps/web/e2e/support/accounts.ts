// Test accounts and the HTTP calls that create them. Accounts go through the real Better Auth
// sign-up, which provisions the office in its hook, so a fresh database needs no seed script.

export type Account = { name: string; officeName: string; email: string; password: string };

// The lawyer account every signed-in test restores, in its own office (see auth.setup.e2e.ts).
// E2E_EMAIL and E2E_PASSWORD select an account that already exists, such as verify-lume's.
export const admin: Account = {
  name: 'Administração E2E',
  officeName: process.env.E2E_OFFICE_NAME ?? 'Araújo & Associados Advocacia',
  email: process.env.E2E_EMAIL ?? 'admin@advocacia.test',
  password: process.env.E2E_PASSWORD ?? 'SenhaForte123!@#456',
};

/** A run-unique account, for tests that change credentials or need a second person. */
export function uniqueAccount(label: string): Account {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { name: label, officeName: `${label} Advocacia`, email: `${label.toLowerCase().replace(/\W+/g, '-')}-${suffix}@k5.test`, password: `E2e!${suffix}#Segura2026` };
}

/** Node-side client holding one account's session cookie, for setup calls the UI does not need to show. */
export class ApiSession {
  private readonly cookies = new Map<string, string>();
  // Its own rate-limit bucket on the test server (K5_CLIENT_IP_HEADER in e2e.config.ts). Better Auth
  // only accepts a well-formed IP there, so each session gets a random private address.
  private readonly client = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 254) + 1).join('.')}`;
  constructor(readonly baseUrl: string) {}

  /** The session cookies, for handing this sign-in to the browser. */
  get cookieList() { return [...this.cookies].map(([name, value]) => ({ name, value })); }

  async request(path: string, init: { method?: string; json?: unknown; form?: FormData; origin?: string } = {}) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: init.method ?? (init.json === undefined && init.form === undefined ? 'GET' : 'POST'),
      // State-changing calls need a trusted Origin; `origin` overrides it to prove that check.
      headers: { origin: init.origin ?? new URL(this.baseUrl).origin, 'x-e2e-client': this.client, ...(init.json === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookies.size ? { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}) },
      body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
      redirect: 'manual',
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const name = pair.slice(0, pair.indexOf('=')), value = pair.slice(pair.indexOf('=') + 1);
      if (value && !/max-age=0|expires=thu, 01 jan 1970/i.test(header)) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }

  async json<T>(path: string, init?: { method?: string; json?: unknown }) {
    const response = await this.request(path, init);
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${response.status} ${await response.text()}`);
    return await response.json() as T;
  }

  /** Signs in, creating the account first when it does not exist yet. */
  async signIn(account: Account, options: { acceptLegal?: boolean } = {}) {
    const signIn = await this.request('/api/auth/sign-in/email', { json: { email: account.email, password: account.password } });
    if (!signIn.ok) {
      const signUp = await this.request('/api/auth/sign-up/email', { json: account });
      if (!signUp.ok) throw new Error(`Não foi possível entrar nem cadastrar ${account.email}: HTTP ${signIn.status} / ${signUp.status} ${await signUp.text()}`);
    }
    if (options.acceptLegal !== false) await this.acceptLegal();
    return this;
  }

  /**
   * Accepts the current terms and the Lume's AI notice, which otherwise stand in front of the app
   * and of the chat. Tests that cover those screens use an account that skipped this.
   */
  async acceptLegal() {
    for (const document of ['terms', 'ai_notice']) {
      const response = await this.request('/api/legal/acceptance', { json: { document } });
      if (!response.ok) throw new Error(`Aceite ${document}: HTTP ${response.status} ${await response.text()}`);
    }
  }
}
