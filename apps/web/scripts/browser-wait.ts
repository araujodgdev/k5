/**
 * Waits for scripts that drive Playwright as a library (tutorial recordings, checks against deployed
 * environments, the multi-tab worker harness). Tests use e2e and its `expect` instead; see e2e/.
 */
import type { Locator } from 'playwright';

export const visible = (locator: Locator, timeout = 60_000) => locator.waitFor({ state: 'visible', timeout });

/** No element matches anymore, as `toHaveCount(0)` would assert. */
export const gone = (locator: Locator, timeout = 60_000) => locator.first().waitFor({ state: 'detached', timeout });

/** Re-reads until `accept` holds; throws with the last value read after `timeout`. */
export async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last: T | undefined;
  for (;;) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch { /* The page may be navigating; read again. */ }
    if (Date.now() > deadline) throw new Error(`${message}: último valor ${JSON.stringify(last)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
