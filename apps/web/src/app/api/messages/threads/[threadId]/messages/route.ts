import { apiError, limitedJson } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { messageQuery, sendMessageInput } from '@/lib/personal-chat/domain';
import { listMessages, sendMessage } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request, { params }: {
  params: Promise<{
    threadId: string;
  }>;
}) {
  try {
    const url = new URL(request.url);
    return Response.json(await listMessages(await apiPerson(request), (await params).threadId, messageQuery.parse(Object.fromEntries(url.searchParams))), { headers });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, { params }: {
  params: Promise<{
    threadId: string;
  }>;
}) {
  try {
    return Response.json(await sendMessage(await apiPerson(request, true), (await params).threadId, sendMessageInput.parse(await limitedJson(request, 32000))), { status: 201, headers });
  } catch (error) {
    return apiError(error);
  }
}
