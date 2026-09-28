import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

/** The person's own working memory in the current office: read it, or make the Lume forget it. */
export async function GET(request: Request) {
  return handleCapability(request, 'k5_memory_get');
}

export async function DELETE(request: Request) {
  return handleCapability(request, 'k5_memory_clear');
}
