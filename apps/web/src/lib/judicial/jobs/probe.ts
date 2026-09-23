import 'server-only';
import { database } from '@/lib/database';
import { ConnectorError, isWorkerSafe, permits, type ConnectorOperation } from '../contracts';
import { connectorFor, currentTransport, type Transport } from '../connectors';
import { compareToParser, conformanceExitCode, type ConformanceReport } from '../connectors/conformance';
import { sanitizeForFixture } from '../connectors/sanitize';
import { findInstallation } from '../repositories/installations';
import { recordAudit } from '../repositories/audit';
import { reserveRequestBudget } from './queue';

/**
 * One deliberate request to a real source, outside the worker, to confront its contract (A1).
 * It goes through the same transport guards and the same budget ledger as the worker: it is the
 * only authorized way to spend a request by hand, not a way around the gates.
 */

export type ProbeOptions = {
  installationId: string;
  officeId: string;
  operation: ConnectorOperation;
  windowFrom?: string;
  windowTo?: string;
  sourcePublicationId?: string;
  /** Explicit ceiling on requests. Defaults to one; anything above is the operator's choice. */
  maxRequests?: number;
  /** When set, the sanitized payloads come back ready to be written as fixtures. */
  record?: boolean;
};

export type ProbeResult = {
  /** 0 conforms, 1 refused or failed, 2 the response diverges from the parser. */
  exitCode: 0 | 1 | 2;
  detail: string;
  reports: ConformanceReport[];
  requestsSpent: number;
  fixtures: Array<{ contentType: string; body: string; report: ConformanceReport }>;
};

const PROBE_OPERATIONS: ConnectorOperation[] = ['listChanges', 'fetchPublication'];

export async function runProbe(options: ProbeOptions, transport: Transport = currentTransport()): Promise<ProbeResult> {
  const maxRequests = Math.max(1, Math.floor(options.maxRequests ?? 1));
  const refused = (detail: string): ProbeResult => ({ exitCode: 1, detail, reports: [], requestsSpent: 0, fixtures: [] });

  const office = await database.prepare('SELECT id FROM office WHERE id = ?').get(options.officeId);
  // Without an office there is nobody to charge the request to and nowhere to audit it.
  if (!office) return refused('Escritório não encontrado.');

  const installation = await findInstallation(options.installationId);
  const audit = (outcome: 'ok' | 'denied' | 'error') => recordAudit({
    officeId: options.officeId,
    actor: 'worker',
    action: 'judicial.probe',
    subjectKind: 'installation',
    subjectId: options.installationId,
    installationId: installation?.id ?? null,
    purpose: options.operation,
    outcome,
  });
  const deny = async (detail: string) => { await audit('denied'); return refused(detail); };

  if (!installation) return deny('Fonte não encontrada.');
  if (!installation.enabled || !installation.liveTransportEnabled) {
    return deny('A fonte precisa estar habilitada e com acesso real liberado (enable --live).');
  }
  if (!permits(installation.permissions, 'query')) return deny('Condição de uso para consulta não está como permitido.');
  if (options.record && !permits(installation.permissions, 'cache')) {
    return deny('Gravar amostra exige permissão de cache como permitido.');
  }
  if (!PROBE_OPERATIONS.includes(options.operation)) return deny(`O probe não executa ${options.operation}.`);

  let requestsSpent = 0;
  const captured: Array<{ contentType: string; body: string }> = [];
  const budgeted: Transport = {
    mode: transport.mode,
    async request(inst, path, init) {
      if (requestsSpent >= maxRequests) {
        throw new ConnectorError('partial', `Limite de ${maxRequests} requisição(ões) do probe atingido.`);
      }
      while (true) {
        const budget = await reserveRequestBudget(options.officeId, inst, Date.now());
        if (budget.allowed) break;
        // Same as the worker: an operator who asked for several pages waits out the spacing
        // between them. The first request, and the daily budget, are never waited for.
        if (budget.reason === 'rate_limit' && requestsSpent > 0) {
          await new Promise((resolve) => setTimeout(resolve, budget.retryAfterMs + 20));
          continue;
        }
        throw new ConnectorError('rate_limited', budget.reason === 'daily_budget'
          ? 'Orçamento diário desta fonte esgotado.'
          : 'Intervalo mínimo entre requisições não respeitado.');
      }
      requestsSpent += 1;
      const response = await transport.request(inst, path, init);
      captured.push({ contentType: response.contentType, body: response.body });
      return response;
    },
  };

  let connector;
  try {
    connector = connectorFor(installation, budgeted);
  } catch (error) {
    return deny(error instanceof Error ? error.message : 'Sem conector.');
  }
  const declared = connector.describeCapabilities(installation).operations.find((entry) => entry.operation === options.operation);
  // Same rule as the worker: only a neutral query may run unattended, and a probe is unattended.
  if (!declared?.supported || !isWorkerSafe(declared.effect)) {
    return deny(`A operação ${options.operation} não é uma consulta neutra suportada por esta fonte.`);
  }

  const requestSummary: Record<string, unknown> = { maxRequests };
  let failure: ConnectorError | null = null;
  try {
    if (options.operation === 'listChanges') {
      if (!options.windowFrom || !options.windowTo) return deny('listChanges exige --from e --to.');
      Object.assign(requestSummary, { windowFrom: options.windowFrom, windowTo: options.windowTo });
      await connector.listChanges!(installation, {
        windowFrom: options.windowFrom, windowTo: options.windowTo, maxPages: maxRequests,
      });
    } else {
      if (!options.sourcePublicationId) return deny('fetchPublication exige --id.');
      requestSummary.sourcePublicationId = options.sourcePublicationId;
      await connector.fetchPublication!(installation, options.sourcePublicationId);
    }
  } catch (error) {
    failure = error instanceof ConnectorError ? error : new ConnectorError('schema_changed', 'Falha inesperada no probe.');
  }

  // A parser refusal still leaves a payload to confront; anything else left nothing to read.
  if (!captured.length) {
    await audit('error');
    return { ...refused(failure ? `${failure.code}: ${failure.message}` : 'Nenhuma resposta recebida.'), requestsSpent };
  }

  const context = { installationId: installation.id, requestSummary };
  const reports = captured.map((raw) => compareToParser(connector, options.operation, raw.body, context));
  const fixtures = options.record
    ? captured.map((raw) => {
      const body = sanitizeForFixture(raw.body, raw.contentType);
      return { contentType: raw.contentType, body, report: compareToParser(connector, options.operation, body, context) };
    })
    : [];

  // A failure after the first response is still a failure: the sweep the operator asked for did
  // not happen. Only a parser refusal of a captured payload is reported as divergence instead.
  const parserRefused = failure?.code === 'schema_changed' && reports.some((report) => report.parseError);
  if (failure && !parserRefused) {
    await audit('error');
    return {
      exitCode: 1,
      detail: `Probe interrompido após ${captured.length} resposta(s): ${failure.code}: ${failure.message}`,
      reports,
      requestsSpent,
      fixtures: [],
    };
  }

  await audit('ok');
  // Sanitizing may rewrite values, never structure: a fixture the parser reads differently from
  // the real response would prove nothing about the real response.
  const shape = (report: ConformanceReport) => JSON.stringify([
    report.knownFields, report.unknownFields, report.missingExpected, report.items, report.rejected, report.parseError,
  ]);
  if (fixtures.some((fixture, index) => shape(fixture.report) !== shape(reports[index]))) {
    return { exitCode: 1, detail: 'A sanitização alterou a estrutura lida pelo parser; amostra não gravada.', reports, requestsSpent, fixtures: [] };
  }
  const exitCode = reports.some((report) => conformanceExitCode(report) === 2) ? 2 : 0;
  return {
    exitCode,
    detail: exitCode === 0 ? 'Resposta conforme ao parser.' : 'A resposta diverge do parser; veja o relatório.',
    reports,
    requestsSpent,
    fixtures,
  };
}
