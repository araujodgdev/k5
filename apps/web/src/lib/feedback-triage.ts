import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Questions } from '@typesafe-ai/sdk';
import { database } from './database';
import { evaluate, type DecisionTransport } from './typesafe/client';
import type { DecisionResponse } from './typesafe/contracts';
import { kindLabels, moduleLabels, ticketKinds, ticketModules, type ReportKind, type TicketKind, type TicketModule, type TicketPriority } from './feedback-tickets-contract';
import type { TriageRecord } from './feedback-tickets';

export const feedbackTriageQuestionVersion = 'feedback-triage-pt-BR-v2';
const MAX_ATTEMPTS = 3;

/** Starting thresholds from the TypeSafe confidence-routing guidance; calibrate on real tickets. */
export const triageThresholds = { review: 0.6, flag: 0.5, urgentSeverity: 2.5, highSeverity: 1.5, highValue: 2, lowValue: 1 };

const kindCriteria: Record<TicketKind, string> = {
  problem: 'Relata erro, falha, travamento, lentidão, resultado errado ou algo que não funciona como deveria.',
  suggestion: 'Pede melhoria, nova funcionalidade ou mudança em algo que funciona.',
  question: 'Pergunta como usar algo ou pede esclarecimento, sem relatar falha.',
  praise: 'Elogia ou agradece, sem pedido nem problema.',
  other: 'Não se encaixa nas opções anteriores ou não dá para entender o pedido.',
};
const moduleCriteria: Record<TicketModule, string> = {
  lume: 'Lume: o chat com o assistente de IA, respostas, anexos, câmera e fontes da conversa.',
  cofre: 'Cofre: casos, pastas, envio, leitura e busca de documentos do escritório.',
  agenda: 'Tarefas, agenda, reuniões e cadastro de clientes.',
  pesquisa: 'Pesquisa de jurisprudência, julgados e referências do caso.',
  documentos: 'Minutas, cronologias, peças geradas, editor e exportação de documentos.',
  email: 'E-mails: caixa de entrada, leitura, resumo e resposta de mensagens.',
  integracoes: 'Integrações com Google (Agenda, Drive, Gmail) e outros serviços conectados.',
  notificacoes: 'Notificações e avisos no aplicativo ou no celular.',
  conta: 'Login, senha, sessão, convites e permissões da equipe.',
  instalacao: 'Instalar o aplicativo no computador ou celular, tela inicial e funcionamento offline.',
  nao_identificado: 'O texto não permite identificar a parte do produto.',
};

export function triageQuestions(): Questions {
  return {
    kind: { type: 'choice', instructions: 'Que tipo de retorno a pessoa deixou em `feedback.message`? `feedback.reported_kind` é o que a pessoa marcou ao enviar: use como pista forte, mas o texto prevalece.', criteria: kindCriteria },
    module: { type: 'choice', instructions: 'Qual parte do produto o texto em `feedback.message` trata? `feedback.reported_area` é onde a pessoa disse que aconteceu e `feedback.page` é a tela em que ela estava ao enviar: use os dois como pista, mas o texto prevalece.', criteria: moduleCriteria },
    severity: { type: 'score', instructions: 'Suponha que `feedback.message` relata um problema. Qual é o impacto para o trabalho do escritório?', criteria: [
      'Detalhe visual, texto ou incômodo menor; o trabalho segue normalmente.',
      'Algo funciona mal ou está lento, mas há um jeito de contornar e concluir a tarefa.',
      'Impede concluir uma tarefa ou usar uma parte do produto, sem contorno conhecido.',
      'Risco a dados ou prazos: documento perdido ou alterado, informação exibida para quem não deveria, falha que pode fazer perder um prazo.',
    ] },
    value: { type: 'score', instructions: 'Suponha que `feedback.message` sugere uma melhoria. Quanto ela ajudaria o trabalho do escritório, se feita?', criteria: [
      'Preferência pessoal ou ajuste cosmético; pouco muda no dia a dia.',
      'Poupa alguns passos numa tarefa ocasional ou deixa algo mais claro.',
      'Poupa tempo numa tarefa frequente ou remove um contorno que a equipe faz hoje.',
      'Muda o fluxo de trabalho: permite algo que hoje não dá para fazer no produto, ou reduz risco em prazos e documentos.',
    ] },
    security: { type: 'noul', instructions: 'O texto em `feedback.message` relata que alguém viu ou recebeu dados de outro escritório ou de pessoa não autorizada, ou que um documento ou dado sumiu ou mudou sem ação da pessoa?' },
    personal_data: { type: 'noul', instructions: 'O texto em `feedback.message` contém dados pessoais identificáveis de clientes ou partes, como CPF, RG, endereço, dados de saúde ou nome completo associado a um caso?' },
  };
}

export type Triage = {
  kind: TicketKind | null; module: TicketModule | null; severity: number | null; valueScore: number | null; priority: TicketPriority;
  securityFlag: boolean; personalDataFlag: boolean; needsReview: boolean;
};

/** Policy lives here, not in the model: raw answers stay reusable if a threshold changes. */
export function composeTriage(response: DecisionResponse | undefined): Triage {
  const answers = response?.answers ?? {};
  const choice = <T extends string>(name: string, allowed: readonly T[]) => {
    const answer = answers[name];
    return answer?.type === 'choice' && (allowed as readonly string[]).includes(answer.choice) ? { value: answer.choice as T, confidence: answer.confidence } : null;
  };
  const noul = (name: string) => { const answer = answers[name]; return answer?.type === 'noul' ? answer.noul : 0; };
  const kind = choice('kind', ticketKinds);
  const area = choice('module', ticketModules);
  const severityAnswer = answers.severity;
  const severity = kind?.value === 'problem' && severityAnswer?.type === 'score' ? severityAnswer.score : null;
  const valueAnswer = answers.value;
  const valueScore = kind?.value === 'suggestion' && valueAnswer?.type === 'score' ? valueAnswer.score : null;
  const securityFlag = noul('security') >= triageThresholds.flag;
  // Relevance: a problem ranks by its impact, an improvement by how much it would help.
  const priority: TicketPriority = securityFlag || (severity ?? 0) >= triageThresholds.urgentSeverity ? 'p0'
    : (severity ?? 0) >= triageThresholds.highSeverity || (valueScore ?? 0) >= triageThresholds.highValue ? 'p1'
      : valueScore !== null && valueScore < triageThresholds.lowValue ? 'p3'
        : kind?.value === 'problem' || kind?.value === 'suggestion' ? 'p2' : kind ? 'p3' : 'p2';
  return {
    kind: kind?.value ?? null, module: area?.value ?? null, severity, valueScore, priority, securityFlag,
    personalDataFlag: noul('personal_data') >= triageThresholds.flag,
    needsReview: !kind || kind.confidence < triageThresholds.review || !area || area.confidence < triageThresholds.review,
  };
}

type Claimed = { id: string; office_id: string; user_id: string | null; message: string; page_path: string; reported_kind: ReportKind | null; reported_module: TicketModule | null; attempts: number; version: number };

/** Labels rather than codes: the model reads the same words the person saw. */
export function triageState(row: Pick<Claimed, 'message' | 'page_path' | 'reported_kind' | 'reported_module'>) {
  return { feedback: {
    message: row.message, page: row.page_path || 'desconhecida',
    ...(row.reported_kind ? { reported_kind: kindLabels[row.reported_kind] } : {}),
    ...(row.reported_module ? { reported_area: moduleLabels[row.reported_module] } : {}),
  } };
}

/** One ticket per call. Returns false when there is nothing to classify. */
export async function processNextFeedbackClassification(options: { send?: DecisionTransport } = {}): Promise<boolean> {
  const now = Date.now();
  const token = randomUUID();
  const row = await database.prepare(`UPDATE feedback_ticket SET classification_status='running',lease_token=?,lease_until=?,attempts=attempts+1
    WHERE id=(SELECT id FROM feedback_ticket WHERE classification_status IN ('pending','running') AND lease_until<?
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,office_id,user_id,message,page_path,reported_kind,reported_module,attempts,version`).get<Claimed>(token, now + 30_000, now);
  if (!row) return false;
  const evaluated = await evaluate({ officeId: row.office_id, userId: row.user_id }, 'feedback', {
    state: triageState(row),
    questions: triageQuestions(), questionVersion: feedbackTriageQuestionVersion,
  }, { send: options.send, deadlineMs: 10_000 });
  const retry = (evaluated.status === 'unavailable' || evaluated.status === 'budget_exceeded') && row.attempts < MAX_ATTEMPTS;
  if (retry) {
    await database.prepare("UPDATE feedback_ticket SET classification_status='pending',lease_until=? WHERE id=? AND lease_token=?")
      .run(now + 60_000 * row.attempts, row.id, token);
    return true;
  }
  const record: TriageRecord = {
    questionVersion: feedbackTriageQuestionVersion, evaluationId: evaluated.evaluationId ?? null, status: evaluated.status,
    answers: Object.fromEntries(Object.entries(evaluated.response?.answers ?? {}).map(([name, answer]) => [name, {
      type: answer.type, ...(answer.type === 'choice' ? { choice: answer.choice, confidence: answer.confidence } : {}),
      ...(answer.type === 'score' ? { score: answer.score, confidence: answer.confidence } : {}), ...(answer.type === 'noul' ? { noul: answer.noul } : {}),
    }])),
  };
  // Shadow mode keeps Jev's answers in the raw record only; kind, module and priority stay untouched.
  const shadow = evaluated.status === 'evaluated' && evaluated.mode !== 'enabled';
  const classified = evaluated.status === 'evaluated' && !shadow;
  const triage = classified ? composeTriage(evaluated.response) : null;
  const status = classified ? 'classified' : shadow || evaluated.status === 'disabled' ? 'disabled' : 'unavailable';
  // An admin correction made while the call ran wins: the model result is kept only as the raw record.
  await database.batch([
    database.prepare(`UPDATE feedback_ticket SET classification_status=?,classification_json=?,lease_token=NULL,lease_until=0,
        kind=CASE WHEN classified_by='admin' THEN kind ELSE COALESCE(?,kind) END,
        module=CASE WHEN classified_by='admin' THEN module ELSE COALESCE(?,module) END,
        priority=CASE WHEN classified_by='admin' THEN priority ELSE ? END,
        severity=?, value_score=?, security_flag=?, personal_data_flag=?,
        needs_review=CASE WHEN classified_by='admin' THEN needs_review ELSE ? END,
        classified_by=COALESCE(classified_by, CASE WHEN ? THEN 'model' END)
      WHERE id=? AND lease_token=?`).bind(status, JSON.stringify(record), triage?.kind ?? null, triage?.module ?? null, triage?.priority ?? 'p2',
      triage?.severity ?? null, triage?.valueScore ?? null, triage?.securityFlag ?? false, triage?.personalDataFlag ?? false, triage ? triage.needsReview : true, classified, row.id, token),
    database.prepare(`INSERT INTO feedback_ticket_event(id,ticket_id,actor_user_id,kind,details_json)
      SELECT ?,?,NULL,'classified',? WHERE EXISTS(SELECT 1 FROM feedback_ticket WHERE id=? AND classification_json=?)`)
      .bind(randomUUID(), row.id, JSON.stringify({ status, ...(triage ?? {}) }), row.id, JSON.stringify(record)),
  ]);
  return true;
}
