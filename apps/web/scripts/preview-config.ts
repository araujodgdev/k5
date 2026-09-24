import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export interface PreviewProfile {
  name: string;
  accountId: string;
  workerName: string;
  subdomain: string;
  databaseBranch: string;
  databaseBranchId: string;
  databaseHost: string;
  hyperdriveId: string;
  bucket: string;
  vectorIndex: string;
}

export function previewName(branch: string, explicit?: string) {
  if (explicit !== undefined) {
    if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(explicit)) throw new Error('Use um nome de preview de 2 a 32 caracteres: letras minúsculas, números e hífens.');
    return explicit;
  }
  if (!branch || ['main', 'master', 'HEAD'].includes(branch)) throw new Error('Na branch principal ou detached HEAD, informe --name explicitamente.');
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22);
  return `p-${slug}-${createHash('sha256').update(branch).digest('hex').slice(0, 6)}`;
}

export function validateProfile(profile: PreviewProfile, name: string) {
  if (profile.name !== name || previewName('', name) !== name) throw new Error('Perfil não corresponde ao preview solicitado.');
  if (!/^[a-f0-9]{32}$/.test(profile.accountId) || !/^[a-f0-9]{32}$/.test(profile.hyperdriveId)) throw new Error('IDs de conta/Hyperdrive inválidos.');
  if (profile.databaseBranch !== `k5-preview-${name}` || profile.bucket !== `k5-preview-${name}-vault` || profile.vectorIndex !== `k5-preview-${name}-knowledge`) throw new Error('Banco, bucket e índice devem pertencer exclusivamente ao preview.');
  if (!/^[a-z0-9]+$/.test(profile.databaseBranchId) || !/^[a-z0-9.-]+\.pg\.psdb\.cloud$/.test(profile.databaseHost)) throw new Error('Destino PostgreSQL inválido.');
  for (const value of [profile.workerName, profile.subdomain]) {
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value)) throw new Error('Worker/subdomínio inválido.');
  }
}

/** PlanetScale roles carry the branch ID; reject a staging URL before connecting or migrating. */
export function validateDatabaseUrl(value: string, profile: PreviewProfile) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== profile.databaseHost ||
    !decodeURIComponent(url.username).endsWith(`.${profile.databaseBranchId}`) ||
    url.pathname !== '/postgres' || (url.port && url.port !== '5432') ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    [...url.searchParams.keys()].some(key => key !== 'sslmode')) {
    throw new Error('Conexão recusada: use PostgreSQL direto, com TLS verify-full e papel da branch de preview.');
  }
}

export function previewUrl(profile: PreviewProfile) {
  return `https://${profile.name}-${profile.workerName}.${profile.subdomain}.workers.dev`;
}

export function buildPreviewConfig(profile: PreviewProfile, appDirectory: string) {
  validateProfile(profile, profile.name);
  const settings = {
    vars: {
      NODE_ENV: 'production' as const, PROCESSORS_ENABLED: 'false',
      BETTER_AUTH_URL: previewUrl(profile),
      SENTRY_ENVIRONMENT: `preview-${profile.name}`, SENTRY_TRACES_SAMPLE_RATE: '0.1',
      VAULT_STORAGE_BACKEND: 'r2', VECTOR_INDEX_BACKEND: 'vectorize',
    },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: profile.hyperdriveId }],
    r2_buckets: [{ binding: 'VAULT', bucket_name: profile.bucket }],
    vectorize: [{ binding: 'KNOWLEDGE', index_name: profile.vectorIndex }],
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    observability: { enabled: true, logs: { enabled: true, persist: true }, traces: { enabled: true, persist: true } },
  };
  return {
    name: profile.workerName, account_id: profile.accountId,
    compatibility_date: '2026-09-24', compatibility_flags: ['nodejs_compat'],
    main: resolve(appDirectory, 'src/workers/web-preview.ts'),
    assets: { directory: resolve(appDirectory, 'dist/client'), binding: 'ASSETS', not_found_handling: 'none' },
    upload_source_maps: true,
    secrets: { required: ['BETTER_AUTH_SECRET', 'K5_CREDENTIALS_KEY'] },
    ...settings, previews: settings,
  };
}
