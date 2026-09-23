import { apiWorkspace, apiError, ApiError } from '@/lib/workspace-api';
import { createTicket, listAuthorTickets } from '@/lib/feedback-tickets';
import { MAX_FEEDBACK_IMAGE_BYTES } from '@/lib/feedback-tickets-contract';
import { assertSameOrigin, platformErrorResponse, PlatformRequestError } from '@/lib/platform-core';

const noStore = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) { return error instanceof PlatformRequestError ? platformErrorResponse(error) : apiError(error); }

export async function GET(request: Request) {
  try {
    const { user, office } = await apiWorkspace(request);
    return Response.json({ tickets: await listAuthorTickets({ userId: user.id, officeId: office.officeId }) }, { headers: noStore });
  } catch (error) { return failure(error); }
}

/** Every office role, reviewers included, may report; nothing here writes business data. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user, office } = await apiWorkspace(request);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Descreva o que aconteceu.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEEDBACK_IMAGE_BYTES + 64_000) { await reader.cancel(); throw new ApiError(413, 'O print deve ter até 5 MB.'); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
    const image = form.get('image');
    const ticket = await createTicket({ userId: user.id, officeId: office.officeId },
      { message: form.get('message'), pagePath: form.get('pagePath') ?? '' },
      image instanceof File && image.size ? image : null, request.headers.get('user-agent') ?? '');
    return Response.json({ ticket }, { status: 201, headers: noStore });
  } catch (error) { return failure(error); }
}
