import { apiWorkspace, apiError } from '@/lib/workspace-api';
import { database } from '@/lib/database';
import { feedbackFile } from '@/lib/feedback-core';
import { platformErrorResponse, PlatformRequestError } from '@/lib/platform-core';

export async function GET(request: Request, { params }: { params: Promise<{ side: string; kind: string }> }) {
  try {
    const { user, office } = await apiWorkspace(request);
    const { side, kind } = await params;
    const campaignId = new URL(request.url).searchParams.get('campaign') ?? undefined;
    const file = await feedbackFile(database, { userId: user.id, officeId: office.officeId }, side, kind, campaignId);
    return new Response(new Uint8Array(file.bytes), { headers: { 'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return error instanceof PlatformRequestError ? platformErrorResponse(error) : apiError(error); }
}
