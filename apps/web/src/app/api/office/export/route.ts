import { makeZip } from 'client-zip';
import { apiError, apiWorkspace } from '@/lib/workspace-api';
import { officeExportEntries } from '@/lib/office-export';

export const runtime = 'nodejs';

/** Streams the office's data and Cofre originals as a ZIP; nothing is assembled in memory or storage. */
export async function GET(request: Request) {
  try {
    const { office, user } = await apiWorkspace(request);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(makeZip(officeExportEntries({ officeId: office.officeId, userId: user.id })), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="lume-exportacao-${day}.zip"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) { return apiError(error); }
}
