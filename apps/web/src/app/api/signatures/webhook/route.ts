import { apiError } from '@/lib/workspace-api';
import { acceptSignatureWebhook } from '@/lib/signatures/webhooks';

export async function POST(request: Request) {
  try { return Response.json(await acceptSignatureWebhook(request), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
