import { z } from 'zod';

export const ticketStatuses = ['new', 'in_progress', 'resolved', 'dismissed'] as const;
export const ticketKinds = ['problem', 'suggestion', 'question', 'praise', 'other'] as const;
export const ticketModules = ['lume', 'cofre', 'agenda', 'pesquisa', 'documentos', 'email', 'integracoes', 'notificacoes', 'conta', 'instalacao', 'nao_identificado'] as const;
/** What the person may choose in the dialog; the rest of the triage vocabulary stays internal. */
export const reportKinds = ['problem', 'suggestion', 'question'] as const;
export type ReportKind = (typeof reportKinds)[number];
export const ticketPriorities = ['p0', 'p1', 'p2', 'p3'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];
export type TicketKind = (typeof ticketKinds)[number];
export type TicketModule = (typeof ticketModules)[number];
export type TicketPriority = (typeof ticketPriorities)[number];

export const MAX_FEEDBACK_MESSAGE = 4000;
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Labels the author sees: plain and without internal triage vocabulary. */
export const authorStatusLabels: Record<TicketStatus, string> = { new: 'Recebido', in_progress: 'Em análise', resolved: 'Resolvido', dismissed: 'Encerrado' };
export const statusLabels: Record<TicketStatus, string> = { new: 'Novo', in_progress: 'Em análise', resolved: 'Resolvido', dismissed: 'Descartado' };
export const kindLabels: Record<TicketKind, string> = { problem: 'Problema', suggestion: 'Sugestão', question: 'Dúvida', praise: 'Elogio', other: 'Outro' };
export const moduleLabels: Record<TicketModule, string> = {
  lume: 'Lume (chat)', cofre: 'Cofre', agenda: 'Agenda e clientes', pesquisa: 'Pesquisa', documentos: 'Minutas e documentos',
  email: 'E-mails', integracoes: 'Integrações', notificacoes: 'Notificações', conta: 'Conta e acesso', instalacao: 'Instalação', nao_identificado: 'Não identificado',
};
export const reportKindLabels: Record<ReportKind, string> = { problem: 'Problema', suggestion: 'Melhoria', question: 'Dúvida' };
/** The places the person can point to, in the order of the app's navigation. */
export const reportModules = ['lume', 'cofre', 'pesquisa', 'agenda', 'email', 'documentos', 'notificacoes', 'integracoes', 'conta', 'instalacao', 'nao_identificado'] as const satisfies readonly TicketModule[];
export const reportModuleLabels: Record<(typeof reportModules)[number], string> = {
  lume: 'Lume', cofre: 'Cofre', pesquisa: 'Pesquisa', agenda: 'Escritório', email: 'E-mails', documentos: 'Documentos e minutas',
  notificacoes: 'Notificações', integracoes: 'Integrações', conta: 'Conta e acesso', instalacao: 'Instalação do aplicativo', nao_identificado: 'Outro lugar',
};
/** The module of the screen the person is on, as the dialog's first guess. */
export function moduleForPath(path: string): TicketModule {
  const section = /^\/app\/([^/?#]+)/.exec(path)?.[1];
  const map: Record<string, TicketModule> = { agents: 'lume', vault: 'cofre', documents: 'documentos', research: 'pesquisa', agenda: 'agenda', email: 'email', notifications: 'notificacoes', integrations: 'integracoes' };
  return (section && map[section]) || 'nao_identificado';
}
export const priorityLabels: Record<TicketPriority, string> = { p0: 'P0 · urgente', p1: 'P1 · alta', p2: 'P2 · normal', p3: 'P3 · baixa' };

export const feedbackSubmission = z.object({
  message: z.string().trim().min(3, 'Descreva em poucas palavras o que aconteceu.').max(MAX_FEEDBACK_MESSAGE),
  pagePath: z.string().max(300).regex(/^\/[^\s]*$/).or(z.literal('')).default(''),
  kind: z.enum(reportKinds, { message: 'Escolha se algo quebrou, se é uma ideia ou uma dúvida.' }).optional(),
  module: z.enum(ticketModules, { message: 'Escolha onde aconteceu.' }).optional(),
});

export const ticketUpdate = z.object({
  version: z.number().int().positive(),
  status: z.enum(ticketStatuses).optional(),
  kind: z.enum(ticketKinds).optional(),
  module: z.enum(ticketModules).optional(),
  priority: z.enum(ticketPriorities).optional(),
  resolutionNote: z.string().trim().max(2000).optional(),
  note: z.string().trim().min(1).max(4000).optional(),
});
export type TicketUpdate = z.infer<typeof ticketUpdate>;

export type AuthorTicket = {
  id: string; number: number; message: string; status: TicketStatus; kind: ReportKind | null; module: TicketModule | null; resolutionNote: string; createdAt: string; resolvedAt: string | null;
};
