import { z } from 'zod';
import type { OfficeRole } from '@/lib/offices';
import { capabilities, publishedCapabilitiesForRole, type CapabilityName } from '@/lib/capabilities/contracts';
import type { WebMCPToolDefinition, WebMCPToolRegistration } from './types';

import { getModelContext } from './browser';
import { requestCapability, type WebMCPResult } from '@/lib/capabilities/http-client';
export { getModelContext, isWebMCPSupported } from './browser';
export type { WebMCPResult } from '@/lib/capabilities/http-client';

export async function executeViaHttp(
  name: CapabilityName,
  rawInput: Record<string, unknown>,
  signal?: AbortSignal,
  surface?: 'webmcp',
): Promise<WebMCPResult> {
  const parsed = capabilities[name].input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID', error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'entrada'}: ${issue.message}`).join('; ') };
  }
  return requestCapability(name, parsed.data as Record<string, unknown>, signal, surface);
}

/**
 * Registers the authorized catalog and returns a cleanup that works even when it is called before
 * an async `registerTool` settles - React's double mount does exactly that, and a registration
 * that lands after unmount would otherwise leak a live tool into the next mount.
 */
export function registerWebMCPCapabilities(role: OfficeRole): () => void {
  const context = getModelContext();
  if (!context) return () => {};

  const lifetime = new AbortController();
  const registrations: WebMCPToolRegistration[] = [];
  let disposed = false;

  for (const name of publishedCapabilitiesForRole(role, 'webmcp')) {
    const capability = capabilities[name];
    const definition: WebMCPToolDefinition = {
      name,
      description: capability.description,
      inputSchema: z.toJSONSchema(capability.input, { io: 'input' }) as Record<string, unknown>,
      hints: {
        readOnlyHint: capability.effect === 'read',
        consequentialHint: capability.effect === 'write',
        // Vault text is someone else's document; it is data, never instructions for the agent.
        untrustedContentHint: capability.module === 'knowledge'
          || capability.module === 'citations'
          || name === 'k5_judicial_list_publications'
          || name === 'k5_judicial_list_movements'
          || name === 'k5_judicial_get_publication',
      },
    };

    try {
      const registered = context.registerTool(
        definition,
        async (input, execution) => executeViaHttp(name, input ?? {}, execution?.signal, 'webmcp'),
        { signal: lifetime.signal },
      );

      if (registered && typeof (registered as Promise<WebMCPToolRegistration>).then === 'function') {
        void (registered as Promise<WebMCPToolRegistration>).then((registration) => {
          if (disposed) { try { registration.unregister(); } catch { /* already gone */ } return; }
          registrations.push(registration);
        }).catch(() => { /* registration refused by the browser */ });
      } else if (registered && typeof (registered as WebMCPToolRegistration).unregister === 'function') {
        registrations.push(registered as WebMCPToolRegistration);
      }
    } catch {
      // Browser refused this definition: the interface keeps working without it.
    }
  }

  return () => {
    disposed = true;
    lifetime.abort();
    for (const registration of registrations.splice(0)) {
      try { registration.unregister(); } catch { /* already gone */ }
    }
  };
}
