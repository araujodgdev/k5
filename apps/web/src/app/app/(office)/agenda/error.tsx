'use client';
import { useCanvasLoadError } from '@/components/lume/canvas-host';
import { RouteError } from '@/components/agenda-detail';
import { useReportError } from '@/lib/observability/use-report-error';

export default function Error({ error, reset, retry }: { error: Error & { digest?: string }; reset?: () => void; retry?: () => void }) {
  useCanvasLoadError();
  useReportError(error);
  return <RouteError title="Escritório" message="Não foi possível carregar o escritório." retry={retry ?? reset} />;
}
