'use client';

import { useEffect } from 'react';
import { usePathname } from '@/components/lume/canvas-navigation';
import { isWebMCPSupported } from '@/lib/webmcp/browser';

/**
 * Publishes the authorized catalog while the authenticated shell is mounted. The set is rebuilt
 * when the route changes, and torn down on unmount, so a tool never outlives the
 * context that justified registering it.
 */
export function WebMCPProvider({
  whatsappEnabled = false,
  children,
}: {
  whatsappEnabled?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_WEBMCP_ENABLED !== 'true' || !isWebMCPSupported()) return;
    let disposed = false;
    let unregister: (() => void) | undefined;
    void import('@/lib/webmcp/adapter').then(({ registerWebMCPCapabilities }) => {
      if (!disposed) unregister = registerWebMCPCapabilities({ whatsappEnabled });
    }).catch(() => { /* The interface remains available if the optional catalog cannot load. */ });
    return () => { disposed = true; unregister?.(); };
  }, [pathname, whatsappEnabled]);

  return <>{children}</>;
}
