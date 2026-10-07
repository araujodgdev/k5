**Recommend C as the base, with three focused grafts and scope reductions below.** Its tool-free writing call fits the existing runtime and gives shared generation the clearest input boundary. None of the packages is implementation proof.

I read all three designs end to end, the named grounding/review artifacts, the rubric and red flags, then checked disputed points against source. No writes, git commands, tests, servers, browser, migrations or delegation were performed.

| Rubric criterion | A | B | C |
|---|---|---|---|
| **1. Usable normal workflow** | **3/5.** Request-bound drafting and private archives work, but quarantining ambiguous legacy human drafts substantially changes existing behavior. | **4/5.** Captured sends, linked shared tasks and bounded outbound composition support practical continuation. Legacy audience fences add migration burden. | **4/5.** Direct request plus authorized snapshots produces a proposal without deleting memory. Tool-free generation needs clearer continuation of an uncommitted proposal. |
| **2. Complete, honest input/source boundary** | **4/5.** Strongest prohibition on planner text and planner-selected handles; covers previews, settings, templates and generated send bodies. Coverage requires extensive integration. | **4/5.** Separates submissions, observations and derived output; explicitly preserves prefill lineage and instruction-version policy. External entitlement machinery exceeds demonstrated needs. | **4/5.** Excludes private memory/history/tools from writing and separates approval display. Raw `PersonSave.text` and settings persistence need a concrete submission/seed binding. |
| **3. Version/concurrency correctness** | **4/5.** Immutable flattened guards, atomic content/policy/result commits and exact consumed retries. Explicit transaction/session treatment is useful; office gates need complete adoption. | **4/5.** Adds generation-attempt reservation, frozen proposal results and ordered policy-domain locking. Changes every autosave into retained history unnecessarily. | **4/5.** A/B/A and reciprocal observations avoid live graph cycles; confirmation/cancellation/CAS have atomic outcomes. Audience-fingerprint invalidation adds avoidable conflicts. |
| **4. Interface depth and scope** | **3/5.** `deliverContent` hides substantial policy, but the generic content boundary and pervasive execution receipts make this the broadest repair. | **3/5.** Strong content owner, but public prepare/commit delivery stages, triggers, audience fences and tool-capable writing enlarge caller coordination and scope. | **4/5.** Tool-free writing removes a whole class of admission adapters. Document operations are cohesive; file/delivery stages must remain internal to existing sink operations. |
| **5. Concrete implementation and proof** | **4/5.** Correctly identifies transaction-helper limitations, sampled artifact history, background writers and actual provider-byte tests. Rollout prerequisite is too broad. | **4/5.** Detailed call-site migration, attempt recovery, template distinctions and PostgreSQL regressions. Trigger activation and historical fences complicate rollout. | **4/5.** Existing `generateStructured` provides a concrete starting point; migration and regressions are actionable. Settings bindings and attempt recovery need tightening. |
| **Total** | **18/25** | **19/25** | **20/25** |

The scores are close because the candidates converge on the same sound core: authenticated intent, independently assembled generation, immutable observed-version policy, live ACL checks and atomic commits. C wins on implementation scope, not prose quality.

C’s runtime fit is real: [`generateStructured`](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/ai-runtime.ts:193) already creates an agent without chat memory or tools and runs one structured generation step. Extend that path behind the policy owner; avoid introducing another conversational execution system.

**Take these three grafts:**

1. **B’s authenticated submission and prefill binding.** Replace C’s raw person-save boundary with a server-recorded submission identity carrying any application seed/base policy. Apply this to generated instructions and knowledge usage notes as well as document text. Bind their exact versions/digests to policy. `changeAgentSettings` currently calls the same `saveInstruction` used for ordinary settings, and `updated_by` records the user in both cases; it proves neither authorship nor clean lineage. Confirmation must not mint person-origin evidence.

2. **B’s bounded shared-task continuation and attempt reservation.** Associate direct follow-up instructions with an exact eligible proposal/version and its original source selections. “Deixe mais breve” can then revise the pending proposal in the same conversation without importing a private assistant summary or requiring repeated source selection. Reserve preparation by send/attempt/operation so retry recovers its proposal while deliberate regeneration creates a new attempt.

3. **A’s transaction-helper fit while preserving artifact history behavior.** Move artifact CAS/history SQL into a transaction-aware internal writer; retain sampled autosave history while binding policy to every committed version number. Use transaction-bound approval and authorization helpers, and explicitly order session revocation where atomic authorization is claimed. [`updateArtifact`](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/ai-store.ts:78) currently owns a separate batch and deliberately samples autosave snapshots. Calling it inside `withTransaction` would not compose one atomic commit.

**Reject or trim these mechanisms:**

- **Wholesale historical quarantine and cutover audience registries.** A’s rejection of nearly every unproven legacy human draft, C’s general quarantine of old shared pages, and B’s frozen principal roster impose new historical guarantees. Preserve documented legacy human ownership behavior and existing reads under a bounded compatibility evaluator that enforces every recoverable restriction. Keep uncertainty explicit. Unknown legacy model text must not become eligible input for a new shared derivative; missing/malformed sources still fail closed. This preserves behavior without fabricating historical completeness.

- **C’s mandatory destination audience fingerprint.** Exact review should bind bytes, destination, operation and versions. A participant change need not invalidate an otherwise authorized proposal when every read still intersects destination access with retained source guards. Recheck authorization; require another review when the approved operation or payload changes.

- **B’s history-per-autosave change and deferred binding triggers as prerequisites.** Per-version policy is necessary; a visible historical text row for every autosave is not. Start with the sole transactional writer, uniqueness constraints, fail-closed readers and production-entry-point regressions. Add triggers only if an identified writer cannot be contained.

- **Universal provider/content instrumentation before the first safe slice.** Attest the actual bounded writing request and disable private continuation there. Record policies for new content-bearing private outputs and replayed known sources. Do not require a complete historical memory reconstruction or an adapter for every private capability before shared drafting works.

- **A new remote redistribution platform.** Preserve existing research eligibility checks and application-known restrictions. Do not make generic proof of third-party ownership or remote ACL completeness a prerequisite for all ordinary connector use. Explicitly exclude unsupported inputs from bounded writing; enforce known restrictions on managed generated/copied payloads and reject unverifiable protected destinations.

- **C’s categorical rejection of moving an owner-only archive into a broader container.** With complete read/list filtering, an immutable owner fence keeps its effective audience private. Moving or widening a folder need not become a new approval ceremony or remove that fence.

Some breadth is nevertheless mandatory. The source confirms concrete escapes:

- [`readDocumentShare`](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/personal-chat/shares.ts:152) reads a pinned Vault version under the share grant, without checking artifact ancestry.
- [`publishPortalArtifact`](/C:/Users/douglas.araujo/Documents/dgstack/k5/apps/web/src/lib/client-portal/service.ts:167) renders through a Word template even though its result is PDF.
- Gmail sends raw generated body/subject text independently of attachments.
- Background workflows insert new artifacts outside the page writer.

Consequently, guarding page publication and “Salvar no Cofre” alone cannot satisfy the contract. Those managed files, text payloads, templates and subsequent reads need coverage. Downloads and manual redistribution remain an explicit application boundary.

**Two objections block implementing C unchanged:**

- Its person-input interface does not yet prevent an application-prefilled *new* document or setting from entering as unrestricted human text. Graft 1 must resolve this in storage and callers, not merely in explanatory prose.
- Its atomic authorization claim depends on transaction-aware checks and adoption by the relevant ACL writers. `assertCapabilityAllowed` currently uses the global database, while `withTransaction` supplies only a connection-scoped `prepare`. An office gate used by only some writers establishes no ordering guarantee.

The provider request also needs a boundary test proving that private session/history/memory bytes are absent. That is an implementation acceptance gate, not a reason to restart architecture. No broader design blocker remains after these corrections.

The bounded implementation contract should be:

1. Add the next unused migration without modifying 0075; preserve content, approvals, history and metadata.
2. Establish canonical exact-version classification and authenticated submission/seed bindings. Never let a failed proposal alter existing policy.
3. Deliver one real same-conversation request → tool-free generation → authorized exact preview → atomic confirmation slice. Pin observed content policy; evaluate current resource ACL separately.
4. Migrate artifact/background writers and the demonstrated managed copy/text exits before enabling unrestricted new sharing. Preserve guest capability limits, original invocation and the case Lume switch.
5. Verify actual provider bytes, PostgreSQL rollback/concurrency, A/B/A, exact retry results, private archives and revocation through production entry points. Keep provider-stub evidence distinct from live-model usability evidence.

This retains the accepted private artifact/shared page split and existing runtime. Editor restore and access-loss repairs remain outside this review.
