'use client';
import { Button } from '@/components/ui/button';
import { useReportError } from '@/lib/observability/use-report-error';

export default function ErrorPage({ error, reset, retry }: { error: Error & { digest?: string }; reset?: () => void; retry?: () => void }) {
  useReportError(error);
  return <div className="p-8"><p role="alert" className="text-sm">Não foi possível carregar seus relatos.</p><Button className="mt-4 min-h-11" variant="outline" onClick={retry ?? reset}>Tentar novamente</Button></div>;
}
