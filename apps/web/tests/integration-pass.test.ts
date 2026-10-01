import './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrationTasks, runIntegrationPass, IntegrationPassError } from '../src/lib/integration-pass';
import { database, authStore } from '../src/lib/database';

test('limpeza falha, tarefas independentes terminam e o resultado agregado continua falho', async () => {
  const calls: string[] = [];
  await assert.rejects(runIntegrationTasks([
    { name: 'whatsapp_cleanup', async run() { calls.push('cleanup'); throw new Error('storage indisponível'); } },
    { name: 'whatsapp', async run() { calls.push('whatsapp'); return 1; } },
    { name: 'email', async run() { calls.push('email'); return 2; } },
    { name: 'google', async run() { calls.push('google'); return 3; } },
  ]), error => {
    assert.ok(error instanceof IntegrationPassError);
    assert.equal(error.databaseUnavailable, false);
    assert.deepEqual(error.results.map(item => item.status), ['failed','completed','completed','completed']);
    return true;
  });
  assert.deepEqual(calls, ['cleanup','whatsapp','email','google']);
});

test('erro do cluster impede todos os envios posteriores e preserva a falha original', async () => {
  for (const code of ['53100','25006','pg_readonly','08006']) {
    const failure = Object.assign(new Error('private query'), { code });
    await assert.rejects(runIntegrationTasks([
      { name: 'cleanup', async run() { throw failure; } },
      { name: 'send', async run() { assert.fail('Não deve enviar sem gravar a reserva de idempotência.'); } },
    ]), error => {
      assert.ok(error instanceof IntegrationPassError);
      assert.equal(error.databaseUnavailable, true);
      const failed = error.results[0]; assert.equal(failed.status, 'failed');
      if (failed.status === 'failed') assert.equal(failed.error, failure);
      assert.ok(!error.errors[0].message.includes('private query'));
      assert.equal(error.results[1].status, 'skipped'); return true;
    });
  }
});

test('passagem concorrente saudável não abre o circuito de indisponibilidade por quinze minutos', async () => {
  const pool = await authStore();
  await pool.query('UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const first = runIntegrationPass(database, [{ name: 'first', async run() { entered(); await gate; } }]);
  await started;
  try {
    await assert.rejects(runIntegrationPass(database, [{ name: 'second', async run() { assert.fail(); } }]), error => {
      assert.ok(error instanceof IntegrationPassError); assert.equal(error.databaseUnavailable, false);
      assert.deepEqual(error.results, [{ name: 'second', status: 'skipped', reason: 'pass_reserved' }]); return true;
    });
  } finally { release(); await first; }
  let called = false;
  await runIntegrationPass(database, [{ name: 'next', async run() { called = true; } }]);
  assert.equal(called, true);
});

test('falha de conexão do armazenamento não bloqueia tarefas quando o banco confirma escrita', async () => {
  let probes = 0, sends = 0;
  await assert.rejects(runIntegrationTasks([
    { name: 'cleanup', async run() { throw Object.assign(new Error('storage socket'), { code: 'ECONNRESET' }); } },
    { name: 'email', async run() { sends++; } },
  ], async () => { probes++; }), error => {
    assert.ok(error instanceof IntegrationPassError); assert.equal(error.databaseUnavailable, false); return true;
  });
  assert.equal(probes, 1); assert.equal(sends, 1);
  await assert.rejects(runIntegrationTasks([
    { name: 'connection', async run() { throw new Error('Connection terminated unexpectedly'); } },
    { name: 'send', async run() { assert.fail('Banco sem escrita.'); } },
  ], async () => { throw new Error('Socket closed without SQLSTATE'); }), error => {
    assert.ok(error instanceof IntegrationPassError); assert.equal(error.databaseUnavailable, true);
    assert.equal(error.results[1].status, 'skipped'); return true;
  });
});

test('trabalho pesado no Node não bloqueia a passagem saudável de WhatsApp e e-mail', async () => {
  await (await authStore()).query('UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const heavy = runIntegrationPass(database, [{ name: 'drive_import', async run() { entered(); await gate; } }], 'node');
  await started;
  try {
    const results = await runIntegrationPass(database, [{ name: 'whatsapp', async run() { return 'sent'; } }]);
    assert.deepEqual(results, [{ name: 'whatsapp', status: 'completed', value: 'sent' }]);
    await assert.rejects(runIntegrationPass(database, [{ name: 'drive_import', async run() { assert.fail(); } }], 'node'), IntegrationPassError);
  } finally { release(); await heavy; }
});

test('circuito reserva uma única passagem e mantém espera durável após falha de escrita', async () => {
  const pool = await authStore();
  await pool.query('UPDATE integration_circuit SET probe_after=CURRENT_TIMESTAMP');
  let sends = 0;
  await assert.rejects(runIntegrationPass(database, [
    { name: 'read_only', async run() { throw Object.assign(new Error('read only'), { code: '25006' }); } },
    { name: 'send', async run() { sends++; } },
  ]), IntegrationPassError);
  assert.equal((await pool.query("SELECT probe_after>CURRENT_TIMESTAMP+INTERVAL '14 minutes' AS delayed FROM integration_circuit WHERE id=1")).rows[0].delayed, true);
  for (let i = 0; i < 10; i++) await assert.rejects(runIntegrationPass(database, [{ name: 'send', async run() { sends++; } }]), IntegrationPassError);
  assert.equal(sends, 0);
});
