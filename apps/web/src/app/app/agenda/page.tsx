import { requireWorkspace } from '@/lib/session';
import { AgendaWorkspace } from '@/components/agenda-workspace';

export const metadata = { title: 'Tarefas e Agenda' };

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { office } = await requireWorkspace();
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const view = value('view') === 'calendar' ? 'calendar' : value('view') === 'clients' ? 'clients' : 'tasks';
  return <AgendaWorkspace key={JSON.stringify([value('caseId'), value('clientId'), value('activityId'), value('proposalId'), view, value('action')])} role={office.role} initialView={view} initialAction={value('action')} initialCaseId={value('caseId')} initialClientId={value('clientId')} initialActivityId={value('activityId')} initialProposalId={value('proposalId')} />;
}
