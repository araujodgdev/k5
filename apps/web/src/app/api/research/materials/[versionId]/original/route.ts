import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { getResearchOriginal } from '@/lib/application/research-service';
import { ResearchError } from '@/lib/research/contracts';
import { CapabilityError } from '@/lib/capabilities/errors';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const [{ versionId }, workspace] = await Promise.all([params, apiPersonalWorkspace(request)]);
    const { bytes, mimeType } = await getResearchOriginal(workspaceContext(workspace), versionId);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const pdf = mimeType === 'application/pdf';
    return new Response(copy.buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(copy.byteLength),
        'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="julgado-${versionId}.${pdf ? 'pdf' : 'txt'}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const mapped = error instanceof ResearchError ? new CapabilityError(
      error.code === 'forbidden' ? 'FORBIDDEN' : error.code === 'not_found' ? 'NOT_FOUND' : 'NOT_READY', error.message,
    ) : error;
    const response = apiError(mapped);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
