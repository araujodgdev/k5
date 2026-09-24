import { Container, type OutboundHandler } from '@cloudflare/containers';
import { processorBindingRequest, type ProcessorBindings } from './processor-bindings';
import { SENTRY_DSN } from '../lib/observability/settings';

export { ContainerProxy } from '@cloudflare/containers';
export type ProcessorRole = 'documents' | 'judicial';
export interface ProcessorEnv extends ProcessorBindings {
  PROCESSOR_DATABASE_URL: string;
  K5_CREDENTIALS_KEY: string;
  K5_CREDENTIALS_PREVIOUS_KEYS?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
}

export class LumeProcessor extends Container<ProcessorEnv> {
  defaultPort = 8080;
  sleepAfter = '30s';
  private running = false;
  static outboundByHost: Record<string, OutboundHandler> = {
    'k5-bindings': (request, env) => processorBindingRequest(request, env as ProcessorBindings),
  };
  envVars = {
    NODE_ENV: 'production',
    K5_CONTAINER_BINDINGS: 'true',
    VAULT_STORAGE_BACKEND: 'r2',
    VECTOR_INDEX_BACKEND: 'vectorize',
    DATABASE_URL: this.env.PROCESSOR_DATABASE_URL,
    K5_CREDENTIALS_KEY: this.env.K5_CREDENTIALS_KEY,
    K5_CREDENTIALS_PREVIOUS_KEYS: this.env.K5_CREDENTIALS_PREVIOUS_KEYS ?? '',
    GOOGLE_OAUTH_CLIENT_ID: this.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    GOOGLE_OAUTH_CLIENT_SECRET: this.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    SENTRY_DSN: this.env.SENTRY_DSN ?? SENTRY_DSN,
    SENTRY_ENVIRONMENT: this.env.SENTRY_ENVIRONMENT ?? 'staging',
    SENTRY_RELEASE: this.env.SENTRY_RELEASE ?? '',
  };

  async run(role: ProcessorRole): Promise<void> {
    if (role !== 'documents' && role !== 'judicial') throw new Error('Processador inválido.');
    if (!this.env.PROCESSOR_DATABASE_URL || !this.env.K5_CREDENTIALS_KEY) throw new Error('Processador sem configuração de banco ou credenciais.');
    if (this.running) return;
    this.running = true;
    // OCR and provider calls can take longer than the idle timeout. Keep only active jobs alive.
    const heartbeat = setInterval(() => this.renewActivityTimeout(), 15_000);
    try {
      const response = await this.containerFetch(`http://container/run/${role}`, { method: 'POST' });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`Processador ${role} respondeu ${response.status}.`);
    } finally {
      clearInterval(heartbeat);
      this.running = false;
      this.renewActivityTimeout();
    }
  }
}
