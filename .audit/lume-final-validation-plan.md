# Final integrated validation

Prepared while the visual writer owns production files. No final check has started. Wait for its completed report and explicit writer release, inspect its result, then validate that source state. Do not restart the obsolete round3 sequencer or its 112-file freeze.

Use existing run `20261006T234247-d88728`, app 62541 and PG 62542. Read current state via verify-lume and run doctor. Recovery is recorded in `lume-case-unit3.md`; old PIDs are not authoritative. Do not restart a healthy instance or touch developer services/data/environment.

Run serially from the root and retain each output path:

```powershell
pnpm --dir apps/web exec tsx ../../.audit/lume-round3-root-checks.mts lint
pnpm --dir apps/web exec tsx ../../.audit/lume-round3-root-checks.mts typecheck
pnpm --dir apps/web exec tsx ../../.audit/lume-round3-root-checks.mts test
pnpm --dir apps/web exec tsx ../../.audit/lume-round3-root-checks.mts build
```

These are actual root pnpm scripts with isolated environment/storage and serial PostgreSQL tests. The test external-fetch guard stays enabled; it is not a complete network firewall. Correct explicit synthetic transport fixtures if needed, never remove the guard for real-provider access. Full root tests have not completed with it yet. Installed Node v26.6.0 satisfies the package requirement.

Use `lume-source-checks.mts e2e <files>` for the affected browser batch, one worker/video. Include the final writer's new tests and these existing files (all under `apps/web/e2e/`):

```text
agent-settings.e2e.ts
annex-plan.e2e.ts
app-shell.e2e.ts
case-collaboration.e2e.ts
case-pages.e2e.ts
client-portal.e2e.ts
document-saving.e2e.ts
editor-repair.e2e.ts
honorarios.e2e.ts
legal-acceptance.e2e.ts
lume-shell.e2e.ts
onboarding.e2e.ts
private-chat-readiness.e2e.ts
profile.e2e.ts
pwa.e2e.ts
research-linker-race.e2e.ts
research-source-round3.e2e.ts
source-policy.e2e.ts
source-round3.e2e.ts
vault-pagination.e2e.ts
workspace.e2e.ts
```

This includes prior affected flows, unit3 regressions and currently modified UI tests. Check the final report for additions and model dependencies before running. This selected batch is not the entire e2e suite. Native preview status/open is the first entry point for parent manual inspection.

Record source status and confirm no active writer before checks. Inspect final desktop/390 px images, keyboard/draft behavior and dark mode. Count actual results, distinguishing focused prior passes, interruptions, fixture issues and final passes. Only repeat after a relevant edit or diagnosed failure. Report a baseline PDF.js clash only if actually reproduced. Live-provider quality and real outbound delivery are outside this isolated proof.

Build generates `apps/web/public/sw.js`, not a product-source edit. After final browser work, clean up only the owned instance with verify-lume, then check type generation after cleanup per the skill. Preserve evidence. Update the stale status in `docs/lume-agent-canvas-implementation.md` after results are known. No commit, PR, deployment or production migration.
