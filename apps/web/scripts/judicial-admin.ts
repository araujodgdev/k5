import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

if (existsSync(resolve('.env.local'))) process.loadEnvFile(resolve('.env.local'));

/**
 * Operator CLI for judicial sources. A source reaches production through this command and a
 * versioned sheet on disk — not through a form an office member can fill in — because enabling a
 * court is a decision about permitted use, not a workspace preference.
 *
 *   pnpm judicial:admin list
 *   pnpm judicial:admin register --file db/sources/djen.json
 *   pnpm judicial:admin enable <id> [--live]
 *   pnpm judicial:admin disable <id>
 *
 * `--live` is the separate act of permitting real network egress (section 4.2 step 6). It is
 * refused while any of the five permissions is still unanswered: silence is not authorization.
 */

const permission = z.enum(['permitido', 'restrito', 'proibido', 'nao_esclarecido']);

/** The source sheet from section 4.3, narrowed to the fields the runtime actually enforces. */
const sheetSchema = z.object({
  kind: z.enum(['djen', 'mni', 'ckan', 'jurisprudence_api', 'vocabulary', 'court_portal']),
  courtCode: z.string().min(1).max(40),
  courtName: z.string().min(1).max(200),
  degree: z.enum(['first', 'second', 'superior', 'panel', 'not_applicable']),
  system: z.enum(['pje', 'eproc', 'esaj', 'projudi', 'saj', 'sei', 'proprietary', 'not_applicable']),
  purpose: z.enum(['publications', 'case_tracking', 'jurisprudence', 'vocabulary']),
  baseUrl: z.string().url().nullish(),
  contractVersion: z.string().max(80).nullish(),
  authKind: z.enum(['none', 'public_key', 'institutional', 'delegated_lawyer', 'recipient']).default('none'),
  discoveryStatus: z.enum([
    'candidate', 'documented', 'access_pending', 'spike_approved', 'pilot', 'production', 'degraded', 'suspended',
  ]).default('candidate'),
  permissions: z.object({
    query: permission, cache: permission, documents: permission, redistribution: permission, ai: permission,
  }),
  /** Where the permission above was read from. A claim with no evidence is worth little. */
  permissionEvidence: z.string().max(2000).nullish(),
  allowedHosts: z.array(z.string().min(1)).default([]),
  rateLimitPerMinute: z.number().int().positive().max(600).default(10),
  dailyRequestBudget: z.number().int().positive().max(100_000).default(500),
  coverageFrom: z.string().nullish(),
  coverageTo: z.string().nullish(),
  documentationUrl: z.string().url().nullish(),
  notes: z.string().max(4000).nullish(),
});

function usage(): never {
  console.error('Uso: pnpm judicial:admin <list|register|enable|disable> [...]');
  console.error('  list                          lista as instalações cadastradas');
  console.error('  register --file <ficha.json>  cadastra ou atualiza a partir de uma ficha de fonte');
  console.error('  enable <id> [--live]          habilita a fonte; --live libera o acesso real à rede');
  console.error('  disable <id>                  suspende a fonte, preservando os registros já coletados');
  process.exit(1);
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname; } catch { return null; }
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  const {
    findInstallation, listInstallations, setInstallationStatus, upsertInstallation,
  } = await import('../src/lib/judicial/repositories/installations');
  const { hasConnectorFor } = await import('../src/lib/judicial/connectors');

  if (action === 'list') {
    const installations = listInstallations();
    if (!installations.length) {
      console.log('Nenhuma fonte judicial cadastrada. Use: pnpm judicial:admin register --file <ficha.json>');
      return;
    }
    for (const item of installations) {
      const gates = [
        item.enabled ? 'habilitada' : 'desabilitada',
        item.liveTransportEnabled ? 'acesso real liberado' : 'somente amostras',
        hasConnectorFor(item.kind) ? 'conector implementado' : 'sem conector',
      ].join(', ');
      console.log(`${item.id}\n  ${item.courtCode} · ${item.purpose} · ${item.degree} · ${item.discoveryStatus}\n  ${gates}`);
      console.log(`  uso: consulta=${item.permissions.query} cache=${item.permissions.cache} documentos=${item.permissions.documents} redistribuicao=${item.permissions.redistribution} ia=${item.permissions.ai}`);
    }
    return;
  }

  if (action === 'register') {
    const [flag, file, ...extra] = rest;
    if (flag !== '--file' || !file || extra.length) usage();
    const path = resolve(file);
    if (!existsSync(path)) {
      console.error(`Ficha não encontrada: ${path}`);
      process.exit(1);
    }

    const parsed = sheetSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      console.error('Ficha inválida:');
      for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.') || 'raiz'}: ${issue.message}`);
      process.exit(1);
    }

    const sheet = parsed.data;
    // A base URL whose host is not on the allowlist would be unreachable anyway; saying so here
    // is better than an operator discovering it as a blocked request days later.
    const base = hostOf(sheet.baseUrl);
    const hosts = sheet.allowedHosts.length || !base ? sheet.allowedHosts : [base];
    if (base && !hosts.some((host) => host === base || (host.startsWith('.') && base.endsWith(host)))) {
      console.error(`O host de baseUrl (${base}) não está em allowedHosts. Nenhuma requisição sairia desta instalação.`);
      process.exit(1);
    }

    // Registering never turns a source on. Enabling is a separate command on purpose.
    const installation = upsertInstallation({ ...sheet, allowedHosts: hosts, enabled: false, liveTransportEnabled: false });
    console.log(`Fonte registrada: ${installation.id}`);
    console.log(`  ${installation.courtCode} · ${installation.purpose} · estágio ${installation.discoveryStatus}`);
    console.log('  Continua desabilitada. Use: pnpm judicial:admin enable <id>');
    if (!hasConnectorFor(installation.kind)) {
      console.log(`  Atenção: ainda não há conector implementado para fontes do tipo ${installation.kind}.`);
    }
    return;
  }

  if (action === 'enable' || action === 'disable') {
    const [id, ...flags] = rest;
    if (!id || flags.some((flag) => flag !== '--live')) usage();
    const installation = findInstallation(id);
    if (!installation) {
      console.error('Fonte não encontrada. Use: pnpm judicial:admin list');
      process.exit(1);
    }

    if (action === 'disable') {
      setInstallationStatus(id, 'suspended', false, false);
      console.log(`Fonte suspensa: ${installation.courtCode}. Os registros já coletados foram preservados.`);
      return;
    }

    const live = flags.includes('--live');
    if (live) {
      const unresolved = Object.entries(installation.permissions)
        .filter(([, state]) => state === 'nao_esclarecido')
        .map(([dimension]) => dimension);
      if (unresolved.length) {
        console.error(`Acesso real recusado: condição de uso não esclarecida para ${unresolved.join(', ')}.`);
        console.error('Conclua a descoberta, atualize a ficha e registre novamente antes de liberar o acesso.');
        process.exit(1);
      }
      if (!installation.allowedHosts.length) {
        console.error('Acesso real recusado: a instalação não tem hosts aprovados.');
        process.exit(1);
      }
    }

    setInstallationStatus(id, live ? 'pilot' : installation.discoveryStatus, true, live);
    console.log(`Fonte habilitada: ${installation.courtCode}.`);
    console.log(live
      ? '  Acesso real à rede liberado, restrito aos hosts aprovados desta instalação.'
      : '  Sem acesso real à rede: o conector responde apenas a partir de amostras registradas.');
    return;
  }

  usage();
}

main().catch((error) => {
  // Fixed, secret-free message: a source sheet may reference credentials held elsewhere.
  console.error('Não foi possível concluir a operação.', error instanceof Error ? error.message : '');
  process.exitCode = 1;
});
