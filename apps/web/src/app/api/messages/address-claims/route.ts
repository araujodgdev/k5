import { apiError, limitedJson } from '@/lib/workspace-api';
import { apiPerson } from '@/lib/personal-chat/auth';
import { claimAddressInput } from '@/lib/personal-chat/domain';
import { claimAddress } from '@/lib/personal-chat/service';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const input = claimAddressInput.parse(await limitedJson(request, 2000));
    return Response.json(await claimAddress(await apiPerson(request, true), input.token), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
