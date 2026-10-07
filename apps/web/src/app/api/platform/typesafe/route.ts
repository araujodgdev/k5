import { requirePlatformRequest } from '@/lib/platform';
import { platformErrorResponse, readPlatformJson } from '@/lib/platform-core';
import { connectionView, removeConnection, saveConnection } from '@/lib/typesafe/config';
import { connectionSettings } from '@/lib/typesafe/contracts';
import { testTypeSafeConnection } from '@/lib/typesafe/connection-probe';

export async function GET(request: Request) {
  try { await requirePlatformRequest(request); return Response.json({ connection: await connectionView() }); }
  catch (error) { return platformErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    return Response.json({ connection: await saveConnection(user.id, await readPlatformJson(request, connectionSettings)) });
  } catch (error) { return platformErrorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const { user } = await requirePlatformRequest(request, { mutation: true });
    await removeConnection(user.id);
    return Response.json({ connection: await connectionView() });
  } catch (error) { return platformErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const result = await testTypeSafeConnection(request);
    return Response.json({ ok: result.status === 'evaluated', status: result.status }, { status: result.status === 'evaluated' ? 200 : 422 });
  } catch (error) { return platformErrorResponse(error); }
}
