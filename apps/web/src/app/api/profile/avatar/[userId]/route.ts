import { apiError, apiPersonalWorkspace, ApiError } from '@/lib/workspace-api';
import { readAvatar } from '@/lib/profile';

export const runtime = 'nodejs';
type Context = { params: Promise<{ userId: string }> };

/** Photos are seen by signed-in people only. The URL carries a version, so a new photo is a new URL. */
export async function GET(request: Request, context: Context) {
  try {
    await apiPersonalWorkspace(request);
    const avatar = await readAvatar((await context.params).userId);
    if (!avatar) throw new ApiError(404, 'Foto não encontrada.');
    return new Response(new Uint8Array(avatar.avatar), { headers: {
      'Content-Type': avatar.type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) { return apiError(error); }
}
