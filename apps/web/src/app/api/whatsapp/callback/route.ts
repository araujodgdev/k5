import { apiPersonalWorkspace, apiError } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { z } from 'zod';
import { completeWhatsAppConnect, cancelWhatsAppConnect } from '@/lib/whatsapp/connection';
import { whatsappEnvironment } from '@/lib/whatsapp/environment';

export const runtime = 'nodejs';
const callback = z.object({ state: z.string().min(32).max(100), accountId: z.string().min(1).max(500),
  profileId: z.string().min(1).max(500), connected: z.literal('whatsapp') });

export async function GET(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request));
    const params = new URL(request.url).searchParams;
    const origin = whatsappEnvironment().BETTER_AUTH_URL;
    if (!origin) return Response.json({ error: 'A conexão WhatsApp não está configurada.' }, { status: 503 });
    const destination = new URL('/app/integrations', origin);
    if (params.has('error')) {
      await cancelWhatsAppConnect(context, z.string().min(32).max(100).parse(params.get('state')));
      destination.searchParams.set('whatsapp', 'cancelled');
    } else {
      await completeWhatsAppConnect(context, callback.parse(Object.fromEntries(params)));
      destination.searchParams.set('whatsapp', 'connected');
    }
    return Response.redirect(destination, 303);
  } catch (error) { return apiError(error); }
}
