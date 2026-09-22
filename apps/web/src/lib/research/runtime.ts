import { ResearchError } from './contracts';

async function usesCloudflareBindings(): Promise<boolean> {
  if (process.env.K5_RUNTIME === 'cloudflare') return true;
  try {
    const { env } = await import(/* webpackIgnore: true */ 'cloudflare:workers');
    return !!env?.DB;
  } catch {
    return false;
  }
}

/** The Node workers and web must share the same SQLite file and corpus storage in this cycle. */
export async function assertResearchWritableRuntime(): Promise<void> {
  if (await usesCloudflareBindings()) throw new ResearchError('unsupported',
    'Pesquisa externa aguarda workers conectados ao mesmo D1 e armazenamento do ambiente.');
}

/** The per-request Workers VFS cannot hold public originals written by the Node collectors. */
export async function assertResearchStorageRuntime(): Promise<void> {
  if (await usesCloudflareBindings()) throw new ResearchError('unsupported',
    'O download do original ainda não está disponível neste ambiente. Consulte o texto do julgado no acervo.');
}
