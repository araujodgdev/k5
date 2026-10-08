import { appearanceInput, officeAccent } from '@/lib/appearance-contract';
import { database } from '@/lib/database';
import { apiError, apiPersonalWorkspace, limitedJson } from '@/lib/workspace-api';

export async function GET(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request);
    const row = await database.prepare('SELECT office_accent AS accent FROM user_profile WHERE user_id=?').get<{ accent: string | null }>(user.id);
    return Response.json({ accent: officeAccent(row?.accent) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const response = apiError(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}

export async function PATCH(request: Request) {
  try {
    const { user } = await apiPersonalWorkspace(request, true);
    const { accent } = appearanceInput.parse(await limitedJson(request, 1000));
    await database.prepare(`INSERT INTO user_profile(user_id,office_accent) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET office_accent=excluded.office_accent,updated_at=CURRENT_TIMESTAMP`).run(user.id, accent);
    return Response.json({ accent }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const response = apiError(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}
