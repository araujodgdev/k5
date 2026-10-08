"use client";
import { useCanvasLoadError } from '@/components/lume/canvas-host';

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReportError } from '@/lib/observability/use-report-error';

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useCanvasLoadError();
  useReportError(error);
  return (
    <section className="flex flex-col items-start gap-4 py-10">
      <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />Não foi possível carregar a administração.</p>
      <Button variant="outline" onClick={() => retry()}>Tentar novamente</Button>
    </section>
  );
}
