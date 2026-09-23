"use client";

import { CircleAlert } from "lucide-react";
import type { z } from "zod";
import type {
  judicialAlertDto,
  judicialJobDto,
  judicialLinkDto,
  judicialMovementDto,
  judicialPublicationDto,
  judicialSourceDto,
} from "@/lib/capabilities/contracts";

/**
 * Vocabulary shared by the two judicial surfaces: the Cofre panel and the inbox in the Central de
 * comando. The DTOs are the same ones the contracts declare, so a field the fence strips cannot be
 * rendered here by accident.
 *
 * The labels are deliberately verbose in places. A court keeps disponibilização and publicação
 * apart, and a backfill finding is not today's news; collapsing either into one word would make
 * the screen say something the data does not.
 */

export type JudicialSource = z.infer<typeof judicialSourceDto>;
export type JudicialLink = z.infer<typeof judicialLinkDto>;
export type JudicialPublication = z.infer<typeof judicialPublicationDto>;
export type JudicialMovement = z.infer<typeof judicialMovementDto>;
export type JudicialJob = z.infer<typeof judicialJobDto>;
export type JudicialAlert = z.infer<typeof judicialAlertDto>;

export const degreeLabels: Record<string, string> = {
  first: "1º grau",
  second: "2º grau",
  superior: "Instância superior",
  panel: "Turma recursal",
  not_applicable: "Grau não se aplica",
};

export const permissionLabels: Record<string, string> = {
  permitido: "Permitido",
  restrito: "Restrito",
  proibido: "Proibido",
  nao_esclarecido: "Não esclarecido",
};

export const permissionDimensions = [
  ["query", "Consulta"],
  ["cache", "Armazenamento"],
  ["documents", "Documentos"],
  ["redistribution", "Redistribuição"],
  ["ai", "Uso por IA"],
] as const;

export const revisionLabels: Record<JudicialPublication["revisionKind"], string> = {
  original: "Publicação original",
  republication: "Republicação",
  errata: "Errata",
};

export const eventLabels: Record<JudicialAlert["eventKind"], string> = {
  new_publication: "Publicação nova",
  historical_publication: "Achado histórico",
  new_movement: "Movimentação nova",
  correction: "Correção da fonte",
  sync_failed: "Falha na atualização",
  coverage_gap: "Lacuna de cobertura",
};

/** The second line of an event row: what the label above does *not* mean. */
export const eventNotes: Record<JudicialAlert["eventKind"], string> = {
  new_publication: "Publicada agora na fonte consultada.",
  historical_publication: "Encontrada em varredura histórica; não é novidade de hoje.",
  new_movement: "Andamento novo registrado pela fonte.",
  correction: "A fonte corrigiu ou republicou um registro anterior.",
  sync_failed: "A janela pode ter ficado incompleta enquanto isto não for resolvido.",
  coverage_gap: "Há um intervalo sem coleta confirmada nesta fonte.",
};

export const jobStatusLabels: Record<JudicialJob["status"], string> = {
  queued: "Na fila",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
  quarantined: "Em quarentena",
};

export const confirmationLabels: Record<JudicialLink["confirmation"], string> = {
  confirmed: "Confirmado",
  pending_review: "Aguardando confirmação",
  rejected: "Rejeitado",
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // A date with no time stays a date: noon in UTC keeps it on the same day in Brasília.
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Hours since an instant, or undefined when there is no instant to measure from. */
export function hoursSince(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return (now - parsed) / 3_600_000;
}

/** A collection older than this is reported as late rather than silently shown as current. */
export const LATE_COLLECTION_HOURS = 48;

export function collectionAgeSentence(collectedAt: string | null | undefined): string {
  const hours = hoursSince(collectedAt);
  if (hours === undefined) return "Nenhuma coleta concluída ainda.";
  if (hours >= LATE_COLLECTION_HOURS) return `Coleta atrasada: a última foi em ${formatDateTime(collectedAt)}.`;
  if (hours < 1) return "Coletado há menos de uma hora.";
  return `Coletado em ${formatDateTime(collectedAt)}.`;
}

/**
 * The most recent moment the Lume asked, which is not the first row of a list ordered by the dates
 * the court declared. Mixing the two would let an old sweep look current.
 */
export function latestCollectedAt(publications: JudicialPublication[]): string | undefined {
  let latest: string | undefined;
  for (const publication of publications) {
    if (!latest || Date.parse(publication.collectedAt) > Date.parse(latest)) latest = publication.collectedAt;
  }
  return latest;
}

/** Plain sentence for how reachable a source is, before any collection is attempted. */
export function sourceAvailability(source: JudicialSource | undefined): string {
  if (!source) return "Fonte não encontrada no catálogo.";
  if (!source.enabled) return "Fonte desabilitada: nenhuma consulta é enviada a ela.";
  if (!source.hasConnector) return "Ainda não há conector implementado para este tipo de fonte.";
  if (!source.liveTransportEnabled) return "Sem acesso ao vivo: a fonte responde apenas a partir de amostras registradas.";
  if (source.permissions.query !== "permitido" || source.permissions.cache !== "permitido") {
    return "A condição de uso desta fonte ainda não autoriza consultar e armazenar.";
  }
  return "Fonte ativa para consulta.";
}

/** Extra sentence for the failure codes a person can act on. */
export function failureAdvice(code: string | undefined): string {
  switch (code) {
    case "FORBIDDEN":
      return "Acesso expirado ou recusado pela fonte. Renove a credencial antes de tentar de novo.";
    case "RATE_LIMITED":
      return "O orçamento de consultas desta fonte foi atingido. A coleta recomeça no próximo ciclo.";
    case "NOT_READY":
      return "A fonte está fora do ar ou respondeu de forma inesperada.";
    case "APPROVAL_REQUIRED":
      return "Falta uma decisão de uma pessoa antes de consultar esta fonte.";
    default:
      return "";
  }
}

export type ApiFailure = { message: string; code?: string };

export async function readFailure(response: Response, fallback: string): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  return { message: body?.error ?? fallback, code: body?.code };
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function ErrorText({ failure }: { failure: ApiFailure | null }) {
  if (!failure) return null;
  const advice = failureAdvice(failure.code);
  return (
    <p className="flex items-start gap-2 py-2 text-sm text-destructive" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{failure.message}{advice && ` ${advice}`}</span>
    </p>
  );
}

/** The one sentence neither surface may drop, however complete the collection looks. */
export const OFFICIAL_NOTICE =
  "Acompanhamento interno do Lume. Não substitui a intimação oficial nem o prazo publicado pelo tribunal.";
