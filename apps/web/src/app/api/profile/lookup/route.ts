import { apiError, apiPersonalWorkspace } from '@/lib/workspace-api';
import { profileCardForEmail } from '@/lib/profile';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request);
    const email = new URL(request.url).searchParams.get('email') ?? '';
    return Response.json({ profile: await profileCardForEmail(user.id, email) }, { headers });
  } catch (error) { return apiError(error); }
}
