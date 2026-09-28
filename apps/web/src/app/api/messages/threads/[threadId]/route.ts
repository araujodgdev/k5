import { apiError } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { getThread } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: {
  params: Promise<{
    threadId: string;
  }>;
}) {
  try {
    return Response.json({ thread: await getThread(await apiPerson(request), (await params).threadId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
