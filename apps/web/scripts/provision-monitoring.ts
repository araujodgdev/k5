import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { createPostgresPool } from '../src/lib/db/postgres';

const path = '.data/monitoring/secrets.json';
const schema = z.object({
  MONITOR_EMAIL: z.email(), MONITOR_PASSWORD: z.string().min(32),
  MONITOR_RUN_TOKEN: z.string().min(32), MONITOR_OFFICE_ID: z.string().optional(),
});
mkdirSync('.data/monitoring', { recursive: true });
if (!existsSync(path)) writeFileSync(path, JSON.stringify({
  MONITOR_EMAIL: `synthetic-observability-${randomBytes(6).toString('hex')}@lume.software`,
  MONITOR_PASSWORD: randomBytes(36).toString('base64url'),
  MONITOR_RUN_TOKEN: randomBytes(36).toString('base64url'),
}), { flag: 'wx', mode: 0o600 });
const secrets = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
process.loadEnvFile('.env.postgres.local');
const connection = process.env.PROCESSOR_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!connection) throw new Error('Configure a conexão PostgreSQL do ambiente de produção.');
const pool = createPostgresPool(connection, { max: 1 });
const officeName = 'Lume • Monitoramento sintético';
try {
  const existing = await pool.query('SELECT id FROM "user" WHERE email=$1', [secrets.MONITOR_EMAIL]);
  if (!existing.rowCount) {
    const response = await fetch('https://lume.software/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://lume.software' },
      body: JSON.stringify({ name: 'Monitor automático do Lume', officeName, email: secrets.MONITOR_EMAIL, password: secrets.MONITOR_PASSWORD }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Provisionamento recusado: HTTP ${response.status}.`);
  }
  const result = await pool.query(`SELECT o.id FROM office o JOIN office_member m ON m.office_id=o.id
    JOIN "user" u ON u.id=m.user_id WHERE u.email=$1 AND o.name=$2 AND m.role='administrator'`, [secrets.MONITOR_EMAIL, officeName]);
  const office = z.array(z.object({ id: z.string().min(1) })).length(1).parse(result.rows)[0];
  if (secrets.MONITOR_OFFICE_ID && secrets.MONITOR_OFFICE_ID !== office.id) throw new Error('O escritório sintético mudou. Verifique antes de continuar.');
  secrets.MONITOR_OFFICE_ID = office.id;
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
  console.log(`Escritório sintético isolado verificado. Segredos salvos em ${path}; não publique este arquivo.`);
} finally { await pool.end(); }
