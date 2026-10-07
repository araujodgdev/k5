import { requireWorkspace } from '@/lib/session';
import { FeeQuotePanel } from '@/components/honorarios/quote-panel';

export const metadata = { title: 'Propostas e contratos' };
export default async function FeeQuotesPage() { await requireWorkspace(); return <FeeQuotePanel />; }
