import './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { authStore } from '../src/lib/database';
import { importInpiBaseline } from '../src/lib/research/trademarks/inpi-baseline';
import { downloadInpiCsv } from '../src/lib/research/trademarks/inpi-download';
import { INPI_BUCKETS, InpiStaging } from '../src/lib/research/trademarks/inpi-staging';
import { objectStorage, storageKey } from '../src/lib/storage';
import { runInpiMaintenance } from '../src/lib/research/trademarks/inpi-sync';
import { databaseFailure } from '../src/lib/research/trademarks/inpi-errors';
import { recordInpiFailure, reserveInpiAttempt } from '../src/lib/research/trademarks/inpi-retry';
import { checkInpiCapacity } from '../src/lib/research/trademarks/inpi-capacity';

function files(count = 2, label = 'Lúme') {
  return {
    'MARCAS_DADOS_BIBLIOGRAFICOS.csv': Buffer.from('codigo_interno,numero_inpi,data_deposito,data_publicacao,data_concessao,data_vigencia,descricao_apresentacao,descricao_natureza,elemento_nominativo,traducao,apostila,codigo_situacao,descricao_situacao\r\n'
      + Array.from({ length: count }, (_, i) => `${i},${800000000+i},2012-07-19,,,,Mista,Produto,"${label}\nMarca ${i}",,Nota,1,Registro de marca em vigor\r\n`).join('')),
    'MARCAS_CLASSIFICACOES_NICE.csv': Buffer.from('codigo_interno,numero_inpi,edicao_nice,classe_nice,especificacao,especificacao_trad\n1,800000000,12,35,Publicidade,\n1,800000000,12,35,Publicidade,\n'),
    'MARCAS_CLASSIFICACOES_VIENA.csv': Buffer.from('codigo_interno,numero_inpi,simbolo,classificacao_viena,revisao_viena\n1,800000000,27.05.01,Letras,4\n'),
    'MARCAS_DEPOSITANTES.csv': Buffer.from('codigo_interno,numero_inpi,nome,estado,pais,cpf_cnpj\n1,800000000,Titular,SP,BR,SEGREDO DESCARTADO\n'),
  };
}
function mockSource(t: test.TestContext, data = files()) {
  const calls: Array<{ file: string; start: number }> = [];
  const source = { data, version: 'v1', calls };
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const file = new URL(String(input)).pathname.split('/').at(-1) ?? '';
    assert.ok(file in source.data);
    const bytes = source.data[file as keyof typeof data];
    const headers = { 'content-length': String(bytes.length), 'last-modified': 'Sat, 26 Sep 2026 10:37:15 GMT', etag: `"${source.version}"` };
    if (options?.method === 'HEAD') return new Response(null, { headers });
    const range = new Headers(options?.headers).get('Range')?.match(/^bytes=(\d+)-(\d+)$/); assert.ok(range);
    const start = Number(range[1]), end = Number(range[2]); calls.push({ file, start });
    return new Response(new Uint8Array(bytes.subarray(start, end+1)), { status: 206, headers: { ...headers, 'content-length': String(end-start+1), 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  });
  return source;
}
async function reset() {
  const pool = await authStore();
  const runs = await pool.query<{ id: string }>('SELECT DISTINCT import_id AS id FROM inpi_staging_object');
  const client = await pool.connect();
  try { for (const run of runs.rows) await new InpiStaging(client, run.id).clean(); }
  finally { client.release(); }
  await pool.query('DROP TABLE IF EXISTS inpi_trademark_candidate,inpi_vienna_candidate,inpi_trademark_previous,inpi_vienna_previous');
  await pool.query('DELETE FROM inpi_trademark_event; DELETE FROM inpi_trademark; DELETE FROM inpi_vienna_term; DELETE FROM inpi_import');
  // Windows defers unlinking relation files until a checkpoint. Other fixture schemas
  // would otherwise dominate pg_database_size's filesystem scan in the full suite.
  await pool.query('CHECKPOINT');
  await pool.query(`UPDATE inpi_sync SET suspended=false,attempts=0,error=NULL,failure_code=NULL,resume_condition=NULL,next_check_at=CURRENT_TIMESTAMP,capacity=$1`,
    [JSON.stringify({ diskBytes: 32*1024**3, otherBytes: 1024**3, appReserveBytes: 2*1024**3,
      databaseBytes: 12*1024**3, candidateBytes: 4*1024**3, walBytes: 8*1024**3, approvedUntil: new Date(Date.now()+3600_000).toISOString() })]);
  return pool;
}
async function resume() { await (await authStore()).query('UPDATE inpi_sync SET suspended=false,attempts=0,next_check_at=CURRENT_TIMESTAMP'); }
async function load(options: Parameters<typeof importInpiBaseline>[1] = {}) {
  const client = await (await authStore()).connect();
  client.on('error', () => undefined);
  try {
    // Other test files use isolated schemas on this server but share the production lock key.
    await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
    return await importInpiBaseline(client, options);
  } finally { client.release(true); }
}

test('migração conserva corpus publicado e retira apenas cargas antigas sem checkpoints', async () => {
  const client = await (await authStore()).connect();
  const schema = `inpi_upgrade_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}",public`);
    await client.query('CREATE TABLE research_trademark_search(id text); CREATE TABLE research_trademark_upload(id text)');
    for (const file of ['0054_inpi_trademark_corpus.sql','0055_inpi_import_manifest.sql','0056_inpi_staging_objects.sql']) {
      await client.query(await readFile(new URL(`../db/postgres/${file}`, import.meta.url), 'utf8'));
    }
    await client.query(`INSERT INTO inpi_import(id,kind,published_on,source_url,state) VALUES
      ('published','baseline','2026-09-26','https://example.test','completed'),('unfinished','baseline','2026-09-27','https://example.test','running')`);
    await client.query("INSERT INTO inpi_trademark(process_number,name,published_on,import_id) VALUES('800000000','Preservada','2026-09-26','published')");
    await client.query(await readFile(new URL('../db/postgres/0057_inpi_bounded_import.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await client.query('SELECT id,state,phase FROM inpi_import ORDER BY id')).rows, [
      { id: 'published', state: 'completed', phase: 'done' }, { id: 'unfinished', state: 'failed', phase: 'invalidated' },
    ]);
    assert.equal((await client.query('SELECT name FROM inpi_trademark')).rows[0].name, 'Preservada');
  } finally { await client.query('ROLLBACK'); client.release(true); }
});

test('baseline inicial, atualização, no-op da mesma identidade e preservação da RPI mais recente', async t => {
  const pool = await reset(), source = mockSource(t);
  assert.equal(await load(), true);
  const first = await pool.query('SELECT * FROM inpi_trademark ORDER BY process_number');
  assert.equal(first.rowCount, 2);
  assert.deepEqual(first.rows[0].nice_classes, [35]); assert.deepEqual(first.rows[0].vienna_codes, ['27.5.1']);
  assert.ok(!JSON.stringify(first.rows).includes('SEGREDO'));
  const downloads = source.calls.length;
  assert.equal(await load(), true); assert.equal(source.calls.length, downloads);
  await pool.query("UPDATE inpi_trademark SET published_on='2026-09-29',latest_edition=2908,situation='Mais recente',fields=fields || '{\"Apostila\":\"Campo recente\"}'");
  source.version = 'v2'; source.data = files(3, 'Nova');
  assert.equal(await load(), true);
  const updated = await pool.query('SELECT * FROM inpi_trademark ORDER BY process_number');
  assert.equal(updated.rowCount, 3); assert.equal(updated.rows[0].situation, 'Mais recente');
  assert.equal(updated.rows[0].fields.Apostila, 'Campo recente'); assert.equal(updated.rows[2].name, 'Nova\nMarca 2');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark_previous')).rows[0].n, 2);
  await pool.query("UPDATE inpi_import SET completed_at=CURRENT_TIMESTAMP-INTERVAL '31 days' WHERE state='completed'; UPDATE inpi_sync SET next_check_at=CURRENT_TIMESTAMP");
  const csvFetch = globalThis.fetch;
  let indexChecks = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    if (String(input) === 'https://revistas.inpi.gov.br/rpi/') {
      indexChecks++;
      return new Response('<tr><td>2026-09-20</td><a href="https://revistas.inpi.gov.br/txt/RM2906.zip">XML</a></tr>');
    }
    return csvFetch(input, options);
  });
  assert.equal(await runInpiMaintenance(), true);
  assert.equal(indexChecks, 1, 'Um snapshot mensal inalterado não deve impedir a verificação semanal da RPI.');
});

test('linhas rejeitadas também avançam checkpoints por bytes sem esperar 50 mil registros', async t => {
  const pool = await reset(), source = mockSource(t);
  const bib = source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'];
  const header = bib.subarray(0, bib.indexOf('\n') + 1);
  const invalid = `1,invalido,,,,,,,${'x'.repeat(128 * 1024)},,,,\r\n`;
  source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'] = Buffer.concat([header, Buffer.from(invalid.repeat(80)), bib.subarray(header.length)]);
  await assert.rejects(load({ progress(_stage, metrics) {
    if (metrics.stage === 'download') throw new Error('Interrupção após checkpoint');
  } }));
  const checkpoint = (await pool.query("SELECT byte_offset,records,rejected FROM inpi_file_checkpoint WHERE source='inpi_stage_bib'")).rows[0];
  assert.equal(Number(checkpoint.records), 0);
  assert.ok(Number(checkpoint.rejected) > 0 && Number(checkpoint.rejected) < 80);
  assert.ok(Number(checkpoint.byte_offset) >= 8 * 1024 * 1024);
  assert.equal(await load(), true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
});

test('checkpoint em fronteira CSV multilinha retoma download parcial e não repete os registros confirmados', async t => {
  const pool = await reset(), source = mockSource(t, files(60_000));
  source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'] = Buffer.concat([Buffer.from('\ufeff'), source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'], Buffer.from('\r\n\r\n')]);
  let interrupted = false;
  await assert.rejects(load({ progress(_stage, metrics) {
    if (metrics.stage === 'download' && metrics.records && metrics.records < 60_000 && !interrupted) { interrupted = true; throw new Error('interrupção'); }
  } }));
  assert.equal(interrupted, true);
  const checkpoint = (await pool.query("SELECT byte_offset,records FROM inpi_file_checkpoint WHERE source='inpi_stage_bib'")).rows[0];
  assert.ok(Number(checkpoint.byte_offset) > 0); assert.equal(Number(checkpoint.records), 50_000);
  const callIndex = source.calls.length;
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 0);
  let peak = 0;
  await load({ progress(_stage, metrics) { peak = Math.max(peak, metrics.scratchBytes ?? 0); } });
  assert.equal(source.calls[callIndex].start, Number(checkpoint.byte_offset));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 60_000);
  assert.ok(peak < 4*1024*1024, `scratch=${peak}`);
});

test('retoma lotes e publicação; leitores continuam no corpus anterior até o COMMIT', async t => {
  const pool = await reset(), source = mockSource(t);
  await load(); source.version = 'v2'; source.data = files(3, 'Atualizada');
  let interrupted = false;
  await assert.rejects(load({ async progress(_stage, metrics) {
    if (metrics.stage === 'build' && metrics.bucket === 2 && !interrupted) { interrupted = true; throw new Error('crash'); }
  } }));
  assert.equal((await pool.query("SELECT next_bucket FROM inpi_import WHERE phase='build'")).rows[0].next_bucket, 3);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
  const before = source.calls.length;
  const buckets: number[] = [];
  await assert.rejects(load({ async progress(_stage, metrics) {
    if (metrics.bucket !== undefined) buckets.push(metrics.bucket);
    if (metrics.stage === 'publish') {
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
      throw new Error('crash before swap');
    }
  } }));
  assert.equal(buckets[0], 3); assert.equal(buckets.at(-1), INPI_BUCKETS-1); assert.equal(source.calls.length, before);
  assert.equal(await load(), true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 3);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_staging_object')).rows[0].n, 0);
});

test('ETag alterado suspende sem misturar cargas e sem tentar novamente a cada disparo', async t => {
  const pool = await reset(), source = mockSource(t);
  await assert.rejects(load({ progress(_stage, metrics) { if (metrics.stage === 'download') throw new Error('stop'); } }));
  source.version = 'changed';
  await assert.rejects(load(), /identidade/);
  const row = (await pool.query('SELECT suspended,failure_code FROM inpi_sync')).rows[0];
  assert.equal(row.suspended, true); assert.equal(row.failure_code, 'source_changed');
  const requests = source.calls.length;
  for (let i = 0; i < 5; i++) assert.equal(await runInpiMaintenance(), false);
  assert.equal(source.calls.length, requests);
});

test('publicação aguarda o leitor; contagem e página pertencem à mesma versão', async t => {
  const pool = await reset(), source = mockSource(t);
  await load(); source.version = 'new'; source.data = files(3, 'Nova');
  const reader = await pool.connect();
  let reached!: () => void;
  const publishing = new Promise<void>(resolve => { reached = resolve; });
  await reader.query('BEGIN');
  await reader.query("SELECT pg_advisory_xact_lock_shared(hashtext('inpi-corpus-publication'))");
  const running = load({ progress(_label, metrics) { if (metrics.stage === 'publish') reached(); } });
  try {
    await Promise.race([publishing, running.then(() => { throw new Error('Publicação terminou antes da barreira.'); })]);
    const count = await reader.query('SELECT count(*)::int AS n FROM inpi_trademark');
    const page = await reader.query('SELECT name FROM inpi_trademark ORDER BY process_number');
    assert.equal(count.rows[0].n, 2); assert.equal(page.rowCount, 2);
    assert.ok(page.rows.every(row => row.name.startsWith('Lúme')));
    await reader.query('COMMIT');
    assert.equal(await running, true);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 3);
  } finally { await reader.query('ROLLBACK'); reader.release(true); await running.catch(() => undefined); }
});

test('objeto corrompido preserva corpus anterior e exige invalidação controlada', async t => {
  const pool = await reset(), source = mockSource(t);
  await load(); source.version = 'v2';
  const storage = await objectStorage();
  t.mock.method(storage, 'get', async () => Buffer.from('corrompido'));
  await assert.rejects(load(), /corrompido/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
  assert.equal((await pool.query('SELECT suspended FROM inpi_sync')).rows[0].suspended, true);
});

test('falta de capacidade impede download; disk full/read-only suspendem; rede tem cinco tentativas', async t => {
  const pool = await reset(); mockSource(t);
  await pool.query('UPDATE inpi_sync SET capacity=NULL');
  await assert.rejects(load(), /Medir o corpus/);
  const client = await pool.connect();
  try {
    for (const code of ['53100','25006','pg_readonly']) {
      await resume(); await reserveInpiAttempt(client);
      await recordInpiFailure(client, Object.assign(new Error('private SQL'), { code }));
      assert.equal((await pool.query('SELECT suspended FROM inpi_sync')).rows[0].suspended, true);
      assert.ok(databaseFailure({ cause: { code } }));
      await assert.rejects(reserveInpiAttempt(client));
    }
    await resume();
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await reserveInpiAttempt(client); await recordInpiFailure(client, new TypeError('fetch failed'));
      waits.push(Number((await pool.query('SELECT extract(epoch FROM next_check_at-CURRENT_TIMESTAMP)::int AS seconds FROM inpi_sync')).rows[0].seconds));
    }
    assert.ok(waits[0] >= 899 && waits[4] >= 14399);
    await assert.rejects(reserveInpiAttempt(client));
  } finally { client.release(); }
});

test('exclusão mútua e recuperação da conexão após término real do backend', async t => {
  const pool = await reset(); mockSource(t);
  const client = await pool.connect(); client.on('error', () => undefined);
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('inpi-corpus-import'))");
    const contender = await pool.connect();
    try { assert.equal(await importInpiBaseline(contender), undefined); } finally { contender.release(true); }
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await pool.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
  } finally { client.release(true); }
  assert.equal(await load(), true);
});

test('download truncado retoma o intervalo; HTTP inválido é diferente de mudança real e tem memória limitada', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(++calls === 1 ? [1] : [1,2,3]), { status: 206, headers: { etag: '"v1"', 'content-range': 'bytes 0-2/3' } }));
  const result: number[] = [];
  for await (const bytes of downloadInpiCsv('https://example.test/', { size: 3, etag: '"v1"' })) result.push(...bytes);
  assert.deepEqual(result, [1,2,3]); assert.equal(calls, 2);
  for (const [status, etag, range, body, code] of [
    [200, '"v1"', null, 'abc', 'INPI_HTTP_INVALID'], [206, '"v2"', 'bytes 0-2/3', 'abc', 'INPI_SOURCE_CHANGED'],
    [206, '"v1"', 'bytes 1-3/3', 'abc', 'INPI_HTTP_INVALID'], [403, null, null, 'denied', 'INPI_HTTP_INVALID'],
    [412, null, null, 'precondition failed', 'INPI_HTTP_INVALID'], [206, null, 'bytes 0-2/3', 'abc', 'INPI_HTTP_INVALID'],
    [206, 'W/"v1"', 'bytes 0-2/3', 'abc', 'INPI_HTTP_INVALID'], [206, 'invalid', 'bytes 0-2/3', 'abc', 'INPI_HTTP_INVALID'],
    [206, '"v1"', 'bytes 0-2/3', 'abcdef', 'INPI_HTTP_INVALID'],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { ...etag ? { etag } : {}, ...range ? { 'content-range': range } : {} } }));
    await assert.rejects(async () => { for await (const bytes of downloadInpiCsv('https://example.test/', { size: 3, etag: '"v1"' })) assert.fail(`Unexpected ${bytes.length} bytes`); }, { code });
  }
});

test('crash durante COPY perde só o lote em andamento e conserva os checkpoints de download', async t => {
  const pool = await reset(), source = mockSource(t, files(3));
  const storage = await objectStorage(), get = storage.get.bind(storage);
  let terminated = false;
  t.mock.method(storage, 'get', async (key: string) => {
    if (!terminated) {
      const copies = await pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'COPY inpi_stage_bib %' AND state='active'");
      assert.equal(copies.rowCount, 1);
      await pool.query('SELECT pg_terminate_backend($1)', [copies.rows[0].pid]); terminated = true;
    }
    return get(key);
  });
  await assert.rejects(load()); assert.equal(terminated, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 0);
  const downloads = source.calls.length;
  assert.equal(await load(), true); assert.equal(source.calls.length, downloads);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 3);
});

test('read-only real recusa reserva antes de downloads e não dispara outras tentativas locais', async t => {
  await reset(); const source = mockSource(t), client = await (await authStore()).connect();
  try {
    await client.query('SET default_transaction_read_only=on');
    await assert.rejects(importInpiBaseline(client), { code: '25006' });
    assert.equal(source.calls.length, 0);
    assert.equal(await runInpiMaintenance(), false);
  } finally { client.release(true); }
});

test('dono desconectado cancela uploads e o sucessor não remove objetos ainda em trânsito', async t => {
  const pool = await reset(); mockSource(t, files(1024));
  const storage = await objectStorage(), put = storage.put.bind(storage), client = await pool.connect();
  client.on('error', () => undefined);
  const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let calls = 0, killed = false;
  t.mock.method(storage, 'put', async (...args: Parameters<typeof put>) => {
    calls++;
    if (!killed) { killed = true; await pool.query('SELECT pg_terminate_backend($1)', [pid]); }
    return put(...args);
  });
  try { await assert.rejects(importInpiBaseline(client)); } finally { client.release(true); }
  assert.ok(calls <= 4, 'Um dono desconectado não inicia outro grupo de PUTs.');
  const before = (await pool.query('SELECT count(*)::int AS n FROM inpi_staging_object')).rows[0].n;
  assert.ok(before > 0);
  assert.equal(await load(), false, 'A janela dos PUTs anteriores ainda não expirou.');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_staging_object')).rows[0].n, before);
  await pool.query("UPDATE inpi_staging_object SET put_started_at=CURRENT_TIMESTAMP-INTERVAL '3 minutes'");
  assert.equal(await load(), true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 1024);
});

test('limite de partição e número bibliográfico duplicado falham antes de multiplicar a agregação', async t => {
  const pool = await reset(), source = mockSource(t);
  await assert.rejects(load({ async progress(_stage, metrics) {
    if (metrics.source === 'inpi_stage_owner') await pool.query('UPDATE inpi_staging_object SET byte_size=40*1024*1024');
  } }), /Partição/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 0);
  await reset(); source.version = 'duplicate';
  const bib = source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'];
  source.data['MARCAS_DADOS_BIBLIOGRAFICOS.csv'] = Buffer.from(bib.toString().replace('800000001','800000000'));
  await assert.rejects(load(), { code: '23505' });
  assert.equal((await pool.query('SELECT suspended FROM inpi_sync')).rows[0].suspended, true);
});

test('falha dentro da troca de tabelas desfaz renomes; retomada publica e mantém grants', async t => {
  const pool = await reset(), source = mockSource(t);
  await pool.query('GRANT SELECT ON inpi_trademark TO PUBLIC');
  await load(); source.version = 'v2'; source.data = files(3, 'Nova versão');
  await pool.query(`CREATE FUNCTION reject_inpi_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.state='completed' AND NEW.kind='baseline' THEN RAISE EXCEPTION 'publication fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $body$`);
  await pool.query(`CREATE CONSTRAINT TRIGGER reject_inpi_publication AFTER UPDATE ON inpi_import
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_inpi_publication()`);
  await assert.rejects(load(), { code: 'P0001' });
  await pool.query('DROP TRIGGER reject_inpi_publication ON inpi_import; DROP FUNCTION reject_inpi_publication()');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
  assert.equal(await load(), true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 3);
  assert.ok((await pool.query("SELECT 1 FROM information_schema.role_table_grants WHERE table_schema=current_schema() AND table_name='inpi_trademark' AND grantee='PUBLIC' AND privilege_type='SELECT'")).rowCount);
});

test('Nice acima de 64 KiB é preservado inteiro dentro do limite de registro de 2 MiB', async t => {
  const pool = await reset(), source = mockSource(t);
  const specification = 'x'.repeat(128*1024);
  source.data['MARCAS_CLASSIFICACOES_NICE.csv'] = Buffer.from('codigo_interno,numero_inpi,edicao_nice,classe_nice,especificacao,especificacao_trad\n1,800000000,12,35,'+specification+',\n');
  assert.equal(await load(), true);
  assert.equal((await pool.query("SELECT fields->>'Produtos e serviços' AS value FROM inpi_trademark WHERE process_number='800000000'")).rows[0].value, '35: '+specification);
});

test('catálogo anterior de Viena não ultrapassa o orçamento da publicação', async t => {
  const pool = await reset(), source = mockSource(t);
  await load(); source.version = 'v2'; source.data = files(3);
  await pool.query("INSERT INTO inpi_vienna_term(code,description) VALUES('1.1',$1)", ['x'.repeat(9 * 1024 * 1024)]);
  await assert.rejects(load(), /Catálogo anterior de Viena/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 2);
  assert.equal((await pool.query('SELECT suspended FROM inpi_sync')).rows[0].suspended, true);
});

test('SQLSTATE disk_full durante um lote desfaz o candidato parcial e suspende o agendamento', async t => {
  const pool = await reset(); mockSource(t);
  await assert.rejects(load({ async progress(_stage, metrics) {
    if (metrics.source !== 'inpi_stage_owner') return;
    await pool.query(`CREATE FUNCTION inpi_test_disk_full() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN RAISE EXCEPTION 'fault injected without filling the host disk' USING ERRCODE='53100'; END $body$`);
    await pool.query('CREATE TRIGGER inpi_test_disk_full BEFORE INSERT ON inpi_trademark_candidate FOR EACH ROW EXECUTE FUNCTION inpi_test_disk_full()');
  } }), { code: '53100' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inpi_trademark_candidate')).rows[0].n, 0);
  assert.deepEqual((await pool.query('SELECT suspended,failure_code FROM inpi_sync')).rows[0], { suspended: true, failure_code: 'disk_full' });
});

test('cancelamento de I/O interrompe leitura e não remove um objeto por exclusão cancelada', async () => {
  const storage = await objectStorage(), key = storageKey(randomUUID(), randomUUID(), 'gz');
  await storage.put(key, Buffer.from('preservado'));
  const controller = new AbortController(); controller.abort();
  try {
    await assert.rejects(storage.get(key, { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(storage.delete(key, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal((await storage.get(key)).toString(), 'preservado');
  } finally { await storage.delete(key); }
});

test('upload sem resposta é cancelado no prazo e não confirma o checkpoint', async t => {
  const pool = await reset(), client = await pool.connect(), id = randomUUID();
  const storage = await objectStorage();
  await client.query("INSERT INTO inpi_import(id,kind,published_on,source_url,state) VALUES($1,'baseline','2026-09-26','https://example.test','running')", [id]);
  await client.query("INSERT INTO inpi_file_checkpoint(import_id,source) VALUES($1,'inpi_stage_owner')", [id]);
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(storage, 'put', async (_key: string, _bytes: Buffer, options?: { signal?: AbortSignal }) => {
    assert.ok(options?.signal);
    entered();
    await new Promise<void>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const row = '"800000000","Titular"\n';
    const failed = assert.rejects(new InpiStaging(client, id).save('inpi_stage_owner', new Map([[0, { rows: [row], bytes: Buffer.byteLength(row) }]]),
      { offset: 100, records: 1, rejected: 0, ordinal: 0, headers: ['numero_inpi','nome'] }), { name: 'AbortError' });
    await started; t.mock.timers.tick(60_001); await failed;
    assert.equal((await client.query('SELECT byte_offset FROM inpi_file_checkpoint WHERE import_id=$1', [id])).rows[0].byte_offset, '0');
    assert.equal((await client.query('SELECT ready FROM inpi_staging_object WHERE import_id=$1', [id])).rows[0].ready, false);
  } finally { t.mock.timers.reset(); client.release(true); }
});

test('prazo absoluto suspende a fatia e conserva o checkpoint para retomada explícita', async t => {
  const pool = await reset(); mockSource(t);
  const schedule = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  t.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
    if (args[1] === 12 * 60_000) expire = () => args[0]();
    return schedule(...args);
  });
  await assert.rejects(load({ progress(_stage, metrics) {
    if (metrics.stage === 'download') { assert.ok(expire); expire(); }
  } }), { code: 'duration' });
  assert.deepEqual((await pool.query('SELECT suspended,failure_code FROM inpi_sync')).rows[0], { suspended: true, failure_code: 'duration' });
  assert.ok(Number((await pool.query("SELECT byte_offset FROM inpi_file_checkpoint WHERE source='inpi_stage_bib'")).rows[0].byte_offset) > 0);
  await resume(); assert.equal(await load(), true);
});

test('orçamento de WAL retido usa a ocupação real e recusa reserva insuficiente', async () => {
  const pool = await reset(), client = await pool.connect();
  try {
    await client.query(`UPDATE inpi_sync SET capacity=capacity || '{"walMeasurement":"retained"}'::jsonb`);
    const metrics = await checkInpiCapacity(client);
    assert.equal(metrics.walMeasurement, 'retained'); assert.ok(metrics.walBytes > 0); assert.equal(metrics.walGeneratedBytes, 0);
    await client.query(`UPDATE inpi_sync SET capacity=capacity || '{"walBytes":1}'::jsonb`);
    await assert.rejects(checkInpiCapacity(client), { code: 'capacity' });
  } finally { client.release(true); }
});
