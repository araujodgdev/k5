import { officePage } from '@/components/lume/canvas-leaf';
import { requireWorkspace } from '@/lib/session';
import { FeeQuotePanel } from '@/components/honorarios/quote-panel';

export const metadata = { title: 'Propostas e contratos' };
async function FeeQuotesPage() { await requireWorkspace(); return <FeeQuotePanel />; }

export default officePage('/app/honorarios/propostas', FeeQuotesPage);
