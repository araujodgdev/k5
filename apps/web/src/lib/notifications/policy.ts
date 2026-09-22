import { Temporal } from '@js-temporal/polyfill';
import type { NotificationCategory, NotificationEventType } from './contracts';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export function isTimeZone(value: string): boolean {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}

export function categoryForEvent(type: NotificationEventType): NotificationCategory {
  if (type.startsWith('agenda.')) return 'agenda';
  if (type.startsWith('vault.')) return 'vault';
  if (type.startsWith('documents.')) return 'documents';
  if (type.startsWith('judicial.')) return 'judicial';
  return 'system';
}

export function reminderInstant(input: {
  kind: 'task' | 'meeting';
  dueOn: string | null;
  startsAt: string | null;
  timezone: string;
}): { dueAt: string; expiresAt: string; rule: 'task_due' | 'meeting_soon' } | null {
  if (input.kind === 'meeting' && input.startsAt) {
    const starts = Temporal.Instant.from(input.startsAt);
    return {
      dueAt: starts.subtract({ minutes: 30 }).toString({ smallestUnit: 'millisecond' }),
      expiresAt: starts.toString({ smallestUnit: 'millisecond' }),
      rule: 'meeting_soon',
    };
  }
  if (input.kind !== 'task' || !input.dueOn) return null;
  const date = Temporal.PlainDate.from(input.dueOn);
  const due = date.toPlainDateTime({ hour: 9 }).toZonedDateTime(input.timezone, { disambiguation: 'compatible' });
  const end = date.add({ days: 1 }).toPlainDateTime().toZonedDateTime(input.timezone, { disambiguation: 'compatible' });
  return {
    dueAt: due.toInstant().toString({ smallestUnit: 'millisecond' }),
    expiresAt: end.toInstant().toString({ smallestUnit: 'millisecond' }),
    rule: 'task_due',
  };
}

export function quietUntil(input: {
  now: string;
  timezone: string;
  enabled: boolean;
  start: string | null;
  end: string | null;
}): string | null {
  if (!input.enabled || !input.start || !input.end || input.start === input.end) return null;
  const now = Temporal.Instant.from(input.now).toZonedDateTimeISO(input.timezone);
  const [startHour, startMinute] = input.start.split(':').map(Number);
  const [endHour, endMinute] = input.end.split(':').map(Number);
  const minutes = now.hour * 60 + now.minute;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const wraps = start > end;
  const quiet = wraps ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!quiet) return null;
  const endDate = wraps && minutes >= start ? now.toPlainDate().add({ days: 1 }) : now.toPlainDate();
  return endDate.toPlainDateTime({ hour: endHour, minute: endMinute })
    .toZonedDateTime(input.timezone, { disambiguation: 'compatible' }).toInstant().toString({ smallestUnit: 'millisecond' });
}

export function eventCopy(type: NotificationEventType, data: Record<string, unknown>, userId: string) {
  const activity = typeof data.activityTitle === 'string' ? data.activityTitle : 'uma atividade';
  switch (type) {
    case 'agenda.activity.assigned':
      if (data.previousAssigneeId === userId && data.assigneeId !== userId) {
        return { title: 'Responsabilidade alterada', summary: `Você não é mais responsável por ${activity}.` };
      }
      return { title: 'Nova atribuição', summary: `Você agora é responsável por ${activity}.` };
    case 'agenda.activity.changed':
      return { title: 'Atividade atualizada', summary: `${activity} teve uma alteração relevante.` };
    case 'agenda.task.due':
      return { title: 'Tarefa com vencimento hoje', summary: `${activity} vence hoje.` };
    case 'agenda.meeting.soon':
      return { title: 'Reunião em 30 minutos', summary: `${activity} começa em breve.` };
    case 'vault.processing.completed':
      return { title: 'Processamento concluído', summary: 'Um documento terminou de ser processado.' };
    case 'vault.processing.failed':
      return { title: 'Falha no processamento', summary: 'Um documento não pôde ser processado.' };
    case 'vault.index.ready':
      return { title: 'Documento disponível na busca', summary: 'A indexação de um documento foi concluída.' };
    case 'vault.index.failed':
      return { title: 'Documento fora da busca semântica', summary: 'A indexação de um documento não pôde ser concluída.' };
    case 'documents.run.completed':
      return { title: 'Documento pronto', summary: 'Uma cronologia ou minuta ficou pronta.' };
    case 'documents.run.failed':
      return { title: 'Falha na geração', summary: 'Uma cronologia ou minuta não pôde ser concluída.' };
    case 'documents.verification.available':
      return { title: 'Verificação disponível', summary: 'Há um resultado de verificação para revisar.' };
    case 'judicial.publication.new':
      return { title: 'Nova publicação', summary: 'Há uma nova publicação em um caso acompanhado.' };
    case 'judicial.publication.corrected':
      return { title: 'Publicação corrigida', summary: 'Uma publicação acompanhada recebeu correção.' };
    case 'judicial.collection.failed':
      return { title: 'Coleta judicial incompleta', summary: 'Uma fonte acompanhada precisa de atenção.' };
    case 'system.push.test':
      return { title: 'Notificação de teste', summary: 'Este dispositivo está pronto para receber avisos do K5.' };
  }
}
