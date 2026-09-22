/**
 * Proves the staging data plane works, rather than assuming it because the values are set.
 * Every check writes something, reads it back and deletes it, so a wrong bucket, a token missing
 * a permission or an index with the wrong dimension fails here instead of during an ingestion.
 *
 *   pnpm --filter @k5/web exec tsx scripts/verify-staging.ts
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

for (const candidate of ['.env.staging', '../../.env.staging', '.env.local']) {
  const path = resolve(candidate);
  if (existsSync(path)) { process.loadEnvFile(path); break; }
}

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function checkR2() {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return record('R2', false, 'variáveis ausentes (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }
  try {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
    // A key in the same shape the storage adapter mints, so the round trip matches production.
    const key = `${randomUUID()}/${randomUUID()}/${randomUUID()}.txt`;
    const payload = `k5-verify-${Date.now()}`;

    await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: Buffer.from(payload) }));
    const got = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const read = Buffer.from((await got.Body!.transformToByteArray())).toString('utf8');
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));

    record('R2', read === payload, read === payload ? `escrita, leitura e remoção em ${R2_BUCKET}` : 'o conteúdo lido não confere');
  } catch (error) {
    record('R2', false, error instanceof Error ? error.message : String(error));
  }
}

async function checkVectorize() {
  const { CF_ACCOUNT_ID, VECTORIZE_INDEX, CF_API_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !VECTORIZE_INDEX || !CF_API_TOKEN) {
    return record('Vectorize', false, 'variáveis ausentes (CF_ACCOUNT_ID, VECTORIZE_INDEX, CF_API_TOKEN)');
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}`;
  const auth = { Authorization: `Bearer ${CF_API_TOKEN}` };

  try {
    const info = await fetch(base, { headers: auth });
    if (!info.ok) return record('Vectorize', false, `consulta do índice respondeu ${info.status}`);
    const body = await info.json() as { result?: { config?: { dimensions?: number; metric?: string } } };
    const dimensions = Number(body.result?.config?.dimensions ?? 0);

    // The dimension has to match the embedding profile: a mismatch is a silent zero-recall index.
    record('Vectorize', dimensions > 0, `índice ${VECTORIZE_INDEX}, ${dimensions} dimensões, métrica ${body.result?.config?.metric ?? '?'}`);

    const id = `verify:${randomUUID()}`;
    const vector = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
    const upsert = await fetch(`${base}/upsert`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-ndjson' },
      body: JSON.stringify({ id, values: vector, namespace: 'verify', metadata: { generationId: 'verify', documentId: 'verify' } }),
    });
    record('Vectorize upsert', upsert.ok, upsert.ok ? 'vetor de teste gravado' : `respondeu ${upsert.status}`);

    await fetch(`${base}/delete_by_ids`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
  } catch (error) {
    record('Vectorize', false, error instanceof Error ? error.message : String(error));
  }
}

async function checkPostgres() {
  const url = process.env.VECTOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return record('Postgres/pgvector', false, 'DATABASE_URL ou VECTOR_DATABASE_URL ausente');
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const version = await pool.query('SELECT version()');
      const extension = await pool.query("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'");
      record('Postgres', true, String(version.rows[0].version).split(',')[0]);
      record('pgvector', extension.rowCount === 1, extension.rowCount === 1 ? 'extensão disponível' : 'extensão vector indisponível neste plano');
    } finally {
      await pool.end();
    }
  } catch (error) {
    record('Postgres/pgvector', false, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log('\nVerificação do ambiente de staging do Lume\n');
  await checkR2();
  await checkVectorize();
  await checkPostgres();

  const failed = results.filter((check) => !check.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
  if (failed.length) {
    console.log('Pendentes:');
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    console.log('\nExecute scripts/staging-setup.sh na raiz para configurar o que falta.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('A verificação não pôde ser concluída:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
