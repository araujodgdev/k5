import { ResearchError } from './contracts';

/** Web and collectors use PostgreSQL plus the same R2 bucket; Workers never write local files. */
export async function assertResearchWritableRuntime(): Promise<void> {
  if (process.env.K5_RUNTIME !== 'cloudflare') return;
  const env = await import(/* webpackIgnore: true */ 'cloudflare:workers').then(module=>module.env).catch(()=>({} as Record<string,unknown>));
  if (!env.HYPERDRIVE || !env.VAULT) throw new ResearchError('unsupported',
    'A pesquisa está temporariamente indisponível. Tente novamente em instantes.');
}

export const assertResearchStorageRuntime = assertResearchWritableRuntime;
