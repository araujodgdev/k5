import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';
import { ownProfile, updateProfile } from '@/lib/profile';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request);
    return Response.json({ profile: await ownProfile(user.id) }, { headers });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request, true);
    return Response.json({ profile: await updateProfile(user.id, await limitedJson(request, 8000)) }, { headers });
  } catch (error) { return apiError(error); }
}
