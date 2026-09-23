'use client';

import { useReportError } from '@/lib/observability/use-report-error';
import { Button } from '@/components/ui/button';
import './globals.css';

export default function GlobalError({ error, retry, reset }: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useReportError(error);
  return <html lang="pt-BR"><body>
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="page-title">Não foi possível carregar esta página</h1>
      <p className="text-muted-foreground" role="alert">Tente novamente em instantes.</p>
      <Button className="min-h-11" onClick={() => (retry ?? reset ?? (() => window.location.reload()))()}>Tentar novamente</Button>
    </main>
  </body></html>;
}
