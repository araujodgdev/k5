import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const args=process.argv.slice(2), command=args[0];
const envFile=process.env.K5_ENV_FILE ?? '.env.local';
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.DATABASE_URL_UNPOOLED && envFile==='.env.postgres.local') process.env.DATABASE_URL=process.env.DATABASE_URL_UNPOOLED;

try {
  const {database,authStore}=await import('../src/lib/database');
  if (command==='status') {
    const rows=await database.prepare('SELECT id,identity,kind,edition,published_on,state,phase,next_bucket,carry_after,record_count,elapsed_ms,started_at,completed_at,error FROM inpi_import ORDER BY started_at DESC LIMIT 10').all();
    const control=await database.prepare('SELECT * FROM inpi_sync WHERE id=1').get();
    const checkpoints=await database.prepare(`SELECT import_id,source,byte_offset,records,rejected,complete FROM inpi_file_checkpoint
      WHERE import_id IN (SELECT id FROM inpi_import ORDER BY started_at DESC LIMIT 10) ORDER BY import_id,source`).all();
    console.log(JSON.stringify({control,imports:rows,checkpoints},null,2));
  } else if (command==='sync') {
    if(envFile==='.env.postgres.local') {
      const {remoteObjectStorage}=await import('../src/lib/storage');
      if(!await remoteObjectStorage()) throw new Error('Configure R2 para arquivar a RPI de produção; a atualização agendada já usa o binding privado.');
    }
    const {syncInpiRpi}=await import('../src/lib/research/trademarks/inpi-sync'); await syncInpiRpi({force:true});
    console.log('RPI verificada.');
  } else if (['capacity','resume','invalidate'].includes(command)) {
    const {withInpiLock,checkInpiCapacity,inpiCapacity}=await import('../src/lib/research/trademarks/inpi-capacity');
    const {InpiStaging}=await import('../src/lib/research/trademarks/inpi-staging');
    const client=await (await authStore()).connect();
    try {
      const changed=await withInpiLock(client,async()=>{
        if(command==='capacity') {
          if(!args[1])throw new Error('Informe o caminho do orçamento JSON medido.');
          const capacity=inpiCapacity.parse(JSON.parse(await readFile(args[1],'utf8')));
          await client.query('UPDATE inpi_sync SET capacity=$1 WHERE id=1',[JSON.stringify(capacity)]);
        } else if(command==='invalidate') {
          const runs=await client.query<{id:string}>("SELECT id FROM inpi_import WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated')");
          for(const run of runs.rows) if(!await new InpiStaging(client,run.id).clean()) throw new Error('Limpeza ainda pendente. Repita invalidate; o corpus publicado continua disponível.');
          await client.query('BEGIN');
          try {
            await client.query('DROP TABLE IF EXISTS inpi_trademark_candidate,inpi_vienna_candidate');
            await client.query("UPDATE inpi_import SET phase='invalidated',state='failed',identity=NULL WHERE kind='baseline' AND identity IS NOT NULL AND phase NOT IN ('done','invalidated')");
            await client.query('COMMIT');
          }catch(error){await client.query('ROLLBACK');throw error;}
        } else {
          await checkInpiCapacity(client);
          await client.query("UPDATE inpi_sync SET suspended=false,attempts=0,error=NULL,failure_code=NULL,resume_condition=NULL,next_check_at=CURRENT_TIMESTAMP WHERE id=1");
        }
        return true;
      });
      if(!changed)throw new Error('Outro importador está em execução.');
      console.log('Controle INPI atualizado. Consulte status antes de executar baseline ou sync.');
    }finally{client.release(true);}
  } else if (command==='baseline') {
    const {importInpiBaseline}=await import('../src/lib/research/trademarks/inpi-baseline');
    const client=await (await authStore()).connect();
    try {
      const completed=await importInpiBaseline(client,{directory:args[1],progress:(label,metrics) => console.log(JSON.stringify({label,...metrics}))});
      console.log(completed ? 'Acervo publicado.' : 'Carga pendente; consulte status e retome após o prazo registrado.');
    } finally {client.release(true);}
  } else throw new Error('Use status, sync, baseline [diretório], capacity <JSON>, resume ou invalidate.');
  await database.close();
} catch (error) {
  console.error('Operação INPI falhou.',{type:error instanceof Error ? error.name : 'unknown',code:error && typeof error==='object' && 'code' in error ? String(error.code).slice(0,10) : undefined});
  process.exitCode=1;
}
