import { handleCapability } from '@/lib/capability-route';
type Context = { params: Promise<{ caseId: string; activityId: string }> };
export async function GET(request: Request, context: Context) { return handleCapability(request,'k5_case_tasks_get',await context.params); }
export async function PUT(request: Request, context: Context) { return handleCapability(request,'k5_case_tasks_update',await context.params); }
