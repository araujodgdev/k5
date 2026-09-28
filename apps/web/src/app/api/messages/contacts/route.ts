import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { contactQuery } from '@/lib/personal-chat/domain';
import { listContacts } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const [person, workspace] = await Promise.all([apiPerson(request), apiPersonalWorkspace(request)]);
    return Response.json(await listContacts(person, workspace.office.officeId, contactQuery.parse(Object.fromEntries(url.searchParams))), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
