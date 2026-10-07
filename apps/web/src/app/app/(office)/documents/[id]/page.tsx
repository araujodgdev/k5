import type { Metadata } from "next";
import { DocumentWorkspace } from "@/components/document/document-workspace";
import { requireWorkspace } from '@/lib/session';
import { workspaceContext } from '@/lib/application/context';
import { authorizedCanvasResource } from '@/lib/canvas-resources';
import { CanvasResource } from '@/components/lume/workspace-context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: "Documento" };

export default async function DocumentPage({ params }: PageProps<"/app/documents/[id]">) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const resource = await authorizedCanvasResource(workspaceContext(workspace), `/app/documents/${encodeURIComponent(id)}`).catch(error => {
    if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  return <><CanvasResource resource={resource} /><DocumentWorkspace resource={{ kind: 'artifact', id }} /></>;
}
