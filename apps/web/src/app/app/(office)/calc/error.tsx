'use client';

import { RouteError } from '@/components/agenda-detail';
import { useReportError } from '@/lib/observability/use-report-error';

export default function Error({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  useReportError(error);
  return <RouteError title="Cálculos" message="Não foi possível abrir os cálculos." retry={retry ?? reset} />;
}
