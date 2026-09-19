import { handleCapability, searchParamsInput } from '@/lib/capability-route';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleCapability(request, 'k5_vault_list_folders', searchParamsInput(request, ['caseId', 'parentId']));
}

export async function POST(request: Request) {
  return handleCapability(request, 'k5_vault_create_folder');
}
