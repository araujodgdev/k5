import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** Confirms ownership before handing back an export route and the real file name. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_artifacts_export_docx', { artifactId: (await context.params).id });
}
