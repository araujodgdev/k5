/**
 * The Workers runtime module, declared locally.
 *
 * `cloudflare:workers` exists only inside the Worker, so TypeScript cannot resolve it from a Node
 * type-check. Only `env` is used here — to reach capability bindings in the storage and research adapters — and declaring
 * that one export keeps the seam honest without pulling the full Worker type surface into an app
 * that also has to compile for Node.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  /** Runtime base classes used by the Containers SDK; no browser globals enter the Next build. */
  export abstract class DurableObject<Env = unknown> {
    protected readonly env: Env;
    protected readonly ctx: unknown;
    constructor(ctx: unknown, env: Env);
  }
  export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
    protected readonly env: Env;
    protected readonly ctx: { props: Props };
  }
}
