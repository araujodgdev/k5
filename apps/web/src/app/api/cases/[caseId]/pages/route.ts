import { handleCapability } from '@/lib/capability-route';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  const url = new URL(request.url);
  return handleCapability(request, 'k5_case_pages_list', { ...await context.params, folderId: url.searchParams.get('folderId'), query: url.searchParams.get('query') ?? undefined });
}
export async function POST(request: Request, context: Context) {
  return handleCapability(request, 'k5_case_pages_create', await context.params);
}
