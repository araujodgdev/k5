import { z } from 'zod';
import { verifyCurrentPassword } from '@/lib/auth';
import { ApiError, apiError, apiWorkspace, limitedJson } from '@/lib/workspace-api';
import { cancelOfficeDeletion, openDeletionRequest, requestOfficeDeletion } from '@/lib/office-deletion';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const { office } = await apiWorkspace(request);
    return Response.json({ request: await openDeletionRequest(office.officeId) ?? null }, { headers });
  } catch (error) { return apiError(error); }
}

/** Schedules the deletion of the office and account; the current password confirms who asks. */
export async function POST(request: Request) {
  try {
    const { office, user } = await apiWorkspace(request, true);
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(await limitedJson(request, 1_024));
    if (!await verifyCurrentPassword(user.id, password)) throw new ApiError(400, 'Senha atual incorreta.');
    return Response.json({ request: await requestOfficeDeletion({ officeId: office.officeId, userId: user.id }) }, { status: 201, headers });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { office } = await apiWorkspace(request, true);
    if (!await cancelOfficeDeletion(office.officeId)) throw new ApiError(409, 'Não há exclusão agendada para cancelar.');
    return new Response(null, { status: 204, headers });
  } catch (error) { return apiError(error); }
}
