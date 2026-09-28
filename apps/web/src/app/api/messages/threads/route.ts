import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { pageQuery, startThreadInput } from '@/lib/personal-chat/domain';
import { listThreads, startThread } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await listThreads(await apiPerson(request), pageQuery.parse(Object.fromEntries(url.searchParams))), { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
export async function POST(request: Request) {
  try {
    const [person, workspace] = await Promise.all([apiPerson(request, true), apiPersonalWorkspace(request, true)]);
    return Response.json(await startThread(person, workspace.office.officeId, startThreadInput.parse(await limitedJson(request, 8000))), { status: 201, headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
