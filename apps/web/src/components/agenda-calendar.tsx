'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { localDate } from '@/lib/calendar-days';
import { cn } from '@/lib/utils';

const weekLetters = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');

// "Setembro de 2026": only the first letter goes up (CSS capitalize would also raise the "de").
function monthLabel(date: Date) {
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The month on a raised card beside the agenda: the chosen day filled in ink, today in the selected tint, a dot
 * under days with activities. Arrow keys move the day; the list follows the chosen day.
 */
export function MonthCard({ day, markers, onChange, showMarkers, status }: {
  day: string; markers: Record<string, number>; onChange: (value: string) => void; showMarkers: boolean;
  /** A loading or failure line for the markers, under the grid. */
  status?: ReactNode;
}) {
  const date = new Date(`${day}T12:00:00`);
  const year = date.getFullYear(); const month = date.getMonth();
  const start = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const today = localDate(new Date());
  return (
    <section aria-label="Calendário mensal" className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon-sm" className="max-md:size-11" aria-label="Mês anterior" onClick={() => onChange(localDate(new Date(year, month - 1, 1)))}><ChevronLeft /></Button>
        <h2 className="text-[13.5px] font-medium" aria-live="polite">{monthLabel(date)}</h2>
        <Button variant="ghost" size="icon-sm" className="max-md:size-11" aria-label="Próximo mês" onClick={() => onChange(localDate(new Date(year, month + 1, 1)))}><ChevronRight /></Button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-subtle-foreground" aria-hidden="true">{weekLetters.map((label, i) => <span key={i} className="py-1.5">{label}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: start }, (_, i) => <span key={`empty-${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const value = localDate(new Date(year, month, i + 1));
          const marked = showMarkers && Boolean(markers[value]);
          const chosen = value === day;
          return <button key={value} type="button" data-calendar-day={value}
            aria-label={`${dateLabel(value)}${marked ? `, ${markers[value]} atividade${markers[value] === 1 ? '' : 's'}` : ''}`}
            aria-pressed={chosen} aria-current={value === today ? 'date' : undefined}
            onClick={() => onChange(value)} onKeyDown={event => {
              const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
              if (shift === undefined) return;
              event.preventDefault();
              const next = localDate(new Date(year, month, i + 1 + shift));
              onChange(next);
              requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`button[data-calendar-day="${next}"]`)?.focus());
            }}
            className={cn('relative mx-auto flex size-10 items-center justify-center rounded-md font-mono text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-ring md:size-8',
              chosen ? 'bg-primary text-primary-foreground' : value === today ? 'bg-selected font-medium' : 'hover:bg-accent')}>
            {i + 1}
            {marked && <span aria-hidden="true" className={cn('absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full', chosen ? 'bg-primary-foreground' : 'bg-muted-foreground')} />}
          </button>;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        {showMarkers ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />Dias com atividades</p> : <span />}
        <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => onChange(today)}>Hoje</Button>
      </div>
      {status}
    </section>
  );
}
