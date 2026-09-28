import { apiError, apiPersonalWorkspace, ApiError, limitedFormData } from '@/lib/workspace-api';
import { removeAvatar, setAvatar } from '@/lib/profile';
import { avatarMaxBytes } from '@/lib/profile-contract';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request, true);
    const form = await limitedFormData(request, avatarMaxBytes + 16_000);
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'Escolha uma foto.');
    return Response.json({ profile: await setAvatar(user.id, Buffer.from(await file.arrayBuffer()), file.type) }, { headers });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request, true);
    return Response.json({ profile: await removeAvatar(user.id) }, { headers });
  } catch (error) { return apiError(error); }
}
