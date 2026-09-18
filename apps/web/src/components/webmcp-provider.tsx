'use client';

import { useEffect } from 'react';
import type { OfficeRole } from '@/lib/offices';
import { registerWebMCPCapabilities } from '@/lib/webmcp/adapter';

export function WebMCPProvider({
  role,
  children,
}: {
  role: OfficeRole;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const unregister = registerWebMCPCapabilities(role);
    return () => {
      unregister();
    };
  }, [role]);

  return <>{children}</>;
}
