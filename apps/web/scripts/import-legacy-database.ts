import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresPool } from '../src/lib/db/postgres';
import { migratePostgres } from '../src/lib/db/migrate';

async function main() {
const args = process.argv.slice(2);
const sourceArg = args[args.indexOf('--source')+1];
const envArg = args.includes('--env-file') ? args[args.indexOf('--env-file')+1] : '.env.postgres.local';
if (!args.includes('--source') || !sourceArg) throw new Error('Informe --source com um backup SQLite ou SQL do D1.');
if (existsSync(envArg)) process.loadEnvFile(envArg);
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error('Configure DATABASE_URL_UNPOOLED para o banco de destino vazio.');
const source = resolve(sourceArg);
const legacy = new DatabaseSync(source.endsWith('.sql') ? ':memory:' : source, { readOnly: !source.endsWith('.sql') });
if (source.endsWith('.sql')) {
  // D1 exports tables in arbitrary order. Replay only in this scratch database,
  // then validate every relationship before touching the destination.
  legacy.exec('PRAGMA foreign_keys=OFF');
  legacy.exec(readFileSync(source,'utf8'));
  // A table-filtered D1 export omits indexes, including composite unique keys.
  const reference = new DatabaseSync(':memory:');
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()) reference.exec(readFileSync(new URL(file,directory),'utf8'));
  for (const index of reference.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()) legacy.exec(String(index.sql).replace(/^CREATE (UNIQUE )?INDEX /i,'CREATE $1INDEX IF NOT EXISTS '));
  reference.close();
  const violations = legacy.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) throw new Error(`Legacy backup has ${violations.length} foreign-key violations.`);
  legacy.exec('PRAGMA foreign_keys=ON');
}
const pool = createPostgresPool(url,{max:1});
const quote = (name:string) => `"${name.replaceAll('"','""')}"`;
function normalize(value:unknown,type:string):unknown {
  if (value===null || value===undefined) return null;
  if (type==='timestamp with time zone') {
    const raw = typeof value==='string' && /^\d{12,}$/.test(value) ? Number(value) : value;
    const date = new Date(raw instanceof Date ? raw : typeof raw==='string' && /^\d{4}-\d\d-\d\d \d/.test(raw) ? `${raw.replace(' ','T')}Z` : raw as string|number);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid timestamp in legacy backup.');
    return date.toISOString();
  }
  if (type==='boolean') {
    if (value===true || value===1 || value==='1') return true;
    if (value===false || value===0 || value==='0') return false;
    throw new Error('Invalid boolean in legacy backup.');
  }
  if (type==='bigint'||type==='integer'||type==='smallint') {
    const number=Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('Legacy integer exceeds JavaScript precision.');
    return number;
  }
  if (type==='bytea') return Buffer.from(value as Uint8Array);
  return value;
}
const digest = (rows:unknown[][]) => createHash('sha256').update(rows.map(row=>JSON.stringify(row)).sort().join('\n')).digest('hex');
try {
  await migratePostgres(pool,new URL('../db/postgres/',import.meta.url));
  const client=await pool.connect();
  const report:{table:string;rows:number;checksum:string}[]=[];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('k5.legacy.import'))");
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query('ALTER TABLE notification_event DISABLE TRIGGER notification_event_capture_gate');
    const tables=(await client.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name<>'postgres_migration' ORDER BY table_name")).rows;
    for (const {table_name:table} of tables) {
      if ((await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount) throw new Error(`Destination table is not empty: ${table}`);
    }
    for (const {table_name:table} of tables) {
      if (table==='research_fts' || table==='ai_chat_attachment') continue; // Derived index / feature introduced after D1.
      if (!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Missing legacy table: ${table}`);
      const columns=(await client.query<{column_name:string;data_type:string;is_generated:string}>(
        "SELECT column_name,data_type,is_generated FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",[table])).rows.filter(column=>column.is_generated==='NEVER');
      const names=columns.map(column=>column.column_name);
      const select=names.map(name=>name==='sequence_no' ? 'rowid AS sequence_no' : quote(name)).join(',');
      const rows=legacy.prepare(`SELECT ${select} FROM ${quote(table)}`).all();
      const expected=rows.map(row=>columns.map(column=>normalize(row[column.column_name],column.data_type)));
      const placeholders=names.map((_,i)=>`$${i+1}`).join(',');
      for (const values of expected) await client.query(`INSERT INTO ${quote(table)}(${names.map(quote).join(',')}) VALUES(${placeholders})`,values);
      const actual=(await client.query(`SELECT ${names.map(quote).join(',')} FROM ${quote(table)}`)).rows
        .map(row=>columns.map(column=>normalize(row[column.column_name],column.data_type)));
      const checksum=digest(expected);
      if (actual.length!==expected.length || digest(actual)!==checksum) throw new Error(`Verification failed: ${table}`);
      if (names.includes('sequence_no')) await client.query(`SELECT setval(pg_get_serial_sequence($1,'sequence_no'),COALESCE((SELECT MAX(sequence_no) FROM ${quote(table)}),1),(SELECT COUNT(*)>0 FROM ${quote(table)}))`,[table]);
      report.push({table,rows:rows.length,checksum});
    }
    await client.query(`INSERT INTO research_fts(judgment_id,material_version_id,text_content)
      SELECT m.judgment_id,v.id,c.text_content FROM research_material m
      JOIN research_material_version v ON v.id=m.current_version_id
      JOIN research_chunk c ON c.material_version_id=v.id WHERE m.status='ready' AND v.published_at IS NOT NULL`);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('ALTER TABLE notification_event ENABLE TRIGGER notification_event_capture_gate');
    await client.query('COMMIT');
    const reportPath=resolve(source+'.postgres-report.json');
    writeFileSync(reportPath,JSON.stringify({sourceFile:source,tables:report},null,2),{mode:0o600});
    console.log(`Importação verificada: ${report.length} tabelas, ${report.reduce((sum,item)=>sum+item.rows,0)} registros. Relatório local: ${reportPath}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { legacy.close(); await pool.end(); }
}

try { await main(); }
catch (error) {
  // PostgreSQL errors can include complete rows. Keep private data out of CLI logs.
  const code=error && typeof error==='object' && 'code' in error ? error.code : undefined;
  const diagnostic=typeof code==='string' && /^[A-Z0-9]{5}$/.test(code) ? ` (SQLSTATE ${code})` : '';
  console.error(`Importação não concluída${diagnostic}. Confira o arquivo de origem e use um destino vazio; os registros são importados em uma única transação.`);
  process.exitCode=1;
}
