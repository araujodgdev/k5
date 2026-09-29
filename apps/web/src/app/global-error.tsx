'use client';

import { useReportError } from '@/lib/observability/use-report-error';
import styles from './global-error.module.css';

export default function GlobalError({ error, retry, reset }: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useReportError(error);
  return <html lang="pt-BR"><body>
    <main className={styles.error}>
      <h1>Não foi possível carregar esta página</h1>
      <p role="alert">Tente novamente em instantes.</p>
      <button onClick={() => (retry ?? reset ?? (() => window.location.reload()))()}>Tentar novamente</button>
    </main>
  </body></html>;
}
