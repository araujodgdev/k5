import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { TaskDetail } from '@/components/task-detail';

export const metadata = { title: 'Tarefa' };

async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <TaskDetail key={id} taskId={id} from={query.from === 'kanban' ? 'kanban' : 'list'} />;
}

export default officePage('/app/agenda/tasks/[id]', TaskPage);
