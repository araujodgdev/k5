import { existsSync } from 'node:fs';

const args=process.argv.slice(2), command=args[0];
const envFile=process.env.K5_ENV_FILE ?? '.env.local';
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.DATABASE_URL_UNPOOLED && envFile==='.env.postgres.local') process.env.DATABASE_URL=process.env.DATABASE_URL_UNPOOLED;

try {
  const {database,authStore}=await import('../src/lib/database');
  if (command==='status') {
    const rows=await database.prepare('SELECT kind,edition,published_on,state,record_count,started_at,completed_at,error FROM inpi_import ORDER BY started_at DESC LIMIT 10').all();
    console.log(JSON.stringify(rows,null,2));
  } else if (command==='sync') {
    if(envFile==='.env.postgres.local') {
      const {remoteObjectStorage}=await import('../src/lib/storage');
      if(!await remoteObjectStorage()) throw new Error('Configure R2 para arquivar a RPI de produção; a atualização agendada já usa o binding privado.');
    }
    const {syncInpiRpi}=await import('../src/lib/research/trademarks/inpi-sync'); await syncInpiRpi({force:true});
    console.log('RPI verificada.');
  } else if (command==='baseline') {
    const {importInpiBaseline}=await import('../src/lib/research/trademarks/inpi-baseline');
    const client=await (await authStore()).connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
      await importInpiBaseline(client,{directory:args[1],progress:stage => console.log(stage)});
    } finally {await client.query("SELECT pg_advisory_unlock(hashtext('inpi-corpus-import'))");client.release();}
  } else throw new Error('Use status, sync ou baseline [diretório dos CSVs].');
  await database.close();
} catch (error) {
  console.error('Operação INPI falhou.',{type:error instanceof Error ? error.name : 'unknown',code:error && typeof error==='object' && 'code' in error ? String(error.code).slice(0,10) : undefined});
  process.exitCode=1;
}
