'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { OfficeRole } from '@/lib/offices';
import { registerWebMCPCapabilities } from '@/lib/webmcp/adapter';

/**
 * Publishes the authorized catalog while the authenticated shell is mounted. The set is rebuilt
 * when the role or the route changes, and torn down on unmount, so a tool never outlives the
 * context that justified registering it.
 */
export function WebMCPProvider({
  role,
  children,
}: {
  role: OfficeRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_WEBMCP_ENABLED !== 'true') return;
    const unregister = registerWebMCPCapabilities(role);
    return unregister;
  }, [role, pathname]);

  return <>{children}</>;
}
