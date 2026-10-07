import 'server-only';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { listCases } from '@/lib/application/vault-service';
import { listCaseTasks } from '@/lib/case-tasks/service';
import { caseActivity, type CaseActivity } from '@/lib/case-collaboration';
import { CapabilityError } from '@/lib/capabilities/errors';

export type HomeOverview = {
  cases: { id: string; name: string; description: string | null; updatedAt: string }[];
  tasks: { id: string; caseId: string; caseName: string; title: string; dueOn: string }[];
  activity: (CaseActivity & { caseName: string })[];
  partial: { tasks: boolean; activity: boolean };
};

export async function homeOverview(context: WorkspaceContext, today: string): Promise<HomeOverview> {
  await assertCapabilityAllowed(context, 'k5_vault_list_cases');
  const { cases } = await listCases(context);
  cases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const result: HomeOverview = { cases: cases.slice(0, 6).map(({ id, name, description, updatedAt }) => ({ id, name, description, updatedAt })), tasks: [], activity: [], partial: { tasks: false, activity: false } };
  for (const record of cases) {
    try {
      const { tasks } = await listCaseTasks(context, { caseId: record.id });
      for (const task of tasks) if (task.dueOn && task.dueOn <= today && (task.status === 'pending' || task.status === 'in_progress')) {
        result.tasks.push({ id: task.id, caseId: record.id, caseName: record.name, title: task.title, dueOn: task.dueOn });
      }
    } catch (error) {
      if (error instanceof CapabilityError && error.code === 'UNAUTHENTICATED') throw error;
      result.partial.tasks = true;
    }
  }
  for (const record of result.cases) {
    try {
      const { activity } = await caseActivity(context, record.id);
      result.activity.push(...activity.map(item => ({ ...item, caseName: record.name })));
    } catch (error) {
      if (error instanceof CapabilityError && error.code === 'UNAUTHENTICATED') throw error;
      result.partial.activity = true;
    }
  }
  await assertCapabilityAllowed(context, 'k5_vault_list_cases');
  result.tasks.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  result.activity.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  result.activity = result.activity.slice(0, 8);
  return result;
}
