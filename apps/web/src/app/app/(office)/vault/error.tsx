"use client";
import { useCanvasLoadError } from '@/components/lume/canvas-host';

import { CasosError } from "@/components/casos/route-states";
import { useReportError } from "@/lib/observability/use-report-error";

export default function Error({ error, reset, retry }: { error: Error & { digest?: string }; reset?: () => void; retry?: () => void }) {
  useCanvasLoadError();
  useReportError(error);
  return <CasosError message="Não foi possível carregar os casos." retry={retry ?? reset} />;
}
