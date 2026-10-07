'use client';

import { RouteError } from '@/components/agenda-detail';
import { useReportError } from '@/lib/observability/use-report-error';

export default function HonorariosError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  useReportError(error);
  return <RouteError title="Honorários" message="Não foi possível abrir os honorários." retry={retry ?? reset} />;
}
