/** Synthetic browser QA only. The database and object store must both be isolated. */
import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';

const dbPath = process.env.DATABASE_PATH;
const storagePath = process.env.RESEARCH_STORAGE_PATH;
if (!dbPath || !/^research-qa-[\w-]+\.sqlite$/.test(basename(dbPath)) ||
    !storagePath || !/^research-qa-[\w-]+-objects$/.test(basename(storagePath)) ||
    resolve(dbPath) === resolve('.data/k5.sqlite')) {
  throw new Error('Use um SQLite research-qa-*.sqlite e um armazenamento research-qa-*-objects isolados.');
}

const [{ database }, { upsertInstallation }, { upsertSourceJudgment }] = await Promise.all([
  import('../src/lib/database'),
  import('../src/lib/judicial/repositories/installations'),
  import('../src/lib/research/catalog'),
]);

const account = await database.prepare(`SELECT u.id AS user_id, m.office_id FROM user u
  JOIN office_member m ON m.user_id=u.id WHERE u.email=? LIMIT 1`)
  .get<{ user_id: string; office_id: string }>('admin@advocacia.test');
if (!account) throw new Error('A conta estável de QA não está presente na cópia do banco.');

const source = await upsertInstallation({
  kind: 'jurisprudence_api', courtCode: 'TJDFT', courtName: 'AMOSTRA DE TESTE · Tribunal fictício',
  degree: 'second', system: 'proprietary', purpose: 'jurisprudence',
  baseUrl: 'https://research-qa.invalid/', authKind: 'none', discoveryStatus: 'pilot',
  permissions: { query: 'permitido', cache: 'permitido', documents: 'permitido',
    redistribution: 'permitido', ai: 'permitido' },
  permissionEvidence: 'Permissões simuladas exclusivamente na cópia local de QA; nenhum tribunal é consultado.',
  allowedHosts: [], enabled: true, liveTransportEnabled: false,
  rateLimitPerMinute: 10, dailyRequestBudget: 20,
  notes: 'AMOSTRA DE TESTE sintética. Sem licença ou origem oficial.',
});

const caseName = 'AMOSTRA DE TESTE · Guarda à avó';
let qaCase = await database.prepare('SELECT id FROM vault_case WHERE office_id=? AND name=? AND deleted_at IS NULL')
  .get<{ id: string }>(account.office_id, caseName);
if (!qaCase) {
  const id = randomUUID();
  await database.prepare('INSERT INTO vault_case(id,office_id,name,description,created_by) VALUES(?,?,?,?,?)')
    .run(id, account.office_id, caseName, 'Dados fictícios para validação isolada de Pesquisa.', account.user_id);
  qaCase = { id };
}

const records = Array.from({ length: 22 }, (_, index) => {
  const n = index + 1;
  const title = `AMOSTRA DE TESTE · Julgado ${String(n).padStart(2, '0')} sobre guarda`;
  const ementa = n === 1
    ? 'AMOSTRA DE TESTE. amostrapesquisa. Guarda de criança pela avó. A decisão fictícia examina vínculo afetivo, cuidado cotidiano e estudo psicossocial.'
    : n === 2
      ? 'AMOSTRA DE TESTE. amostrapesquisa. Guarda à avó recusada em hipótese fictícia de ausência de prova de cuidado estável.'
      : `AMOSTRA DE TESTE. amostrapesquisa. Julgado sintético ${n} sobre guarda e proteção familiar.`;
  return {
    sourceJudgmentId: `AMOSTRA-DE-TESTE-${String(n).padStart(2, '0')}`,
    tribunal: 'TJDFT', courtUnit: 'Turma fictícia', caseNumber: null,
    className: 'Apelação fictícia', rapporteur: null, title,
    decisionDate: '2024-06-21', sourceUpdatedAt: null, sourceUrl: null,
    ementa, fullText: n <= 2 ? `${title}\n\n${ementa}\n\nTexto sintético para verificar leitura, seleção de referência e citação de versão. Não corresponde a decisão judicial.` : null,
    fullTextStatus: n <= 2 ? 'ready' as const : 'unavailable' as const,
  };
});
for (const record of records) await upsertSourceJudgment(source, record);
console.log(JSON.stringify({ synthetic: true, judgments: records.length, caseId: qaCase.id, storage: basename(storagePath) }));
