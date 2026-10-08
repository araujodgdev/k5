import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from 'next/navigation';

function AgentSettingsPage() {
  return redirect('/app/profile/lume');
}

export default officePage('/app/agents/settings', AgentSettingsPage);
