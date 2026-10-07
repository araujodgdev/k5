# Lume shared pages — Unit 2

Implemented on `feat/lume-agent-canvas`, preserving the accepted uncommitted shell work. No checkout, commit, deployment, developer migration or secret change. The supplied single-writer authorization superseded the brief's hold line. The accepted architecture was used without a new design round. Independent review and the final root suite/build remain with the parent.

## Delivered behavior

Cases now have a Páginas section with real listing, empty/loading/error states, creation and opening. The existing editor handles private artifacts and shared pages through `DocumentRef`, API/href adapters and distinct draft/revision keys. Shared routes remain inside the persistent office layout. Participants in different personal offices can edit the same page. Stale saves preserve the local draft and require an explicit choice; version restore compares the version acknowledged by the preceding save. Shared DOCX preview, export controls and version history use page authorization. Private-only citation/review controls are absent for shared pages.

Publicar no caso in the private editor saves pending changes, chooses a case/folder, previews the full exact content, version, destination and audience, then creates a reviewed copy. It never converts or moves the original. A participant can open/edit the copy but cannot read the original private artifact. Existing Processos, Referências, Anexos, participant/folder actions remain; folders show Páginas and Arquivos, avoiding empty root-only sections.

Shared-page agent capabilities are registered for list/search, get, create, update, publish, versions, restore and export. Case scoping grants only these narrow operations. General guest CRM/agenda/private artifact ownership was not broadened. Server-created agent context is carried into chat admission and execution. Tool descriptions explain the shared-page module and reviewed publication. Actual successful outputs supply canvas links/revision updates; late outputs retain the shell navigation-generation protection.

Stored send/regeneration scope is now version 2 and carries a discriminated document reference plus a copied selection. Existing stored v1 private focus/selection is deliberately translated. Regeneration reloads the original scope and checks current access; a shared ID is never treated as a private artifact ID. Confirmed case revocation also invalidates namespaced drafts for removed shared-page tabs. Ordinary route cleanup still retains drafts.

## Storage and migration

`apps/web/db/postgres/0075_case_pages.sql` adds:

- `case_page`: resolved case office, case, folder, title/content, positive version, durable source dependencies, creator and timestamps.
- `case_page_version`: immutable content/title/source snapshots keyed by page/version, author and timestamp.
- `case_page_approval`: durable source restrictions and conversation reference attached to an existing capability approval, plus committed result page/version.
- `ai_source_provenance`: office/user/resource-scoped conversation or artifact provenance, with completeness and durable dependency union.

No existing tables/rows were converted. `ai_artifact` and `ownedArtifact` remain private. Migration 0075 was applied only to the supplied disposable instance, using its supported `K5_ENV_FILE` and `pnpm --filter @k5/web db:setup`; port 62542, run `20261006T234247-d88728`. No developer `.env.local` or database was used. Migration 0075 has already run there and must not be edited in place.

## Authorization, provenance and approvals

`case-pages/service.ts` concentrates access and mutation. The session provides the user/home office; the current case grant resolves the destination office. Every operation rechecks current participation and protected folder ancestry, including for the creator. Cross-case folders are rejected. Page get, filtered list/search, versions, restore, canvas, exports and agent reads share the same access boundary. Hidden pages are removed before titles/counts/search results are returned. Export reauthorizes and compares the version again after conversion.

Dependencies include case, folder, Vault document and shared page. Page dependencies recurse into their current restrictions, fail closed on cycles/missing sources and remain attached through human edits and restores. Document-derived provenance records both the document and its case/folder at observation. Completeness can only change from true to false; dependencies accumulate durably, including across deferred approval and later artifact edits. Tool output provenance is stored before returning it to the model. Earlier recorded conversation sources are reauthorized before replaying model history.

The model boundary is intentionally conservative. Existing citations/source_refs alone are insufficient. Legacy agent artifacts, old untracked conversation histories, attachments, injected knowledge, writing rules, learned memory, working memory and unclassified tool paths cannot produce a shareable output unless provenance is complete. The Mastra working-memory storage read is observed before returning memory to the processor; a test caught that overriding `Memory.getWorkingMemory` alone was insufficient because the processor reads storage directly. Unknown inputs mark durable completeness false. This is not a claim of comprehensive model-memory taint tracking or prevention of arbitrary human copy/paste.

Shared text, including focused title/selection and derived private focus, uses the existing injection guard. Page tool results (including write/restore output) are guarded before model ingestion. Missing/failed classification fails closed. An approval never overrides current source access. Private artifact-to-Vault copying is rejected when recorded provenance is restricted/incomplete; the protected page publication path must be used instead of flattening the restrictions into a file.

Agent page writes always require a durable exact approval; direct human editor saves use the same service/CAS boundary without an agent confirmation. Publication always requires review. Capability name, canonical input, user, home office, destination and version must match. The publication input binds the exact private artifact version; changing it after preview causes a conflict. Current permissions and durable conversation/source provenance are checked again after waiting for approval. Page/version writes, approval consumption, result page/version and a recoverable chat result commit in one PostgreSQL transaction. A consumed retry returns the authorized page without duplicating it. A forced version-insert failure test proves the whole mutation and consumption roll back.

## Validation and evidence

Final scoped command passed **49/49**:

```text
pnpm --filter @k5/web test tests/case-pages.test.ts tests/lume-workspace.test.ts tests/document-drafts.test.ts tests/chat-route.test.ts tests/agent-capabilities.test.ts
```

Breakdown: 10 real PostgreSQL case-page tests, 5 real chat-route admission tests with the existing execution substitute, 19 controller/scope tests, 6 draft tests, and 9 agent runtime/guard tests using a scripted external model boundary. Coverage includes cross-office participant edits, two-writer CAS conflict, outsiders, creator revocation, nested private ancestors, wrong-case folders, private-original isolation, exact publication/altered input, concurrent replay, source revoke/regrant, filtered search/history/export, deferred incomplete provenance, transaction rollback/recovery, stored scope compatibility/regeneration, guarded page text and actual working-memory reads.

The log is `.audit/lume-pages-unit2-tests.txt` (normalized to UTF-8). Initial iterations had two new-test failures: the ineffective memory observer described above, and a controller test that attempted to revoke a case descriptor it had never registered. The observer was fixed at the storage boundary; the test now registers the known case tab before asserting cascading revocation. The final 49-test run is green. Expected test-process localStorage/Better Auth rate-limit warnings remain.

Scoped ESLint passed across the new routes/service/UI and modified integration/test files. A final ESLint pass over the last changed service, tool registry, editor and e2e file also passed. `pnpm --filter @k5/web exec tsc --noEmit` passed. `git diff --check` passed (Git emits the existing Windows line-ending normalization warnings). No generated validators were hand-edited. Root full lint/test/build were intentionally left for the parent per the brief.

The supplied verify-lume instance passed doctor before driving. Final browser suites:

- `drive case-pages --video`: **4/4** = 2 real feature flows, 1 explicitly tagged frontend-contract, 1 real authentication setup. Real flow: case controls create/edit/reload/restore, SQL/API persistence, DOCX preview, keyboard and 390px canvas switching. Publication flow: exact review/copy, another participant's real conflicting edit, explicit draft recovery, outsider/direct API/version/export/canvas denial and live visible-tab revocation. The frontend contract delays mocked `/api/chat` and verifies the real shared-page transport reference, unaffected second editor and background result revision.
- `drive document-saving --video`: **13/13** = 12 existing private-editor contract scenarios plus authentication. These intentionally mock artifact persistence/failures and some chat responses; they prove editor regression behavior, not real private storage or provider execution. Real private save/publication storage is covered by the publication feature flow above.

Evidence is retained under `apps/web/.e2e/verify/20261006T234247-d88728/case-pages/` and `.../document-saving/`, with summary/report, per-test trace, screenshots and video. The initial cold creation run hit the normal 10-second editor wait while the route/API compiled (the screen was still “Abrindo documento…”). On the next run a test incorrectly expected a trailing Markdown newline; it now compares the persisted API value. Both real flows then passed, followed by the final 4/4 suite. Initial evidence is preserved in `.audit/lume-pages-e2e-first-run/`; the second-run and first-green summaries are also in `.audit/`.

Manual T3 preview verification on tab `tab_b_069f8326-6fa0-400f-aa92-a6cf7f3a264c` opened the real case/page, edited and saved content, checked 1280px and 390px, opened versions and used Escape. DOM evidence at 390px: `innerWidth=390`, document `scrollWidth=390`, focus restored to `Versões`, hidden chat `inert=true`. Screenshots and recording are copied beside this report as `lume-pages-desktop.png`, `lume-pages-mobile.png`, `lume-pages-manual.mp4`.

The real mobile Exportar PDF control also completed: authenticated page export returned HTTP 200 for version 3 and downloaded a 2,664-byte `%PDF-1.7` file, preserved as `.audit/lume-pages-export.pdf`. The final preview diagnostics had no console errors. Final doctor remained healthy on the supplied ports; all 48 implementation paths listed below exist and the two feature recipe copies are byte-identical.

## Limits and scope decisions for parent review

- No live AI provider is configured in this instance. Live delayed provider execution is **not proven**. Neither the internal chat mock nor the scripted agent model test is reported as a live provider end-to-end run.
- The conservative provenance boundary can refuse publication of a model artifact or shared write after memory/attachments/instructions/knowledge/unclassified tools were used. It preserves the private draft and explains the refusal. Human pages and participant editing are fully implemented; sources have not been silently made public.
- Shared pages intentionally omit private-only citation review and private document templates. They use pure export/format behavior, as accepted. No new global citation/search/activity exposure was added; page search is the authorized narrow capability/list query.
- Public-folder removal reparents pages with existing documents/subfolders. Removing a protected folder with pages is rejected. Transferring a whole case to another case while it contains shared pages is explicitly rejected until relocation can preserve/review the new audience; ordinary case deletion still revokes page access through the case tombstone. This is an additional protective integration decision, not a new page-transfer feature.
- Source dependencies are conservative and monotonic. Removing a source may make its derived page unavailable, and editing away the text does not erase its restrictions automatically. No dependency-removal workflow is claimed.
- Task collaboration, fees/activity redesign, the owner-controlled case Lume switch and final full-case/home visual integration remain Unit 3/later work. New page routes/tools use existing central context checks and server-created invocation context so that policy can be enforced centrally in the next unit. The current pre-existing owner `contextForCase` path still returns the home context; the next unit must enforce owner policy as well as guest policy there/admission/source loading, per the accepted contract.
- No unresolved failing test is being handed over. The parent still owns adversarial review and final full checks. The verification instance remains alive intentionally for that handoff; I did not run `down` against the parent's supplied instance.

## Exact implementation files

All paths below are relative to the repository root. Files already touched by Unit 1 retain its accepted work; this list identifies Unit 2 edits rather than attributing the entire branch diff to this unit.

New files:

```text
apps/web/db/postgres/0075_case_pages.sql
apps/web/src/lib/document-ref.ts
apps/web/src/lib/case-pages/contracts.ts
apps/web/src/lib/case-pages/provenance.ts
apps/web/src/lib/case-pages/service.ts
apps/web/src/components/case-pages.tsx
apps/web/src/components/document/publish-document.tsx
apps/web/src/app/api/cases/[caseId]/pages/route.ts
apps/web/src/app/api/cases/[caseId]/pages/publication/route.ts
apps/web/src/app/api/cases/[caseId]/pages/[pageId]/route.ts
apps/web/src/app/api/cases/[caseId]/pages/[pageId]/versions/route.ts
apps/web/src/app/api/cases/[caseId]/pages/[pageId]/restore/route.ts
apps/web/src/app/api/cases/[caseId]/pages/[pageId]/format/route.ts
apps/web/src/app/api/cases/[caseId]/pages/[pageId]/export/route.ts
apps/web/src/app/app/(office)/vault/cases/[id]/pages/[pageId]/page.tsx
apps/web/tests/case-pages.test.ts
apps/web/e2e/case-pages.e2e.ts
.agents/skills/verify-lume/features/case-pages.md
.claude/skills/verify-lume/features/case-pages.md
```

Existing files edited by Unit 2 (some are untracked files from Unit 1):

```text
apps/web/src/lib/capabilities/contracts.ts
apps/web/src/lib/capabilities/http-client.ts
apps/web/src/lib/collaboration/capability-access.ts
apps/web/src/lib/agent-tools/index.ts
apps/web/src/lib/agent-tools/selection.ts
apps/web/src/lib/application/approvals-service.ts
apps/web/src/lib/application/agent-approvals.ts
apps/web/src/lib/application/artifacts-service.ts
apps/web/src/lib/application/vault-service.ts
apps/web/src/lib/vault.ts
apps/web/src/lib/agent-guard.ts
apps/web/src/lib/agent-memory.ts
apps/web/src/lib/chat-turn.ts
apps/web/src/lib/chat-contract.ts
apps/web/src/lib/chat-scope.ts
apps/web/src/lib/chat-scope-server.ts
apps/web/src/lib/lume-workspace.ts
apps/web/src/lib/canvas-resources.ts
apps/web/src/app/api/chat/route.ts
apps/web/src/components/lume/lume-workspace.tsx
apps/web/src/components/agent-chat.tsx
apps/web/src/components/document/document-workspace.tsx
apps/web/src/components/document/page-preview.tsx
apps/web/src/components/vault-case-view.tsx
apps/web/src/app/app/(office)/documents/[id]/page.tsx
apps/web/src/app/app/(office)/vault/cases/[id]/page.tsx
apps/web/tests/lume-workspace.test.ts
apps/web/tests/chat-route.test.ts
apps/web/tests/agent-capabilities.test.ts
```

Audit-only files/evidence are under `.audit/lume-pages-*`; the report and decision trail are `.audit/lume-pages-unit2.md` and `.audit/lume-pages-unit2-decisions.tsv`. Skills applied: actual p3-mode skill and its feature workflow (with the user's fixed architecture/single-writer constraints), e2e, verify-lume and the previously read writing/domain/audit principles. No absent `agents/p3-agent.md` was fabricated or required.
