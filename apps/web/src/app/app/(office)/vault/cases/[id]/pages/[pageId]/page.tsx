import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';
import { workspaceContext } from '@/lib/application/context';
import { authorizedCanvasResource } from '@/lib/canvas-resources';
import { CapabilityError } from '@/lib/capabilities/errors';
import { DocumentWorkspace } from '@/components/document/document-workspace';
import { CanvasResource } from '@/components/lume/workspace-context';
import { documentHref } from '@/lib/document-ref';

export const metadata = { title: 'Página do caso' };
export default async function CasePage({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id: caseId, pageId: id } = await params;
  const document = { kind: 'case-page' as const, caseId, id };
  const resource = await authorizedCanvasResource(workspaceContext(await requireWorkspace()), documentHref(document)).catch(error => {
    if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  return <><CanvasResource resource={resource} /><DocumentWorkspace resource={document} /></>;
}
