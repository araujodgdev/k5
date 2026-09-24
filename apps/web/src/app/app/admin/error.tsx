"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReportError } from '@/lib/observability/use-report-error';

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useReportError(error);
  return (
    <section className="py-12">
      <p className="flex items-start gap-2 text-destructive text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />Não foi possível carregar a administração.</p>
      <Button className="mt-5" variant="outline" onClick={() => retry()}>Tentar novamente</Button>
    </section>
  );
}
