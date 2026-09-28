import { apiError, limitedJson } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { markReadInput } from '@/lib/personal-chat/domain';
import { markRead } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: {
  params: Promise<{
    threadId: string;
  }>;
}) {
  try {
    const input = markReadInput.parse(await limitedJson(request, 2000));
    return Response.json(await markRead(await apiPerson(request, true), (await params).threadId, input.throughMessageId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
