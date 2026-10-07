# Lume functional repair

The eight accepted repair groups are implemented in the existing architecture on `feat/lume-agent-canvas`. This writer preserved the intentional dirty tree and migrations 0075 through 0089, including 0080a. No commit, deployment, developer environment edit or developer service operation was performed.

All runtime work used owned verification run `20261006T234247-d88728`, app 62541 and PostgreSQL 62542. Tests used real PostgreSQL and production owners, with synthetic Google, model and TypeSafe transports, subject to the transport exception below. The requested `p3-mode/agents/p3-agent.md` is absent from both installed skill trees. The available p3-mode skill and the explicit implementation role supplied the working instructions. The user override excluded nested delegates, design tournaments and review rounds.

The first consolidated run selected three existing agenda tests that called `interpretAgenda` without its synthetic transport while prior tests left TypeSafe enabled with a fake key. Those tests attempted the real TypeSafe transport and timed out after five seconds. This violated the no-external-traffic restriction. All inputs and keys were synthetic; no successful provider response is recorded. The three tests now pass their existing synthetic transport, and the source-check wrapper preloads `.audit/lume-no-external-test-traffic.mjs`, which blocks unstubbed fetches except the owned app at 62541. This exception is not represented as safe live-provider validation.

## Dispositions

| Finding | Change and evidence |
| --- | --- |
| A2 | Semantic query embedding requires the original `ContentAdmission`. Both concrete embedding adapters use its guarded fetch, cancellation signal and manual redirect policy after configuration resolution. Access denial cannot become lexical fallback. `embedTexts` retains the separate indexing contract. The real retrieval regression denies a revoked retained query contributor with zero embedding calls. |
| A3/B2/B1 | Document execution reconstructs persisted original `WorkspaceContext` once. Retrieval and TypeSafe reranking retain its source policies, original session and run lease. Checkpoint/progress writes reauthorize inside their transactions. Final artifacts require the original authority and an unexpired matching lease. Real `startRun`/`processNextRun` regressions cover healthy TypeSafe RAG and original session revocation during the final writer response, with no final artifact after revocation. |
| C1/C3 | Chat, automatic artifact review and the authenticated manual citation route retain the original workspace context. Review admits the complete answer or exact artifact-version policy and candidate policies. Scoring cache entries retain the complete derived policy without requiring a research pin. Independent public citation sources remain independent. Actual agent artifact creation, authenticated chat and authenticated citation POST regressions cover healthy evaluation and denied artifact contribution with zero secondary calls. |
| A1/C2 | Seeded list edits with a valid read token cannot delete an observed list identity and introduce a null identity in the same save. Identity-preserving edits and the existing reviewed generated replacement contract remain available. The real save regression uses readToken, CAS, explicit old-ID deletion and edited null-ID replacement; a second participant cannot read the original contribution or the rejected replacement. Existing round3 coverage checks reordering, category moves, hidden entries and independent additions. This does not claim to prevent arbitrary human copying. |
| B3 | The research capability returning boundary reauthorizes every exposed policy for agent/WebMCP results, including cached results, before recording provenance or returning bytes. Human-local reads are unaffected by the AI-only gate. Regressions call the actual agent tool and judgment, saved search and corpus capabilities after `permission_ai` is prohibited. |
| B4 | Keyed successful Gmail draft-save replay admits the stored draft policy and exact managed file bindings before returning cached metadata. Binding digest and size must match the managed original. Access checks remain separate from external delivery permission. Google effects are not repeated. The existing sent-draft historical replay regression remains in the affected suite. |
| B6 | Assessment evaluation supplies the queued configuration version/model. Evaluation checks that identity at configuration load, reservation and concrete dispatch. The assessment lease callback repeats the configuration check inside its admission transaction. Drift yields `unavailable/configuration_changed`, releases an unattempted reservation and does not penalize provider health. Regressions cover drift between worker/evaluator loads and a PostgreSQL trigger changing configuration during the actual reservation. |
| A4 | ResearchCaseLinker fences every late load/save/assessment/poll/reference success, error and finally update using selection and operation identity. Tokens include case, material, open state and judgment. Version-matching drafts survive selection changes. The real browser regression holds actual production HTTP responses after the server operation. It covers A-save/B-selection, late errors, material changes, late assessments and reference creation, keyboard selection and 390 px without overflow. |
| B5 | Dismissed after confirming `assessmentInput -> researchCaseSnapshot -> projectProfile -> observeVaultFile`, in the same ACL read transaction. `observeVaultFile` takes `FOR SHARE OF d` for every admitted selected document before assessment chunk reads. Both explicit chunk and fallback reads follow that lock chain. No redundant lock was added. |
| C4 | Scoped out as the brief permits. Stream registration ordering has no demonstrated runtime score failure and retains the safe low-reliability outcome. No producer redesign or unsupported hook was added. |

## Reproduction and validation

The initial consolidated negative run `source-test-1791374179080` reproduced missing original citation/session authority, leaked scoring cache, accepted seeded null-ID replacement, agent catalog disclosure, unguarded query embedding, failed healthy background RAG, completed artifact after in-flight session revocation and one dispatch under changed assessment configuration. The Gmail result in that initial run was invalid as a negative proof because its Google fixture lacked the draft GET following the real save. That fixture was corrected; the final Gmail denial test requires a successful real save before revocation.

The parent UI negative proof is [lume-research-linker-race-proof.md](./lume-research-linker-race-proof.md), with `source-e2e-1791374078103` recording the old A response replacing the selected B field after both SQL state assertions passed. Native T3 preview explicitly lacked an automation host; the repository e2e fallback was used under that documented exception.

The expanded UI positive is `source-e2e-1791374965047`, 1/1 passed. It retains report, video and screenshots under `apps/web/.e2e/verify/20261006T234247-d88728/`. Earlier expanded attempts exposed cold route compilation exceeding the test poll window and an ambiguous label locator. The locator was corrected; timeout limits were not widened. Subsequent fixture typing fixes declare the test window property and return JSON `null` from browser callbacks. They do not change the held responses or UI assertions.

The first owner regression positive is `source-test-1791374523760`, 12/12 passed. The corrected Gmail negative is `source-gmail-negative-1791375453437`, 0/1 passed with `Missing expected rejection` after the real save succeeded. The helper temporarily removed only the new successful-save replay admission block, then restored the exact original file. Its `restoration.json` records the matching SHA-256. This is a controlled rollback proof performed after fixture correction, not the original pre-edit baseline.

| Check | Result | Evidence directory under the owned run |
| --- | --- | --- |
| Consolidated 17 affected test files | 132/135 passed. Three unstubbed agenda transport timeouts, corrected below. | `source-test-1791375079224` |
| Corrected citation, functional repair and TypeSafe suites | 37/37 passed with the external network guard. Includes the real scoring owner and queued configuration disable race. | `source-test-1791375493085` |
| Functional repair suite after type-correct fixture adjustments | 10/10 passed with the external network guard. | `source-test-1791375747474` |
| Expanded desktop, keyboard and mobile e2e | 1/1 passed. | `source-e2e-1791374965047` |
| Root typecheck through the owned wrapper | Passed after the final lint fixes. The preceding fixture typing errors were corrected. | `round3-root-typecheck-1791376207884` |
| Root lint through the owned wrapper | Passed with zero errors and the existing unused `_bytes` warning in `judicial/connectors/transport.ts:416`. | `round3-root-lint-1791376378026` |
| Diff whitespace | Passed with `cr-at-eol` for the Windows checkout. | `git -c core.autocrlf=false -c core.whitespace=trailing-space,space-before-tab,cr-at-eol diff --check` |

Each evidence directory contains `output.log`. Browser evidence also contains `report.json`, screenshots and video. The 98 other tests passed in the consolidated run. All 37 tests from the modified files passed in the corrected run, and the final fixture adjustments were covered by the 10-test run. No full root test or build result is inferred from those selected suites.

The first lint run found a configuration local that needed `const` and the synchronous reset of linker controls on a server-selected judgment change. Evaluation now captures the immutable loaded configuration directly. The linker uses one documented local `react-hooks/set-state-in-effect` exception for that reset. No global lint configuration was changed.

The selected files were `source-functional-citations`, `source-functional-repair`, `source-round3`, `source-handoff-round3`, `source-dispatch-round3`, `source-gmail-binding`, `source-catalog-cache`, `typesafe`, `citations`, `jurisprudence-score`, `run-model-plan`, `research-core`, `research-case`, `research-capabilities`, `indexing`, `agent-knowledge` and `google-gmail`, all under `apps/web/tests/` with `.test.ts` extension. Commands ran through `.audit/lume-source-checks.mts`; root checks ran serially through `.audit/lume-round3-root-checks.mts`.

## Changed files owned by this repair

Production changes are in:

- `apps/web/src/lib/knowledge/embedding-provider.ts`, `knowledge/retrieval.ts`, `typesafe/rerank.ts`.
- `apps/web/src/lib/document-workflows.ts`, `documents/service.ts`.
- `apps/web/src/lib/citations/review.ts`, `citations/artifact-review.ts`, `citations/sources.ts`, `chat-turn.ts`, `application/artifacts-service.ts`.
- `apps/web/src/app/api/artifacts/[id]/citations/route.ts`.
- `apps/web/src/lib/research/case-content.ts`, `research/case-assessment.ts`, `typesafe/client.ts`.
- `apps/web/src/lib/agent-tools/index.ts`, `google/gmail/service.ts`.
- `apps/web/src/components/research-case-linker.tsx`.

Regressions are `apps/web/tests/source-functional-repair.test.ts`, `source-functional-citations.test.ts` and the parent-created `apps/web/e2e/research-linker-race.e2e.ts`, extended by this writer after the parent negative proof existed. `apps/web/tests/typesafe.test.ts` loses its extra blank EOF, supplies synthetic agenda transports and checks the queued configuration disable race. Audit helpers are `.audit/lume-functional-browser-fixture.mts`, `.audit/lume-functional-gmail-negative.mts` and `.audit/lume-no-external-test-traffic.mjs`. `.audit/lume-source-checks.mts` loads the network guard for targeted test runs.

Model the Domain determined the retained run execution object and UI operation token. Prove It Works determined the use of real owner calls, authenticated routes, PostgreSQL assertions and actual returned browser bytes instead of helper-only assertions.

## Limits and ownership

Live Google/model validation, full root tests, production build and broad browser integration were deliberately excluded by the handoff. The unintended transport attempts described above provide no live-provider validation. UI polling has the same operation fence, but the browser regression exercises returned disabled assessment responses rather than a live provider polling session. Unit3 and final product integration remain outside this repair. The stopped old root sequencer was intentionally terminated by the parent and is not reported as a spontaneous test failure or a completed check.

The production code writer slot is relinquished. All writer-owned checks are complete and drained. The existing owned verification instance remains available for the parent's final batch. No further source edits are in progress.
