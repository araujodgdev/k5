import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main() {
  const { processNextVaultDocument } = await import('../src/lib/vault');
  const { processNextRun } = await import('../src/lib/document-workflows');
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  console.log('Worker K5 ativo. Aguardando documentos e tarefas.');
  do {
    try {
      const ingested = await processNextVaultDocument();
      const processed = await processNextRun();
      if (process.argv.includes('--once')) break;
      if (!ingested && !processed) await new Promise(resolve => setTimeout(resolve, 1500));
    } catch {
      console.error('Falha no worker. Confira banco, ambiente e configuração.');
      if (process.argv.includes('--once')) { process.exitCode = 1; break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } while (!stopping);
}
main().catch(() => { console.error('Não foi possível iniciar o worker. Execute pnpm db:setup.'); process.exitCode = 1; });
