import { requireWorkspace } from '@/lib/session';
import { TrademarkReader } from '@/components/trademark-reader';

export const metadata = { title: 'Detalhes da marca' };

export default async function TrademarkPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <TrademarkReader resultId={id} />;
}
