'use client';

import { useEffect, useState } from 'react';

export function useDebouncedValue(value: string, delay = 150) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
