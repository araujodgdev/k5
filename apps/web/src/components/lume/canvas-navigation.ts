'use client';

import { useContext, useMemo } from 'react';
import { usePathname as frameworkPathname, useSearchParams as frameworkSearch, useRouter as frameworkRouter } from 'next/navigation';
import { useCanvasLocation } from './canvas-host';
import { WorkspaceContext } from './workspace-context';
import { canonicalCanvasHref } from '@/lib/lume-workspace';
export { redirect, notFound } from 'next/navigation';

export function usePathname() {
  const pathname = frameworkPathname();
  const location = useCanvasLocation();
  return location ? new URL(location.href, 'https://lume.invalid').pathname : pathname;
}
export function useSearchParams() {
  const search = frameworkSearch();
  const location = useCanvasLocation();
  return useMemo(() => location ? new URL(location.href, 'https://lume.invalid').searchParams : search, [location, search]);
}
// Providers that wrap the workspace (the tutorial) sit outside its context. They still navigate
// through the mounted workspace, so its serial cancels an older navigation instead of racing it.
let mountedNavigator: ((href: string) => Promise<boolean>) | null = null;
export function registerWorkspaceNavigator(navigate: (href: string) => Promise<boolean>) {
  mountedNavigator = navigate;
  return () => { if (mountedNavigator === navigate) mountedNavigator = null; };
}

export function useRouter() {
  const router = frameworkRouter();
  const workspace = useContext(WorkspaceContext);
  return useMemo(() => ({ ...router, push(href: string, options?: Parameters<typeof router.push>[1]) {
    const navigate = workspace?.navigate ?? mountedNavigator;
    if (navigate && canonicalCanvasHref(href)) void navigate(href);
    else router.push(href, options);
  } }), [router, workspace]);
}
