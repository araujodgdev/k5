import { apiWorkspace, limitedJson, apiError } from '@/lib/workspace-api';
import { database } from '@/lib/database';
import { feedbackView, submitFeedback } from '@/lib/feedback-core';
import { assertSameOrigin, platformErrorResponse, PlatformRequestError } from '@/lib/platform-core';

export async function GET(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request);
    return Response.json(await feedbackView(database, { userId: user.id, officeId: office.officeId }), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return error instanceof PlatformRequestError ? platformErrorResponse(error) : apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user, office } = await apiWorkspace(request);
    const input = await limitedJson(request, 32_000);
    return Response.json(await submitFeedback(database, { userId: user.id, officeId: office.officeId }, input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return error instanceof PlatformRequestError ? platformErrorResponse(error) : apiError(error); }
}
