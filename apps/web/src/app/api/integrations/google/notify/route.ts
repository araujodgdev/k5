import { acceptCalendarNotification } from '@/lib/google/calendar/sync';

/** Google push carries only a hint. The token, channel and resource are validated before enqueueing. */
export async function POST(request: Request) {
  const outcome = await acceptCalendarNotification(request.headers);
  return new Response(null, { status: outcome === 'queued' ? 202 : 204 });
}
