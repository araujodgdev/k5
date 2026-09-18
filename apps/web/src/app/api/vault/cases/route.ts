import { handleCapability } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_vault_list_cases');
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_vault_create_case');
}
