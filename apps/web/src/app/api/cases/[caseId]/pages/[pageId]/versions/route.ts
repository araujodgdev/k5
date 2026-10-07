import { handleCapability } from '@/lib/capability-route';
export async function GET(request: Request, context: { params: Promise<{ caseId: string; pageId: string }> }) {
  return handleCapability(request, 'k5_case_pages_versions', await context.params);
}
