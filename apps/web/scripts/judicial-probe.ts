import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

if (existsSync(resolve('.env.local'))) process.loadEnvFile(resolve('.env.local'));

/**
 * One deliberate request to a real source, to confront its contract with the parser (A1).
 *
 *   pnpm judicial:probe <installationId> --operation listChanges --office <id> --from 2026-09-18 --to 2026-09-18
 *   pnpm judicial:probe <installationId> --operation fetchPublication --office <id> --id <hash> --record djen-producao-amostra
 *
 * Exit codes: 0 conforms, 1 refused or failed, 2 the response has fields the parser does not
 * account for, or lacks fields it requires.
 */

const FIXTURE_DIR = resolve('tests/fixtures/judicial');

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      operation: { type: 'string' },
      office: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      id: { type: 'string' },
      record: { type: 'string' },
      'max-requests': { type: 'string', default: '1' },
    },
  });
  const [installationId] = positionals;
  const maxRequests = Number(values['max-requests']);
  if (!installationId || !values.operation || !values.office || !Number.isInteger(maxRequests) || maxRequests < 1) {
    console.error('Uso: pnpm judicial:probe <installationId> --operation <listChanges|fetchPublication> --office <id>');
    console.error('       [--from AAAA-MM-DD --to AAAA-MM-DD] [--id <publicação>] [--record <nome>] [--max-requests 1]');
    return 1;
  }
  if (values.record && !/^[\w-]+$/.test(values.record)) {
    console.error('--record aceita apenas letras, números, hífen e sublinhado.');
    return 1;
  }

  const { runProbe } = await import('../src/lib/judicial/jobs/probe');
  const result = await runProbe({
    installationId,
    officeId: values.office,
    operation: values.operation as never,
    windowFrom: values.from,
    windowTo: values.to,
    sourcePublicationId: values.id,
    maxRequests,
    record: Boolean(values.record),
  });

  console.log(JSON.stringify({ detail: result.detail, requestsSpent: result.requestsSpent, reports: result.reports }, null, 2));

  if (values.record && result.fixtures.length) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    result.fixtures.forEach((fixture, index) => {
      const name = index === 0 ? values.record! : `${values.record}-p${index + 1}`;
      const extension = fixture.contentType.includes('json') ? 'json' : 'xml';
      writeFileSync(resolve(FIXTURE_DIR, `${name}.${extension}`), fixture.body);
      // The report travels with the fixture so the deterministic suite can re-read and compare.
      writeFileSync(resolve(FIXTURE_DIR, `${name}.report.json`), `${JSON.stringify(fixture.report, null, 2)}\n`);
      console.error(`Amostra gravada: tests/fixtures/judicial/${name}.${extension}`);
    });
  }
  return result.exitCode;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error('Não foi possível concluir o probe.', error instanceof Error ? error.message : '');
  process.exitCode = 1;
});
