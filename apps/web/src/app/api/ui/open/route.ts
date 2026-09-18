import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

/**
 * Resolving a K5 path is a server decision: the destination is checked against the office before
 * it is returned, instead of being assembled from unvalidated ids in the browser.
 */
export async function POST(request: Request) {
  return handleCapability(request, 'k5_ui_open_resource');
}
