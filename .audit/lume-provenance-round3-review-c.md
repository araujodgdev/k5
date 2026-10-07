**ISSUES. Two critical findings and two warnings, all established by static tracing.** I verified all 112 frozen hashes twice with zero mismatches. No files, tests, DB operations, browser actions, or nested agents were used. I did not access other current functional-review outputs.

1. **[critical] Production citation callers discard the session required by final admission.**

   Locations: [chat-turn.ts:388](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:388), [artifacts-service.ts:49](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/application/artifacts-service.ts:49), [citations/route.ts:12](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/app/api/artifacts/[id]/citations/route.ts:12), [artifact-review.ts:26](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/citations/artifact-review.ts:26).

   `runChatTurn` constructs a full context containing the original session, then calls `reviewCitations` with an `owner` containing only office/user IDs. Automatic artifact review makes the same projection. The authenticated manual citation endpoint likewise drops the session before calling `reviewArtifactCitations`.

   With TypeSafe document evaluation enabled and at least one recognized citation, `reviewCitations` constructs an admission from that incomplete context. [content-admission.ts:28](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/content-admission.ts:28) necessarily rejects it as `UNAUTHENTICATED` before transport. Chat catches this and omits citation results; manual review returns an authentication error for an authenticated request. Automatic artifact review can throw after the artifact write has committed.

   Expected behavior is an evaluated citation result under the original authenticated authority, with safe denial only when that authority or its sources are actually unavailable. This violates the mandatory admission contract and breaks ordinary configured citation flows.

   **Smallest repair:** carry the original `WorkspaceContext` through these callers. Bind the exact answer/artifact policy as well as candidate-source policies; adding a session ID alone would leave source obligations incomplete. Cover the actual chat, automatic artifact, and authenticated manual endpoint paths with TypeSafe enabled. Existing helper-level citation tests do not establish these caller handoffs.

2. **[critical] A changed seeded profile entry can shed its restrictions through deletion plus a null ID.**

   Location: [case-content.ts:100](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/case-content.ts:100), especially `profilePartsForSave` lines 104–105, 120 and 126.

   A concrete accepted sequence is:

   - Read a profile containing a source-restricted alleged fact or gap, obtaining its current `readToken` and entry ID.
   - Submit the same revision/token, replace that entry with slightly altered text, provide `null` as its new ID, and declare the old ID in `deletedEntryIds`.
   - The identical-digest check at line 120 does not match the altered text. The deletion check accepts the declared old ID.
   - `make()` receives no prior entry and therefore omits both its prior policy and the admitted seed policy. For an alleged fact/gap, no document policy is added either.
   - A case participant lacking the original source can then see the replacement through `projectProfile`, even while the remaining protected parts stay withheld.

   Expected behavior is retained identity/policy for a seeded edit, or the contract’s explicit fresh-request, exact-review and CAS replacement flow. The selected contract expressly prohibits dropping IDs to declare an existing seeded replacement independent. The current regression rejects unchanged text with dropped IDs; it does not exercise altered text plus explicit deletion.

   **Smallest repair:** reject this seeded replacement representation and require the existing replacement flow, while preserving legitimate independent additions. Do not solve it with text similarity or a union of unrelated entries.

3. **[warning] Jurisprudence scoring loses its complete policy when recorded as a citation source.**

   Locations: [jurisprudence-score.ts:101](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/jurisprudence-score.ts:101), [sources.ts:64](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/citations/sources.ts:64).

   `scoreJurisprudence` returns a `ContentResult` carrying the private generation policy, including known source restrictions. The agent tool then calls `sourcesFromTool`. Its scoring branch copies the supplied title/summary into `web_jurisprudence` records without preserving that policy.

   `recordSources` admits these non-Vault, policy-less records with `content_policy = null`. Following source revocation, `conversationSources` still returns their text. A public consulted URL establishes that the link was found; it does not establish that the planner-supplied summary is source-independent.

   This violates complete ownership across DTO/cache boundaries. **I am not claiming a current production provider leak:** finding 1 presently prevents the normal citation consumers from dispatching. Fixing only that authority handoff would expose this missing-policy path.

   **Smallest repair:** retain the scoring result’s complete policy on its derived cache entries and authorize it on reads. Handle Vault-derived and owner-only policies explicitly; the recorder’s current requirement for a research observation must not silently discard them. Preserve independently retrieved public web sources as public.

4. **[warning] Consulted-link registration lacks an ordering barrier before dependent scoring.**

   Locations: [chat-turn.ts:303](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/chat-turn.ts:303), [jurisprudence-score.ts:74](C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/research/jurisprudence-score.ts:74).

   I independently confirmed the comment recheck’s dependency trace. Installed Mastra emits `step-finish` through the workflow producer’s enqueue operation; the awaited `onStepFinish` runs in the downstream consumer. The producer does not await that application callback.

   A reachable interleaving is an earlier step callback waiting in `recordSources`, while the producer completes a later web search and executes scoring for its new URL. The consumer has not registered that later URL, and it has not entered the persisted cache. Scoring snapshots `linkFound = false` before its subsequent evaluation awaits.

   Registration for the callback’s own step happens before its database await, so holding that callback alone does **not** invalidate links already registered for that same step. The problematic case concerns later steps overtaking it.

   Expected behavior is registration before dependent scoring. Actual behavior can downgrade a genuinely consulted link to low reliability. **No incorrect score was runtime-reproduced, and this is neither false certification nor an evidenced content leak.**

   **Smallest repair:** register search results at a producer-owned boundary that completes before tool return/dependent scoring, using a supported producer-side hook for native search. This does not justify another broad architecture phase.

The nine predecessor groups were traced as follows:

| Prior group | Current disposition |
|---|---|
| Nested assessment replay | Root mappings, both parses and replay bindings retain the nested policy. No recurrence found. |
| Planner profile/notes publication | Finite request/confirm contracts and persisted exact preparation prevent raw planner publication. Finding 2 leaves the seeded human-edit boundary incomplete. |
| Retained assessment catalog admission | Retained policy is checked before freshness; worker execution retains original authority. No recurrence found there. |
| Image/configuration/credit waits | Structured transport admission follows preparation and applies on concrete requests/retries. Citation callers remain an incomplete migration under finding 1. |
| Managed originals | Access and disclosure are separated; pinned versions, staged digest/size and sender access remain checked in the inspected Gmail, Drive and share paths. |
| Disabled settings | Known policies survive disabled reads and aggregate mappings. No recurrence found. |
| Held TypeSafe reservation | Final admission and denial propagation are present. The missing session in citation callers causes safe denial rather than bypass. |
| Annex stale responses | Epoch/operation fences cover selection changes and late success/error/finally paths. Independent selected plans retain their own lineage. |
| Research V1/V2 pairing | Selected reference resolution and evidence remain pinned. A suspected Vault assessment race was refuted: profile projection locks selected documents before chunk reads. |

I also inspected neighboring page/history/approval, replay, private artifact, template/portal, Vault version/extraction, and connector paths selectively. I did not require unit3 tasks, fees, activity, Lume controls, or final visual completion.

The global void-return exemption remains the documented lint-policy objection, **not an additional functional finding here**. The two scoped polling callbacks use `requestCapability`, whose network failures resolve to explicit error results. The diagnostic alone does not prove an unhandled rejection or user failure.

Existing evidence was kept separate from this review. The parent’s retained regression log confirms **15/15**. Current parent typecheck and lint passed, with the recorded lint warning. Writer validation was **945/946**; the status-label correction passed its two tests. At my final state read, the parent’s current full-root test was still active, with build and combined browser checks pending. I claim no all-green validation.

Depth gaps remain: exhaustive ACL/FK interleavings, complete connector reconciliation and worker graphs, every legacy migration scenario, full editor internals, and browser trace/video inspection. Desktop/mobile/keyboard and controlled annex results are existing author/parent evidence, not independently exercised here. Live model quality, live Google/email delivery, generic pending/unknown recovery, and the intermittent ended-session navigation cause remain unverified or unresolved.
