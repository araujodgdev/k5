'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { activityDto, type AgendaActivity } from '@/lib/capabilities/agenda';
import type { Choice } from '@/lib/agenda-client';

const LIFT_PX = 8;
const EDGE_PX = 56;
const EDGE_STEP = 28;

const columnTitle = {
  pending: 'A fazer',
  in_progress: 'Em andamento',
  completed: 'Concluídas',
  cancelled: 'Canceladas',
} as const satisfies Record<AgendaActivity['status'], string>;

const taskColumns = (Object.keys(columnTitle) as AgendaActivity['status'][]).map(status => ({ status, title: columnTitle[status] }));

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pointer'; activityId: string; lifted: boolean; over: AgendaActivity['status'] | null }
  | { kind: 'keyboard'; activityId: string; over: AgendaActivity['status'] };

type Drag = {
  pointerId: number;
  activity: AgendaActivity;
  originX: number;
  originY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  lifted: boolean;
  over: AgendaActivity['status'] | null;
};

function adjacentStatus(status: AgendaActivity['status'], direction: -1 | 1) {
  const index = taskColumns.findIndex(column => column.status === status);
  return taskColumns[index + direction]?.status ?? null;
}

function moveCopy(kind: 'preview' | 'commit', status: AgendaActivity['status']) {
  const title = columnTitle[status];
  return kind === 'preview' ? `Soltar em ${title}` : `Tarefa em ${title}`;
}

function columnAtPoint(x: number, y: number): AgendaActivity['status'] | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const raw = element.closest('[data-column]')?.getAttribute('data-column');
    if (raw == null) continue;
    const parsed = activityDto.shape.status.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

function scrollStripByClientX(strip: HTMLElement, clientX: number) {
  const rect = strip.getBoundingClientRect();
  const fromLeft = clientX - rect.left;
  const fromRight = rect.right - clientX;
  if (fromRight <= EDGE_PX && fromRight <= fromLeft) strip.scrollLeft += EDGE_STEP;
  else if (fromLeft <= EDGE_PX) strip.scrollLeft -= EDGE_STEP;
}

function revealColumn(strip: HTMLElement, status: AgendaActivity['status']) {
  const column = strip.querySelector<HTMLElement>(`[data-column="${status}"]`);
  if (!column) return;
  const stripRect = strip.getBoundingClientRect();
  const columnRect = column.getBoundingClientRect();
  if (columnRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - columnRect.left;
  else if (columnRect.right > stripRect.right) strip.scrollLeft += columnRect.right - stripRect.right;
}

function placeClone(node: HTMLElement, drag: Drag) {
  const width = Math.min(drag.width, window.innerWidth);
  const left = Math.min(Math.max(0, drag.x - drag.offsetX), Math.max(0, window.innerWidth - width));
  node.style.width = `${width}px`;
  node.style.left = `${left}px`;
  node.style.top = `${drag.y - drag.offsetY}px`;
}

export function TaskBoard({ activities, members, clients, busy, held, inspect, move, delegate }: {
  activities: AgendaActivity[]; members: Choice[]; clients: Choice[]; busy: boolean; held: ReadonlySet<string>;
  inspect: (activity: AgendaActivity) => void;
  move: (activity: AgendaActivity, status: AgendaActivity['status']) => void;
  delegate: (activity: AgendaActivity) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const scrollLoop = useRef(0);
  const [gesture, setGesture] = useState<Gesture>({ kind: 'idle' });
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  const [announcement, setAnnouncement] = useState('');

  function showGesture(next: Gesture) {
    gestureRef.current = next;
    setGesture(next);
  }

  function stopStripScroll() {
    if (scrollLoop.current) cancelAnimationFrame(scrollLoop.current);
    scrollLoop.current = 0;
  }

  function aimPointer(over: AgendaActivity['status'] | null) {
    const drag = dragRef.current;
    if (!drag?.lifted || drag.over === over) return;
    drag.over = over;
    showGesture({ kind: 'pointer', activityId: drag.activity.id, lifted: true, over });
    if (over && over !== drag.activity.status) setAnnouncement(moveCopy('preview', over));
  }

  function kickStripScroll() {
    if (scrollLoop.current) return;
    const tick = () => {
      const drag = dragRef.current;
      const strip = stripRef.current;
      if (!drag?.lifted || !strip) { scrollLoop.current = 0; return; }
      const before = strip.scrollLeft;
      scrollStripByClientX(strip, drag.x);
      const moved = strip.scrollLeft !== before;
      if (moved) aimPointer(columnAtPoint(drag.x, drag.y));
      const rect = strip.getBoundingClientRect();
      const inBand = drag.x - rect.left <= EDGE_PX || rect.right - drag.x <= EDGE_PX;
      scrollLoop.current = inBand && moved ? requestAnimationFrame(tick) : 0;
    };
    scrollLoop.current = requestAnimationFrame(tick);
  }

  function finishPointer(commit: boolean, x: number, y: number) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    stopStripScroll();
    showGesture({ kind: 'idle' });
    if (!commit || !drag.lifted) return;
    const over = columnAtPoint(x, y);
    if (!over || over === drag.activity.status) return;
    move(drag.activity, over);
    setAnnouncement(moveCopy('commit', over));
  }

  useLayoutEffect(() => {
    const drag = dragRef.current;
    const node = cloneRef.current;
    if (gesture.kind !== 'pointer' || !gesture.lifted || !drag || !node) return;
    placeClone(node, drag);
  }, [gesture]);

  useEffect(() => () => { if (scrollLoop.current) cancelAnimationFrame(scrollLoop.current); }, []);

  function onPointerDown(activity: AgendaActivity, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || busy || held.has(activity.id) || dragRef.current) return;
    const article = event.currentTarget.closest('article');
    const rect = article?.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId, activity, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: rect ? event.clientX - rect.left : 0, offsetY: rect ? event.clientY - rect.top : 0,
      width: rect?.width ?? event.currentTarget.getBoundingClientRect().width, lifted: false, over: null,
    };
    showGesture({ kind: 'pointer', activityId: activity.id, lifted: false, over: null });
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.lifted) {
      if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) < LIFT_PX) return;
      drag.lifted = true;
      showGesture({ kind: 'pointer', activityId: drag.activity.id, lifted: true, over: null });
    }
    const node = cloneRef.current;
    if (node) placeClone(node, drag);
    const strip = stripRef.current;
    if (strip) scrollStripByClientX(strip, event.clientX);
    aimPointer(columnAtPoint(event.clientX, event.clientY));
    kickStripScroll();
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    finishPointer(true, event.clientX, event.clientY);
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    finishPointer(false, event.clientX, event.clientY);
  }

  function onLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    finishPointer(false, event.clientX, event.clientY);
  }

  function onKeyDown(activity: AgendaActivity, event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key !== 'Enter' && key !== ' ' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Escape') return;
    event.preventDefault();
    if (event.repeat || busy) return;
    const drag = dragRef.current;
    if (key === 'Escape' && drag?.activity.id === activity.id) {
      if (event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
      else finishPointer(false, drag.x, drag.y);
      return;
    }
    if (held.has(activity.id)) return;
    const current = gestureRef.current;
    if (current.kind === 'keyboard' && current.activityId === activity.id) {
      if (key === 'Escape') { showGesture({ kind: 'idle' }); setAnnouncement(''); return; }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const next = adjacentStatus(current.over, key === 'ArrowRight' ? 1 : -1);
        if (!next) return;
        showGesture({ kind: 'keyboard', activityId: activity.id, over: next });
        if (stripRef.current) revealColumn(stripRef.current, next);
        setAnnouncement(moveCopy('preview', next));
        return;
      }
      if (key !== 'Enter' && key !== ' ') return;
      if (current.over === activity.status) return;
      const over = current.over;
      showGesture({ kind: 'idle' });
      move(activity, over);
      setAnnouncement(moveCopy('commit', over));
      requestAnimationFrame(() => { document.querySelector<HTMLButtonElement>(`[data-move-handle="${CSS.escape(activity.id)}"]`)?.focus(); });
      return;
    }
    if ((key === 'Enter' || key === ' ') && !drag) showGesture({ kind: 'keyboard', activityId: activity.id, over: activity.status });
  }

  const aimed = gesture.kind === 'keyboard' ? gesture.over : gesture.kind === 'pointer' && gesture.lifted ? gesture.over : null;
  const dragged = gesture.kind === 'pointer' && gesture.lifted ? dragRef.current : null;

  return <>
    <div ref={stripRef} role="region" aria-label="Quadro de tarefas" tabIndex={0} className="grid min-w-0 grid-flow-col auto-cols-[85%] overflow-x-auto overscroll-x-contain border-t border-line focus-visible:ring-2 focus-visible:ring-ring md:auto-cols-[45%] xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-4">
      {taskColumns.map(column => {
        const tasks = activities.filter(activity => activity.status === column.status);
        const highlighted = aimed === column.status;
        return <section key={column.status} aria-label={column.title} data-column={column.status} data-over={highlighted ? '' : undefined} className={`min-w-0 border-r border-b border-line px-3 pb-5 first:pl-0 ${highlighted ? 'shadow-[inset_0_0_0_2px_var(--foreground)]' : ''}`}>
          <h2 className="flex min-h-14 items-center justify-between gap-3 text-sm font-medium">{column.title}<span className="label-mono text-muted-foreground">{tasks.length}</span></h2>
          <div className="divide-y">{tasks.length ? tasks.map(activity => {
            const locked = held.has(activity.id) || (gesture.kind !== 'idle' && gesture.activityId === activity.id);
            const lifted = gesture.kind === 'pointer' && gesture.lifted && gesture.activityId === activity.id;
            return <article key={activity.id} className={`space-y-3 py-4 ${lifted ? 'pointer-events-none' : ''}`}>
              <button type="button" disabled={locked} onClick={() => inspect(activity)} className="min-h-11 break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{activity.title}</button>
              {activity.notes && <p className="line-clamp-3 break-words text-xs text-muted-foreground">{activity.notes}</p>}
              <p className="text-xs text-muted-foreground">{activity.dueOn ? new Date(`${activity.dueOn}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data'}</p>
              {(activity.clientId || activity.assigneeId) && <p className="break-words text-xs text-muted-foreground">{[clients.find(item => item.id === activity.clientId)?.name, members.find(item => item.id === activity.assigneeId)?.name].filter(Boolean).join(' · ')}</p>}
              <button type="button" data-move-handle={activity.id} aria-label={`Mover ${activity.title}`} disabled={busy && !lifted} aria-disabled={held.has(activity.id) || undefined}
                onPointerDown={event => onPointerDown(activity, event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onLostPointerCapture}
                onKeyDown={event => onKeyDown(activity, event)} onBlur={() => { const current = gestureRef.current; if (current.kind === 'keyboard' && current.activityId === activity.id) { showGesture({ kind: 'idle' }); setAnnouncement(''); } }}
                className={`h-11 w-full touch-none rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-disabled:opacity-50 md:h-9 ${lifted ? 'pointer-events-auto' : ''}`}>Mover</button>
              {activity.agentConversationId ? (activity.status === 'pending' || activity.status === 'in_progress')
                ? <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy || locked} onClick={() => delegate(activity)}>Abrir sessão do Lume</Button>
                : <Link className="flex min-h-11 items-center text-sm text-brand-ink underline underline-offset-4" href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`}>Abrir sessão do Lume</Link>
                : (activity.status === 'pending' || activity.status === 'in_progress') && <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy || locked} onClick={() => delegate(activity)}>Delegar ao Lume</Button>}
            </article>;
          }) : <p className="py-4 text-sm text-muted-foreground">Nenhuma tarefa.</p>}</div>
        </section>;
      })}
    </div>
    <p className="sr-only" aria-live="assertive">{announcement}</p>
    {dragged && createPortal(<div ref={cloneRef} aria-hidden="true" className="pointer-events-none fixed top-0 left-0 z-50 border border-line bg-background px-3 py-3 text-sm font-medium">{dragged.activity.title}</div>, document.body)}
  </>;
}
