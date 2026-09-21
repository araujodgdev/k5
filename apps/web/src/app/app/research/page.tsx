import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/session';

export default async function ResearchPage() {
  await requireWorkspace();
  redirect('/app/agenda');
}
