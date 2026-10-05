import { requireWorkspace } from '@/lib/session';
import { FeeQuotePanel } from '@/components/honorarios/quote-panel';
export default async function FeeQuotesPage() { await requireWorkspace(); return <FeeQuotePanel />; }
