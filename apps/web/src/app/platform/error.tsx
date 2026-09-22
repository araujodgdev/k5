"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReportError } from '@/lib/observability/use-report-error';

export default function PlatformError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useReportError(error);
  return (
    <section className="mx-auto max-w-5xl py-12">
      <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />Não foi possível carregar os dados da plataforma.</p>
      <Button className="mt-5" variant="outline" onClick={() => retry()}>Tentar novamente</Button>
    </section>
  );
}
