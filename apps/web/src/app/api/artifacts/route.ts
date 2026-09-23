import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '') || undefined;
  return handleCapability(request, 'k5_artifacts_list', limit ? { limit } : {});
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_artifacts_create');
}
