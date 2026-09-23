import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCapability(request, 'k5_artifacts_edit', { artifactId: (await context.params).id });
}
