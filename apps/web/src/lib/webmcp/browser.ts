import type { WebMCPContext } from './types';

export function isWebMCPSupported(): boolean {
  return getModelContext() !== null;
}

/**
 * The imperative surface is `document.modelContext`. `navigator.modelContext` appears in early
 * examples and is not what the current runtime exposes, so it is not probed here.
 */
export function getModelContext(): WebMCPContext | null {
  if (typeof document === 'undefined') return null;
  const context = document.modelContext;
  return context && typeof context.registerTool === 'function' ? context : null;
}
