import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

if (existsSync(resolve('.env.local'))) process.loadEnvFile(resolve('.env.local'));

/**
 * National vocabulary (TPU/SGT) for the operator (A5).
 *
 *   pnpm judicial:vocab import --file <catalogo.json> --version <v>
 *   pnpm judicial:vocab describe --kind movement --code <c>
 *
 * A version is immutable: importing it again is inert, and different content under the same
 * version is refused. Importing never touches movements already collected.
 */

function usage(): number {
  console.error('Uso: pnpm judicial:vocab import --file <catalogo.json> --version <versão>');
  console.error('     pnpm judicial:vocab describe --kind <class|subject|movement> --code <código>');
  return 1;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { file: { type: 'string' }, version: { type: 'string' }, kind: { type: 'string' }, code: { type: 'string' } },
  });
  const [action] = positionals;
  const vocabulary = await import('../src/lib/judicial/normalization/vocabulary');

  if (action === 'import') {
    if (!values.file || !values.version || !/^[\w.-]{1,40}$/.test(values.version)) return usage();
    const path = resolve(values.file);
    if (!existsSync(path)) {
      console.error(`Arquivo não encontrado: ${path}`);
      return 1;
    }
    const parsed = vocabulary.vocabularyFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      console.error('Catálogo inválido:');
      for (const issue of parsed.error.issues.slice(0, 20)) console.error(`  ${issue.path.join('.') || 'raiz'}: ${issue.message}`);
      return 1;
    }
    const outcome = await vocabulary.importVocabulary(parsed.data, values.version);
    if (!outcome.ok) {
      console.error(`Versão ${outcome.version} já importada com conteúdo diferente; nada foi gravado.`);
      console.error(`  Termos divergentes: ${outcome.conflicts.slice(0, 20).join(', ')}${outcome.conflicts.length > 20 ? '…' : ''}`);
      console.error('  Importe o catálogo novo com outra versão.');
      return 1;
    }
    console.log(`Versão ${outcome.version}: ${outcome.inserted} termo(s) novo(s), ${outcome.unchanged} inalterado(s).`);
    console.log('  Movimentos já coletados não foram alterados.');
    return 0;
  }

  if (action === 'describe') {
    if (!values.code || !vocabulary.vocabularyKinds.includes(values.kind as never)) return usage();
    const rows = await vocabulary.describeTerm(values.kind as never, values.code);
    if (!rows.length) {
      console.log(`Código ${values.code} (${values.kind}) não está no catálogo. Movimentos com ele mantêm o código e o texto originais.`);
      return 0;
    }
    for (const row of rows) {
      const validity = row.valid_to ? `vigente de ${row.valid_from ?? '—'} a ${row.valid_to}` : `vigente desde ${row.valid_from ?? '—'}`;
      console.log(`${row.version}  ${row.label}  (${validity}${row.parent_code ? `, pai ${row.parent_code}` : ''})`);
    }
    return 0;
  }

  return usage();
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error('Não foi possível concluir a operação.', error instanceof Error ? error.message : '');
  process.exitCode = 1;
});
