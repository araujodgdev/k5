import { apiPersonalWorkspace, apiError, limitedJson } from '@/lib/workspace-api';
import { workspaceContext } from '@/lib/application/context';
import { sendWhatsAppText } from '@/lib/whatsapp/send';
import { sendInput } from '@/lib/whatsapp/domain';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = workspaceContext(await apiPersonalWorkspace(request, true));
    if (request.headers.get('x-k5-surface') === 'webmcp') context.invocation = 'webmcp';
    return Response.json(await sendWhatsAppText(context, sendInput.parse(await limitedJson(request, 32_000))), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
