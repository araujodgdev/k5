import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { connectionView, removeConnection, saveConnection } from '@/lib/typesafe/config';
import { connectionSettings } from '@/lib/typesafe/contracts';
import { evaluate } from '@/lib/typesafe/client';

type Context = { params: Promise<{ officeId: string }> };
export async function GET(request: Request, context: Context) {
  try { await requirePlatformRequest(request); return Response.json({ connection: await connectionView((await context.params).officeId) }); }
  catch (error) { return platformErrorResponse(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    return Response.json({ connection: await saveConnection((await context.params).officeId, user.id, await readPlatformJson(request, connectionSettings)) });
  } catch (error) { return platformErrorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    await removeConnection((await context.params).officeId, user.id);
    return Response.json({ connection: await connectionView((await context.params).officeId) });
  } catch (error) { return platformErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    const result = await evaluate({ officeId: (await context.params).officeId, userId: user.id }, 'rag', {
      state: 'A reunião está marcada para segunda-feira.', questionVersion: 'connection-test-v1',
      questions: { meeting: { type: 'noul', instructions: 'O texto menciona uma reunião?' } },
    }, { test: true, signal: request.signal, deadlineMs: 10000 });
    return Response.json({ ok: result.status === 'evaluated', status: result.status }, { status: result.status === 'evaluated' ? 200 : 422 });
  } catch (error) { return platformErrorResponse(error); }
}
