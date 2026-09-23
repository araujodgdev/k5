"use client";

import { Button } from "@/components/ui/button";
import { useReportError } from '@/lib/observability/use-report-error';

export default function ErrorPage({ error, reset, retry }: { error: Error & { digest?: string }; reset?: () => void; retry?: () => void }) {
  useReportError(error);
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="page-title">Não foi possível carregar esta página</h1>
      <p className="mb-3 text-muted-foreground">Tente novamente em instantes.</p>
      <Button onClick={retry ?? reset}>Tentar novamente</Button>
    </div>
  );
}
