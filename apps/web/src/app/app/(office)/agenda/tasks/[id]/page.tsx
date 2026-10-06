import { requireWorkspace } from '@/lib/session';
import { TaskDetail } from '@/components/task-detail';

export const metadata = { title: 'Tarefa' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <TaskDetail key={id} taskId={id} />;
}
