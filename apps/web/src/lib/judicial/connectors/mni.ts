import { createHash } from 'node:crypto';
import {
  ConnectorError,
  emptyCoverage,
  type ConnectorCapabilities,
  type ConnectorOperation,
  type ConnectorResult,
  type Degree,
  type InstallationRef,
  type JudicialConnector,
  type LookupCaseRequest,
  type NormalizedCase,
  type NormalizedMovement,
} from '../contracts';
import { parseCnjNumber } from '../normalization/cnj';
import { nowIso, parseSourceDate } from '../normalization/dates';
import { stripCredentialElements } from './sanitize';
import { buildEnvelope, child, childrenNamed, classifySourceMessage, readEnvelope, textOf, type XmlNode } from './soap';
import type { Transport } from './transport';

/**
 * MNI 2.2.2 (Modelo Nacional de Interoperabilidade) as a source of *case data*: header and
 * movements of one proceeding, per installation (A3 of docs/Refinos-MVP/plano-conectores-tribunais.md).
 *
 * Written against the published 2.2.2 schema and not yet confirmed against any court; each
 * court's WSDL is pinned per installation and `health` refuses one that drifted.
 */

export const MNI_PARSER_VERSION = 'mni-2.2.2-2026-09-a';

export const MNI_NAMESPACES = {
  service: 'http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/',
  types: 'http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2',
};

/**
 * Operations that can perfect service of process or file on the lawyer's behalf. Refused by name
 * here, and never reachable from the worker, whatever a job or a caller asks for.
 */
export const MNI_REFUSED_OPERATIONS = ['consultarAvisosPendentes', 'consultarTeorComunicacao', 'entregarManifestacaoProcessual'] as const;
const MNI_ALLOWED_OPERATIONS = ['consultarProcesso'] as const;

/** The credential arrives decrypted at the call site as `idConsultante:senha`. */
function splitCredential(credential: string | undefined): { id: string; secret: string } | null {
  if (!credential) return null;
  const separator = credential.indexOf(':');
  if (separator <= 0 || separator === credential.length - 1) {
    throw new ConnectorError('unauthorized', 'Credencial MNI em formato inválido.');
  }
  return { id: credential.slice(0, separator), secret: credential.slice(separator + 1) };
}

export function buildMniRequest(
  operation: string,
  fields: { numeroProcesso: string; credential?: string },
): string {
  if ((MNI_REFUSED_OPERATIONS as readonly string[]).includes(operation)) {
    throw new ConnectorError('unsupported', `Operação MNI com possível efeito de ciência ou peticionamento recusada: ${operation}.`);
  }
  if (!(MNI_ALLOWED_OPERATIONS as readonly string[]).includes(operation)) {
    throw new ConnectorError('unsupported', `Operação MNI não implementada: ${operation}.`);
  }
  const credential = splitCredential(fields.credential);
  return buildEnvelope(operation, [
    ...(credential ? [['idConsultante', credential.id], ['senhaConsultante', credential.secret]] as Array<[string, string]> : []),
    ['numeroProcesso', fields.numeroProcesso],
    ['movimentos', 'true'],
    ['incluirCabecalho', 'true'],
    ['incluirDocumentos', 'false'],
  ], MNI_NAMESPACES);
}

function toMovement(node: XmlNode): NormalizedMovement | null {
  const when = parseSourceDate(node.attrs.dataHora);
  if (!when) return null;
  const national = child(node, 'movimentoNacional');
  const local = child(node, 'movimentoLocal');
  // A national code in MNI *is* the TPU code, stated by the source. A local code is kept as the
  // source wrote it and never mapped to TPU by resemblance.
  const nationalCode = national?.attrs.codigoNacional ?? textOf(child(national, 'codigoNacional'));
  const sourceCode = nationalCode ?? local?.attrs.codigoMovimento ?? null;
  const complements = [...childrenNamed(node, 'complemento'), ...childrenNamed(national, 'complemento')]
    .map(textOf).filter((value): value is string => Boolean(value));
  const sourceText = [local?.attrs.descricao, ...complements].filter(Boolean).join(' — ')
    || (sourceCode ? `[código ${sourceCode}]` : '');
  if (!sourceText) return null;
  return {
    sourceMovementId: node.attrs.identificadorMovimento ?? null,
    sourceCode,
    sourceText,
    tpuCode: nationalCode ?? null,
    tpuSource: nationalCode ? 'source_declared' : null,
    eventAt: when.value,
    eventPrecision: when.precision,
    eventTimezone: when.timezone,
  };
}

/**
 * Pure. The degree comes from the installation, not the payload: MNI does not state it, and the
 * same number at two degrees is two records that must never share movements.
 */
export function normalizeConsultarProcesso(xml: string, degree: Degree): { items: NormalizedCase[]; rejected: number } {
  const response = readEnvelope(xml);
  const success = textOf(child(response, 'sucesso'));
  const message = textOf(child(response, 'mensagem')) ?? 'A fonte não informou o motivo.';
  if (success !== 'true') {
    throw new ConnectorError(classifySourceMessage(message), `A fonte recusou a consulta: ${message.slice(0, 300)}`);
  }

  const process = child(response, 'processo');
  if (!process) throw new ConnectorError('not_found_in_source', 'Processo não encontrado nesta fonte.');
  const header = child(process, 'dadosBasicos');
  if (!header) throw new ConnectorError('schema_changed', 'Resposta MNI sem dadosBasicos.');

  // A sealed proceeding is reported as such, with no movements recorded, even when the source
  // returned some: the declared secrecy level governs, not what happened to come back.
  const secrecy = Number(header.attrs.nivelSigilo ?? '0');
  if (secrecy > 0) {
    throw new ConnectorError('forbidden', `Processo com nível de sigilo ${secrecy} declarado pela fonte.`);
  }

  const nativeNumber = header.attrs.numero ?? null;
  const parsed = nativeNumber ? parseCnjNumber(nativeNumber) : null;
  const cnjNumber = parsed?.ok ? parsed.normalized : null;
  if (!cnjNumber && !nativeNumber) throw new ConnectorError('schema_changed', 'Resposta MNI sem número do processo.');

  const movements: NormalizedMovement[] = [];
  let rejected = 0;
  for (const node of childrenNamed(process, 'movimento')) {
    const movement = toMovement(node);
    if (movement) movements.push(movement); else rejected += 1;
  }

  return {
    items: [{
      sourceRecordId: `${cnjNumber ?? nativeNumber}@${degree}`,
      identity: { cnjNumber, nativeNumber, degree },
      title: null,
      classCode: header.attrs.classeProcessual ?? null,
      subjectCodes: childrenNamed(header, 'assunto')
        .map((subject) => textOf(child(subject, 'codigoNacional')) ?? subject.attrs.codigoNacional ?? null)
        .filter((code): code is string => Boolean(code)),
      sourceUpdatedAt: null,
      movements,
    }],
    rejected,
  };
}

export type MniOptions = {
  /** Where pinned `mni-<tribunal>-<versão>.wsdl.sha256` files live. */
  contractsDir?: string;
};

export function createMniConnector(transport: Transport, options: MniOptions = {}): JudicialConnector {
  const contractsDir = options.contractsDir ?? 'db/sources/contracts';

  /** The secret never leaves this function in a payload, a message or a log line. */
  function scrub(value: string, secret: string | undefined): string {
    const stripped = stripCredentialElements(value);
    return secret ? stripped.split(secret).join('[removido]') : stripped;
  }

  return {
    kind: 'mni',
    parserVersion: MNI_PARSER_VERSION,

    describeCapabilities(installation: InstallationRef): ConnectorCapabilities {
      const unsupported = (operation: ConnectorOperation, notes: string) => ({
        operation, supported: false, effect: 'unknown' as const, filters: [], maxPageSize: null, notes,
      });
      return {
        installationId: installation.id,
        parserVersion: MNI_PARSER_VERSION,
        operations: [
          { operation: 'describeCapabilities', supported: true, effect: 'neutral_query', filters: [], maxPageSize: null },
          {
            operation: 'lookupCase', supported: true, effect: 'neutral_query', filters: ['cnjNumber', 'nativeNumber'], maxPageSize: null,
            notes: 'consultarProcesso com movimentos e cabeçalho, sem documentos.',
          },
          { operation: 'health', supported: true, effect: 'neutral_query', filters: [], maxPageSize: null, notes: 'Confere o WSDL com o contrato fixado.' },
          unsupported('listChanges', 'consultarAlteracao só entra quando a instalação declarar suporte.'),
          unsupported('fetchPublication', 'MNI não publica comunicações; use o DJEN.'),
          unsupported('fetchDocument', 'Documentos dependem da permissão documents e ficam fora do worker genérico.'),
        ],
        maxWindowDays: null,
        requiresConnection: installation.authKind !== 'none',
      };
    },

    async health(installation) {
      const version = installation.contractVersion ?? '2.2.2';
      const pinnedPath = `${contractsDir}/mni-${installation.courtCode.toLowerCase()}-${version}.wsdl.sha256`;
      let pinned: string;
      try {
        const { readFile } = await import('node:fs/promises');
        pinned = (await readFile(pinnedPath, 'utf8')).trim().split(/\s+/)[0].toLowerCase();
      } catch {
        return { ok: false, detail: `schema_changed: sem contrato fixado em ${pinnedPath}.` };
      }
      try {
        const response = await transport.request(installation, '?wsdl', { timeoutMs: 8_000 });
        const actual = createHash('sha256').update(response.body).digest('hex');
        return actual === pinned
          ? { ok: true, detail: 'WSDL confere com o contrato fixado.' }
          : { ok: false, detail: 'schema_changed: o WSDL publicado difere do contrato fixado; revise antes de usar a instalação.' };
      } catch (error) {
        return { ok: false, detail: error instanceof ConnectorError ? `${error.code}: ${error.message}` : 'Falha desconhecida.' };
      }
    },

    async lookupCase(installation, request: LookupCaseRequest): Promise<ConnectorResult<NormalizedCase>> {
      const numeroProcesso = request.identity.cnjNumber ?? request.identity.nativeNumber;
      if (!numeroProcesso) throw new ConnectorError('unsupported', 'Consulta MNI exige o número do processo.');
      if (installation.authKind !== 'none' && !request.credential) {
        throw new ConnectorError('human_action_required', 'Esta fonte exige uma credencial conectada.');
      }
      const secret = request.credential ? splitCredential(request.credential)?.secret : undefined;

      const collectedAt = nowIso();
      let raw: { contentType: string; body: string } | undefined;
      try {
        const response = await transport.request(installation, '', {
          method: 'POST',
          body: buildMniRequest('consultarProcesso', { numeroProcesso, credential: request.credential }),
          headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
        });
        raw = { contentType: response.contentType, body: scrub(response.body, secret) };
        const parsed = normalizeConsultarProcesso(response.body, installation.degree);
        return {
          items: parsed.items,
          cursor: null,
          coverage: { ...emptyCoverage(), pagesFetched: 1, totalReported: 1, rejected: parsed.rejected },
          source: { installationId: installation.id, operation: 'lookupCase', parserVersion: MNI_PARSER_VERSION, collectedAt },
          rawPayloads: [raw],
        };
      } catch (error) {
        const failure = error instanceof ConnectorError ? error : new ConnectorError('schema_changed', 'Falha inesperada no conector MNI.');
        throw new ConnectorError(failure.code, scrub(failure.message, secret), failure.retryAfterSeconds, raw, raw ? [raw] : undefined);
      }
    },

    normalize(operation: ConnectorOperation, payload: string) {
      // ponytail: re-reading a stored snapshot has no installation in scope, so the degree is
      // `not_applicable` here; the caller that knows the installation uses normalizeConsultarProcesso.
      if (operation === 'lookupCase') return normalizeConsultarProcesso(payload, 'not_applicable');
      throw new ConnectorError('unsupported', `Operação sem parser no conector MNI: ${operation}`);
    },
  };
}
