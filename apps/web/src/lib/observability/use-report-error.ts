'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/react';

export function useReportError(error: Error & { digest?: string }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'react', ...(error.digest ? { digest: error.digest } : {}) } });
  }, [error]);
}
