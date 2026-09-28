import { z } from 'zod';
import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { platformWhatsAppStatus, setPlatformWhatsApp } from '@/lib/platform-whatsapp';

const command = z.strictObject({ enabled: z.boolean(), revision: z.string().regex(/^[a-f0-9]{64}$/) });
type Context = { params: Promise<{ officeId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { user } = await requirePlatformRequest(request);
    return Response.json(await platformWhatsAppStatus(user.id, (await params).officeId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return platformErrorResponse(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    const { officeId } = await params;
    const body = await readPlatformJson(request, command);
    await setPlatformWhatsApp(user.id, officeId, body.enabled, body.revision);
    return Response.json({ success: true });
  } catch (error) { return platformErrorResponse(error); }
}
