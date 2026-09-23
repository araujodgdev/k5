import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const directory = resolve('.data/postgres-migration');
mkdirSync(directory,{recursive:true});
const passwordFile=resolve(directory,'pg-password');
if(!existsSync(passwordFile)) writeFileSync(passwordFile,randomBytes(32).toString('hex'),{mode:0o600});
const password=readFileSync(passwordFile,'utf8').trim();
const postgres = new EmbeddedPostgres({
  databaseDir: resolve(directory, 'cluster'), user: 'k5',
  password,
  port: 55432, authMethod: 'scram-sha-256', persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => {},
});
if (!existsSync(resolve(directory, 'cluster/PG_VERSION'))) await postgres.initialise();
await postgres.start();
const client = postgres.getPgClient();
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='k5_dev'")).rowCount) await client.query('CREATE DATABASE k5_dev');
await client.end();
const url=`postgresql://k5:${password}@127.0.0.1:55432/k5_dev`;
writeFileSync(resolve(directory,'dev.env'),`DATABASE_URL=${url}\nDATABASE_URL_UNPOOLED=${url}\n`,{mode:0o600});
console.log('PostgreSQL local pronto em 127.0.0.1:55432.');
console.log('Conexão privada em .data/postgres-migration/dev.env.');
await new Promise<void>(resolve => {
  process.once('SIGINT', resolve);
  process.once('SIGTERM', resolve);
});
await postgres.stop();
