# Source-policy comment review

The fresh read-only Comment Sicko pass used GPT-6.1 Sol High/Fast per the user override. It inspected all 82 source-policy inventory paths against main, including untracked files. The parent accepted seven one-line comment deletions across seven files. No comments were restored and no review rerun was needed.

The parent inspected all three structural flags and kept the existing data model and transaction ownership. `flattenLegacySourceObligations` now names the compatibility reader's flattening. `preserveUnsampledVersion` names the existing exact SQL operation inside the current transaction; the following version sampling query is unchanged. `missingRenderPolicy` names the legacy portal-copy rejection without adding a second policy mechanism. These are local renaming/extraction changes using the already selected ArtifactRow/ContentPolicy/Transaction shape. No new architecture or domain state was introduced.

The exported policy and authenticated-ingress contracts were retained. Existing SDK/platform exceptions remain. The scoped suppression search found no new correctness or safety suppressions. No constraint comment required an encoding offer; there are no pending encoding approvals or unenforced constraints from this pass.

Scoped lint and app-wide TypeScript passed after these changes. The existing content-policy/artifact/portal selection passed 22/22 at `apps/web/.e2e/verify/20261006T234247-d88728/source-test-1791345080430`. The production tree is frozen for three independent functional reviews. All reviewers use Sol High/Fast, so this is independent review without model diversity.

## Original read-only findings

Read-only review completed across all **82 inventory paths**, comparing the working tree against `main`, including untracked files. **No files touched. Seven comment-line deletions proposed across seven files. No added/changed suppressions found.**

Delete these exact comments, one counted line each:

- [content-policy.ts:77](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/content-policy.ts:77): `/** Compatibility expands old rows once; a version-bound policy is a terminal flat union. */` — describes our compatibility implementation.
- [documents/service.ts:92](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/documents/service.ts:92): `// Explicit replacement preserves the last unsampled autosave; autosave history stays sampled.` — narrates our history branches.
- [agent-knowledge.ts:123](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/agent-knowledge.ts:123): `// Ingestion sums the persisted, trimmed chunks; joining adds separators.` — describes our ingestion and joining.
- [application/context.ts:76](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/context.ts:76): `/** The case switch can be added without bypassing the common agent admission boundary. */` — future implementation narration, not an API contract.
- [client-portal/service.ts:208](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/client-portal/service.ts:208): `// Old rendered files did not record the actual template; they need a new publication.` — justifies an application compatibility branch.
- [shared-writing-fixture.ts:12](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/tests/shared-writing-fixture.ts:12): `/** Only the provider transport is replaced; request construction and persistence are production code. */` — test-evidence narration.
- [source-policy.e2e.ts:14](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/e2e/source-policy.e2e.ts:14): `// Arrange only the chat card. Proposal preparation, preview and confirmation use real endpoints.` — narrates visible test setup.

`MUST KILL` flags, one line each:

- `content-policy.ts:78 — legacyObligations`: name the bounded, visited-once flattening explicitly; the wrapper currently hides that behavior behind a generic name and deleted prose.
- `documents/service.ts:57 — updatePrivateDocument`: extract/name preservation of the current unsampled version separately from recording the new sampled/explicit version; `snapshot` controls both.
- `client-portal/service.ts:205 — assertPortalPolicy`: explicitly name the rejection of legacy source-linked files without policy; the bare `throw missing()` hides that branch’s purpose.

Justified exceptions and skips:

- `content-policy.ts:50`: preserve the exported `assertPolicyAccess` contract distinguishing current resource ACL checks from historical byte obligations. Verified through `assertSourceGuards` and `lume_resource_visible`; neither traverses current source policies.
- `documents/shared-writing.ts:22`: preserve the exported `recordPersonRequest` caller contract requiring authenticated ingress before private generation. Verified the production chat route authenticates, resolves person input, records it, then starts the chat run.
- `agent-chat.tsx:637`: skip previously reviewed SDK timing material. Installed AI SDK source still awaits file preparation and transport preparation after the application captures scope.
- `agent-chat.tsx:135,718`: skip previously reviewed browser-storage exceptions.
- Preexisting unchanged comments, including `agent-knowledge.ts:124`, and generated/legal material remain outside this pass.

Nearby source, called SQL implementations, installed SDK source, and the existing how report were inspected. No tests, source changes, git mutations, or subdelegation performed.
