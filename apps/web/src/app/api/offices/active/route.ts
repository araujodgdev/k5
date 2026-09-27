import { cookies } from 'next/headers';
import { z } from 'zod';
import { apiPersonalWorkspace, apiError, ApiError, limitedJson } from '@/lib/workspace-api';
import { ACTIVE_OFFICE_COOKIE, findOfficeForUser } from '@/lib/offices';
import { database } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request, true);
    const { officeId } = z.object({ officeId: z.string().min(1).max(200) }).parse(await limitedJson(request, 2000));
    if (!await findOfficeForUser(database, user.id, officeId)) throw new ApiError(403, 'Você não faz parte deste escritório.');
    (await cookies()).set(ACTIVE_OFFICE_COOKIE, officeId, { httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/' });
    return Response.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
