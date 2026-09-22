'use client';
import { Button } from '@/components/ui/button';
import { useReportError } from '@/lib/observability/use-report-error';
export default function Error({ error, reset, retry }: { error: Error & { digest?: string }; reset?: () => void; retry?: () => void }) {
  useReportError(error);
  return <div className="space-y-4 p-8"><p role="alert">Não foi possível carregar a agenda.</p><Button variant="outline" onClick={retry ?? reset}>Tentar novamente</Button></div>;
}
