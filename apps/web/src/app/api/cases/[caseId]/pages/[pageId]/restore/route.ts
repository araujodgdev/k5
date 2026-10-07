import { handleCapability } from '@/lib/capability-route';
export async function POST(request: Request, context: { params: Promise<{ caseId: string; pageId: string }> }) {
  return handleCapability(request, 'k5_case_pages_restore', await context.params);
}
