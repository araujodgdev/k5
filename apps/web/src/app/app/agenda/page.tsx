import { requireWorkspace } from '@/lib/session';
import { AgendaWorkspace } from '@/components/agenda-workspace';
import { CollaborationPanel } from '@/components/collaboration-panel';
import { OfficeActivity } from '@/components/office-activity';

export const metadata = { title: 'Escritório' };

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { office } = await requireWorkspace();
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const peopleView = value('view');
  if (peopleView === 'activity') return <OfficeActivity officeId={office.officeId} source={value('source')} before={value('before')} />;
  if (peopleView === 'associates' || peopleView === 'invites') return <CollaborationPanel key={peopleView} view={peopleView} />;
  const view = value('view') === 'calendar' ? 'calendar' : value('view') === 'clients' ? 'clients' : 'tasks';
  return <AgendaWorkspace key={JSON.stringify([value('caseId'), value('clientId'), value('activityId'), value('proposalId'), value('personalEventId'), view, value('action')])} initialTaskLayout={value('layout') === 'kanban' ? 'kanban' : 'list'} initialView={view} initialAction={value('action')} initialCaseId={value('caseId')} initialClientId={value('clientId')} initialActivityId={value('activityId')} initialProposalId={value('proposalId')} initialPersonalEventId={value('personalEventId')} />;
}
