import { handleCapability } from '@/lib/capability-route';
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) { return handleCapability(request,'k5_case_tasks_list',await context.params); }
export async function POST(request: Request, context: Context) { return handleCapability(request,'k5_case_tasks_create',await context.params); }
