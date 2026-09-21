/**
 * The Workers runtime module, declared locally.
 *
 * `cloudflare:workers` exists only inside the Worker, so TypeScript cannot resolve it from a Node
 * type-check. Only `env` is used here — to reach the D1 binding in `database.ts` — and declaring
 * that one export keeps the seam honest without pulling the full Worker type surface into an app
 * that also has to compile for Node.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
