import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse } from '@/lib/platform-core';
import { ticketAttachment } from '@/lib/feedback-tickets';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requirePlatformRequest(request);
    const file = await ticketAttachment(user.id, (await context.params).id);
    if (!file) return Response.json({ error: 'Anexo indisponível.' }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), { headers: {
      'Content-Type': file.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
    } });
  } catch (error) { return platformErrorResponse(error); }
}
