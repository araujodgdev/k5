import { officePage } from '@/components/lume/canvas-leaf';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CanvasResource } from '@/components/lume/workspace-context';
import { requireWorkspace } from '@/lib/session';
import { workspaceContext } from '@/lib/application/context';
import { authorizedCanvasResource } from '@/lib/canvas-resources';
import { documentAccess } from '@/lib/collaboration/access';
import { CapabilityError } from '@/lib/capabilities/errors';
import { findVaultDocument, getDocumentChunks } from '@/lib/vault';

export const metadata = { title: 'Arquivo do Cofre' };

async function VaultFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = workspaceContext(await requireWorkspace());
  const resource = await authorizedCanvasResource(context, `/app/vault/files/${encodeURIComponent(id)}`).catch(error => {
    if (error instanceof CapabilityError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const access = await documentAccess(context, id);
  const file = await findVaultDocument(access.officeId, id, context.userId);
  if (!file) notFound();
  const chunks = file.status === 'ready' ? await getDocumentChunks(access.officeId, context.userId, [id]) : [];
  const folder = file.folderId ? `?folder=${encodeURIComponent(file.folderId)}` : '';
  const back = file.caseId ? `/app/vault/cases/${encodeURIComponent(file.caseId)}${folder}` : '/app/vault/library';
  return <>
    <CanvasResource resource={resource} />
    <article className="w-full max-w-4xl px-5 py-6 md:px-10 md:py-10">
      <Link href={back} className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4">{file.caseName ?? 'Biblioteca'}</Link>
      <h1 className="page-title mt-3 break-words">{file.name}</h1>
      <a href={`/api/vault/documents/${encodeURIComponent(id)}/download`} download className="my-5 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground">Baixar original</a>
      {file.status === 'failed' ? <p role="alert" className="text-sm text-destructive">{file.errorMessage ?? 'Não foi possível processar este arquivo.'}</p>
        : file.status !== 'ready' ? <p role="status" className="text-sm text-muted-foreground">Arquivo em processamento. O original está disponível para baixar.</p>
        : <section aria-label="Texto extraído do arquivo" className="grid gap-6 border-t pt-6">
          <h2 className="text-sm font-medium">Texto extraído</h2>
          {chunks.length ? chunks.map(chunk => <div key={chunk.id}><p className="mb-2 text-xs text-muted-foreground">{chunk.sourceLabel}</p><p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">{chunk.content}</p></div>) : <p className="text-sm text-muted-foreground">Este arquivo não possui texto extraído. Consulte o original.</p>}
        </section>}
    </article>
  </>;
}

export default officePage('/app/vault/files/[id]', VaultFilePage);
