import { requirePlatformRequest } from '@/lib/platform';
import { platformFeedback } from '@/lib/feedback-core';
import { feedbackDataset } from '@/lib/feedback-dataset';
import { feedbackCampaigns } from '@/lib/feedback-campaigns';
import { platformErrorResponse } from '@/lib/platform-core';

export async function GET(request: Request) {
  try {
    const { db, user } = await requirePlatformRequest(request);
    if (new URL(request.url).searchParams.get('format') === 'dataset') {
      return Response.json(await feedbackDataset(db, user.id), { headers: {
        'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="base-avaliacao-curadoria.json"',
      } });
    }
    const history = new URL(request.url).searchParams.get('history') === '1';
    const result = history ? await Promise.all(feedbackCampaigns.map(c => platformFeedback(db, user.id, c.id))) : await platformFeedback(db, user.id);
    return Response.json(result, { headers: {
      'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="avaliacoes-modelos.json"',
    } });
  } catch (error) { return platformErrorResponse(error); }
}
