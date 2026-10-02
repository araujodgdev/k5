import { existsSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

// K5_E2E_URL points the suite at a server started elsewhere (the verify-k5 instance, a preview).
// Without it the runner starts Next.js itself: `next start` over the CI build, `next dev` locally,
// attaching to a dev server that is already running on port 3000.
const external = process.env.K5_E2E_URL;
const ci = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
// Next.js reads .env.local on its own; the suite also needs DATABASE_URL for its read-only checks.
if (!external && !ci && existsSync('.env.local')) process.loadEnvFile('.env.local');

// The server process gets only these variables; model keys and test credentials stay out of the app.
const serverEnv = Object.fromEntries(['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'K5_CREDENTIALS_KEY',
  'SENTRY_ENABLED', 'NEXT_PUBLIC_SENTRY_ENABLED', 'K5_NEXT_DIST_DIR']
  .flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));

// Each worker is one client with its own address on the test server's auth rate limits, as each
// person is behind Cloudflare. The config is imported once per worker, so the value differs per worker.
const workerClient = `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 254) + 1).join('.')}`;

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });

export default {
  tests: 'e2e/**/*.e2e.ts',
  // CI keeps .e2e/cache/ between runs (actions/cache), so verified agent steps replay without model calls.
  cache: 'read-write',
  // `next dev` compiles each route on first use; the first visit to a page can take tens of seconds.
  assertionTimeout: ci || external ? 10_000 : 30_000,
  targets: [{
    name: 'web',
    engine: web({ viewport: { width: 1280, height: 844 }, headers: { 'x-e2e-client': workerClient } }),
    app: external ? { url: external } : {
      url: 'http://localhost:3000',
      readyUrl: 'http://localhost:{port}/sign-in',
      command: {
        executable: process.execPath,
        args: ['node_modules/next/dist/bin/next', ci ? 'start' : 'dev', '--port', '{port}'],
        // Auth rate limits key on a trusted client-IP header; without one every test shares a single
        // bucket. Only this test server trusts it, and each ApiSession sends its own value.
        env: { ...serverEnv, K5_CLIENT_IP_HEADER: 'x-e2e-client', NEXT_TELEMETRY_DISABLED: '1' },
        startupTimeout: 180_000,
        log: '.e2e/logs/app.log',
        reuseExisting: true,
      },
    },
  }],
  agents: {
    default: {
      model: openai('gpt-6-luna'),
      system: 'Você é um QA cuidadoso testando o Lume, um aplicativo de escritório de advocacia em português do Brasil. '
        + 'Use os rótulos exatamente como aparecem na tela e confirme cada resultado antes de terminar.',
      context: 'Lume é o assistente e o nome do produto. "Escritório" reúne Tarefas, Clientes e Associados em /app/agenda; '
        + '"Cofre" guarda casos e arquivos em /app/vault. No celular, as seções extras ficam no botão "Mais".',
    },
  },
} satisfies E2EConfig;
