import { handleCapability } from '@/lib/capability-route';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleCapability(request, 'k5_artifacts_get_verification', { artifactId: (await context.params).id });
}
export async function POST(request: Request, context: Context) {
  return handleCapability(request, 'k5_artifacts_verify', { artifactId: (await context.params).id });
}
