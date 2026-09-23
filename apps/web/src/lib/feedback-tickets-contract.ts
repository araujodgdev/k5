import { z } from 'zod';

export const ticketStatuses = ['new', 'in_progress', 'resolved', 'dismissed'] as const;
export const ticketKinds = ['problem', 'suggestion', 'question', 'praise', 'other'] as const;
export const ticketModules = ['lume', 'cofre', 'agenda', 'pesquisa', 'documentos', 'notificacoes', 'conta', 'instalacao', 'nao_identificado'] as const;
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
  notificacoes: 'Notificações', conta: 'Conta e acesso', instalacao: 'Instalação', nao_identificado: 'Não identificado',
};
export const priorityLabels: Record<TicketPriority, string> = { p0: 'P0 · urgente', p1: 'P1 · alta', p2: 'P2 · normal', p3: 'P3 · baixa' };

export const feedbackSubmission = z.object({
  message: z.string().trim().min(3, 'Descreva em poucas palavras o que aconteceu.').max(MAX_FEEDBACK_MESSAGE),
  pagePath: z.string().max(300).regex(/^\/[^\s]*$/).or(z.literal('')).default(''),
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
  id: string; number: number; message: string; status: TicketStatus; resolutionNote: string; createdAt: string; resolvedAt: string | null;
};
