import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { platformTicket, updateTicket } from '@/lib/feedback-tickets';
import { ticketUpdate } from '@/lib/feedback-tickets-contract';

type Context = { params: Promise<{ id: string }> };
const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request, context: Context) {
  try {
    const { user } = await requirePlatformRequest(request);
    const ticket = await platformTicket(user.id, (await context.params).id);
    return ticket ? Response.json({ ticket }, { headers: noStore }) : Response.json({ error: 'Ticket não encontrado.' }, { status: 404 });
  } catch (error) { return platformErrorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    const ticket = await updateTicket(user.id, (await context.params).id, await readPlatformJson(request, ticketUpdate, 12_000));
    return Response.json({ ticket }, { headers: noStore });
  } catch (error) { return platformErrorResponse(error); }
}
