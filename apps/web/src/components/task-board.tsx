'use client';

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import { cn } from '@/lib/utils';
import { LumeMark } from './lume-mark';
import { contextOf, dayMonth, isUrgent, type Names } from './agenda-rows';
import { taskColumns, type TaskStatus } from './task-moves';

const columnOrder: readonly string[] = taskColumns.map(column => column.status);
const keyboardCodes = { start: ['Space', 'Enter'], cancel: ['Escape', 'Tab'], end: ['Space', 'Enter'] };
const dueLabel = (activity: AgendaActivity, today: string) => !activity.dueOn ? 'sem data' : activity.dueOn === today ? 'hoje' : dayMonth(activity.dueOn);
const lumeAction = 'inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-[13px] text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 md:min-h-7';

// The drop animation runs through the Web Animations API, which cannot resolve `var(--ease)`, so the token is read from the page.
const tokenEase = () => getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease-out';

const collide: CollisionDetection = args => args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

// dnd-kit's keyboard sensor scrolls when the target crosses the scroller's midpoint.
const stepColumn: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (!step) return undefined;
  event.preventDefault();
  const target = context.over ? columnOrder[columnOrder.indexOf(String(context.over.id)) + step] : undefined;
  const rect = target ? context.droppableRects.get(target) : undefined;
  return rect ? { x: rect.left, y: currentCoordinates.y } : undefined;
};

function Column({ status, title, count, children }: { status: TaskStatus; title: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: status });
  const target = isOver && active?.data.current?.status !== status;
  return <section ref={setNodeRef} aria-label={title} className={cn('flex min-h-40 min-w-0 flex-col gap-2 rounded-lg p-1.5 transition-colors duration-200 ease-(--ease)', target ? 'bg-selected' : 'bg-muted/60')}>
    <h2 className="flex h-8 items-center justify-between gap-3 px-1.5 text-[13px] font-medium">{title}<span className="font-mono text-[12.5px] font-normal text-muted-foreground">{count}</span></h2>
    {children}
  </section>;
}

function Card({ activity, today, names, saving, busy, delegate, restoreFocusRef }: {
  activity: AgendaActivity; today: string; names: Names; saving: boolean; busy: boolean; delegate: (activity: AgendaActivity) => void;
  restoreFocusRef: RefObject<string | null>;
}) {
  const grip = useRef<HTMLButtonElement | null>(null);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: activity.id, data: { status: activity.status }, disabled: saving, attributes: { roleDescription: 'cartão arrastável' },
  });
  useLayoutEffect(() => {
    const node = grip.current;
    if (restoreFocusRef.current === activity.id) {
      if (document.activeElement === document.body) node?.focus();
      restoreFocusRef.current = null;
    }
    return () => {
      if (node === document.activeElement) restoreFocusRef.current = activity.id;
    };
  }, [activity.id, restoreFocusRef]);
  const open = activity.status === 'pending' || activity.status === 'in_progress';
  const overdue = open && Boolean(activity.dueOn) && activity.dueOn! < today;
  const about = contextOf(activity, names);
  return <article ref={setNodeRef} aria-busy={saving} className={cn('flex flex-col gap-1.5 rounded-lg border border-border bg-card py-2.5 pr-1.5 pl-3 transition-[border-color,opacity] hover:border-border-strong', isDragging && 'opacity-40')}>
    <div className="flex items-start justify-between gap-1">
      <Link href={`/app/agenda/tasks/${encodeURIComponent(activity.id)}?from=kanban`} prefetch={false} className="min-w-0 py-0.5 text-sm font-medium wrap-anywhere underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{activity.title}</Link>
      <button ref={node => { grip.current = node; setActivatorNodeRef(node); }} type="button" aria-label={`Arrastar ${activity.title}`} {...attributes} {...listeners}
        className="-mt-0.5 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-40 md:size-7">
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
    </div>
    {about && <p className="pr-1.5 text-[12.5px] break-words text-muted-foreground">{about}</p>}
    <p className="flex items-center gap-1.5 font-mono text-[12.5px]">{isUrgent(activity, today) && <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />}{dueLabel(activity, today)}{overdue && <span className="font-sans text-xs text-muted-foreground">atrasada</span>}</p>
    {saving && <p role="status" className="text-xs text-muted-foreground">Salvando…</p>}
    {activity.agentConversationId ? open
      ? <button type="button" className={lumeAction} disabled={busy} onClick={() => delegate(activity)}><LumeMark aria-hidden="true" className="size-3.5" />Abrir sessão do Lume</button>
      : <Link className={lumeAction} href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`}><LumeMark aria-hidden="true" className="size-3.5" />Abrir sessão do Lume</Link>
      : open && <button type="button" className={lumeAction} disabled={busy} onClick={() => delegate(activity)}><LumeMark aria-hidden="true" className="size-3.5" />Delegar ao Lume</button>}
  </article>;
}

export function TaskBoard({ activities, names, today, busy, saving, move, delegate }: {
  activities: AgendaActivity[]; names: Names; today: string; busy: boolean; saving: ReadonlySet<string>;
  move: (id: string, status: TaskStatus) => void;
  delegate: (activity: AgendaActivity) => void;
}) {
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | null>(null);
  const restoreFocusRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stepColumn, keyboardCodes, scrollBehavior: 'auto' }),
  );
  const dragging = activities.find(activity => activity.id === draggingId);
  const titleOf = (id: UniqueIdentifier) => activities.find(activity => activity.id === id)?.title;
  const columnOf = (id: UniqueIdentifier) => taskColumns.find(column => column.status === id)?.title;
  const placeOf = (id: UniqueIdentifier) => columnOf(activities.find(activity => activity.id === id)?.status ?? '');
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Você pegou “${titleOf(active.id)}”, em ${placeOf(active.id)}.`,
    onDragOver: ({ active, over }) => over ? `“${titleOf(active.id)}” está sobre ${columnOf(over.id)}.` : `“${titleOf(active.id)}” está fora do quadro.`,
    onDragEnd: ({ active, over }) => !over ? `“${titleOf(active.id)}” foi solta fora do quadro. Nada mudou.`
      : columnOf(over.id) === placeOf(active.id) ? `“${titleOf(active.id)}” continua em ${placeOf(active.id)}.`
      : `“${titleOf(active.id)}” foi movida para ${columnOf(over.id)}.`,
    onDragCancel: ({ active }) => `Movimento cancelado. “${titleOf(active.id)}” continua em ${placeOf(active.id)}.`,
  };
  function drop({ active, over }: DragEndEvent) {
    setDraggingId(null);
    const column = taskColumns.find(item => item.status === over?.id);
    if (column) move(String(active.id), column.status);
  }

  return <DndContext sensors={sensors} collisionDetection={collide} onDragStart={({ active }) => setDraggingId(active.id)} onDragEnd={drop} onDragCancel={() => setDraggingId(null)}
    accessibility={{ announcements, screenReaderInstructions: { draggable: 'Para mover, pressione Espaço ou Enter. Use as setas para a esquerda e para a direita para escolher a coluna, Espaço ou Enter para soltar e Esc para cancelar.' } }}>
    <div role="region" aria-label="Quadro de tarefas" tabIndex={0} className="-mx-4 grid min-w-0 grid-flow-col auto-cols-[85%] gap-3 overflow-x-auto px-4 pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:mx-0 md:auto-cols-[45%] md:px-0 xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-4">
      {taskColumns.map(column => {
        const tasks = activities.filter(activity => activity.status === column.status);
        return <Column key={column.status} status={column.status} title={column.title} count={tasks.length}>
          {tasks.length ? tasks.map(activity => <Card key={activity.id} activity={activity} today={today} names={names} saving={saving.has(activity.id)} busy={busy} delegate={delegate} restoreFocusRef={restoreFocusRef} />)
            : <p className="px-1.5 pb-2 text-[13px] text-muted-foreground">Nenhuma tarefa.</p>}
        </Column>;
      })}
    </div>
    {createPortal(<DragOverlay style={{ pointerEvents: 'none' }} dropAnimation={window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : { duration: 250, easing: tokenEase() }}>
      {dragging && <div aria-hidden="true" className="h-full rounded-lg border border-border-strong bg-card px-3 py-2.5 shadow-[var(--shadow-float)]">
        <p className="text-sm font-medium break-words">{dragging.title}</p>
        <p className="mt-1.5 font-mono text-[12.5px]">{dueLabel(dragging, today)}</p>
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
