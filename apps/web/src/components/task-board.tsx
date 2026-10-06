'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import type { AgendaActivity } from '@/lib/capabilities/agenda';
import type { Choice } from '@/lib/agenda-client';
import { taskColumns, type TaskStatus } from './task-moves';

const columnOrder: readonly string[] = taskColumns.map(column => column.status);
const keyboardCodes = { start: ['Space', 'Enter'], cancel: ['Escape', 'Tab'], end: ['Space', 'Enter'] };
const dueLabel = (activity: AgendaActivity) => activity.dueOn ? new Date(`${activity.dueOn}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data';

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

function Column({ status, title, count, children }: { status: TaskStatus; title: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: status });
  const target = isOver && active?.data.current?.status !== status;
  return <section ref={setNodeRef} aria-label={title} className={`min-h-40 min-w-0 border-r border-b border-line px-3 pb-5 transition-shadow duration-200 ease-(--ease) first:pl-0 ${target ? 'shadow-[inset_0_2px_0_var(--color-brand)]' : ''}`}>
    <h2 className="flex min-h-14 items-center justify-between gap-3 text-sm font-medium">{title}<span className="label-mono text-muted-foreground">{count}</span></h2>
    {children}
  </section>;
}

function Card({ activity, saving, busy, members, clients, delegate, restoreFocusRef }: {
  activity: AgendaActivity; saving: boolean; busy: boolean; members: Choice[]; clients: Choice[]; delegate: (activity: AgendaActivity) => void;
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
  return <article ref={setNodeRef} aria-busy={saving} className={`space-y-3 py-4 ${isDragging ? 'opacity-40' : ''}`}>
    <div className="flex items-start justify-between gap-2">
      <Link href={`/app/agenda/tasks/${encodeURIComponent(activity.id)}?from=kanban`} prefetch={false} className="inline-flex min-h-11 min-w-0 items-center text-sm font-medium wrap-anywhere underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">{activity.title}</Link>
      <button ref={node => { grip.current = node; setActivatorNodeRef(node); }} type="button" aria-label={`Arrastar ${activity.title}`} {...attributes} {...listeners}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-40">
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
    </div>
    {activity.notes && <p className="line-clamp-3 break-words text-xs text-muted-foreground">{activity.notes}</p>}
    <p className="text-xs text-muted-foreground">{dueLabel(activity)}</p>
    {(activity.clientId || activity.assigneeId) && <p className="break-words text-xs text-muted-foreground">{[clients.find(item => item.id === activity.clientId)?.name, members.find(item => item.id === activity.assigneeId)?.name].filter(Boolean).join(' · ')}</p>}
    {saving && <p className="text-xs text-muted-foreground">Salvando…</p>}
    {activity.agentConversationId ? open
      ? <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy} onClick={() => delegate(activity)}>Abrir sessão do Lume</Button>
      : <Link className="flex min-h-11 items-center text-sm text-brand-ink underline underline-offset-4" href={`/app/agents?conversationId=${encodeURIComponent(activity.agentConversationId)}${activity.caseId ? `&caseId=${encodeURIComponent(activity.caseId)}` : ''}`}>Abrir sessão do Lume</Link>
      : open && <Button variant="ghost" className="w-full justify-start px-0 text-brand-ink" disabled={busy} onClick={() => delegate(activity)}>Delegar ao Lume</Button>}
  </article>;
}

export function TaskBoard({ activities, members, clients, busy, saving, move, delegate }: {
  activities: AgendaActivity[]; members: Choice[]; clients: Choice[]; busy: boolean; saving: ReadonlySet<string>;
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
    <div role="region" aria-label="Quadro de tarefas" tabIndex={0} className="grid min-w-0 grid-flow-col auto-cols-[85%] overflow-x-auto border-t border-line focus-visible:ring-2 focus-visible:ring-ring md:auto-cols-[45%] xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-4">
      {taskColumns.map(column => {
        const tasks = activities.filter(activity => activity.status === column.status);
        return <Column key={column.status} status={column.status} title={column.title} count={tasks.length}>
          <div className="divide-y">{tasks.length ? tasks.map(activity => <Card key={activity.id} activity={activity} saving={saving.has(activity.id)} busy={busy} members={members} clients={clients} delegate={delegate} restoreFocusRef={restoreFocusRef} />)
            : <p className="py-4 text-sm text-muted-foreground">Nenhuma tarefa.</p>}</div>
        </Column>;
      })}
    </div>
    {createPortal(<DragOverlay style={{ pointerEvents: 'none' }} dropAnimation={window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : { duration: 250, easing: 'cubic-bezier(.16, 1, .3, 1)' }}>
      {dragging && <div aria-hidden="true" className="h-full border border-line bg-background px-3 py-3 shadow-[var(--shadow-float)]">
        <p className="break-words text-sm font-medium">{dragging.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{dueLabel(dragging)}</p>
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}
