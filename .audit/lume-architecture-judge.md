# Verdict: use proposal 1 as the base and graft in proposal 3's page tables

## Scores

| Rubric | P1 | P2 | P3 |
|---|---|---|---|
| 1. Product and mobile coverage | 4 | 4 | 4 |
| 2. Privacy, folders, permissions, revocation | **2** | 4 | **5** |
| 3. Chat persistence, frozen context, approvals, concurrent edits | **5** | 3 | 4 |
| 4. Simplicity and reuse | 3 | 2 | 3 |
| 5. Migration and test sequence | **4** | 3 | 3 |

**P1** is the most concrete design. Only P1 handles these points:
- Scope stored on the message, with server-side reuse on regenerate.
- The fix for the stale memoized transport.
- "Editar" rejects the proposal instead of mutating it.
- The 409 message names the other editor.
- Real `running` tool events.
- The `restrictedReads` gate.
- Test files named for each step.

Its fatal flaw is sharing the private `ai_artifact` row in place. I checked the schema. `ai_artifact` carries `run_id`, `conversation_id` and `source_refs`. `ai_artifact_version.user_id` keeps every earlier draft, and the citation-review and human-review tables cascade from the artifact. `placeArtifact` would show members the whole private draft history and its provenance. It would also turn all 18 `ownedArtifact` call sites and 12 `/api/artifacts/[id]/*` routes into shared-access paths. One miss there leaks private work. That contradicts "não publica conversas, memória ou rascunhos particulares".

**P2** copies on publish, which is correct. But it puts two ownership models in one table (`ai_artifact.scope`). Every private listing, citation, verification and human-review query would then need a scope filter. It also adds an event ledger and collaborative, folder-bound tasks with assignees. It is weakest on regenerate.

**P3** has the right ownership model: `case_page` and `case_page_version` belong to the case office, and `ai_artifact` is unchanged. It also treats shared-page text as untrusted for injection. But it adds an event ledger, and its sequence starts with the shell before the access contracts.

## Base: P1

Keep from P1:
- Panel in the layout; the URL drives the canvas.
- `shellReducer`, `chatScopeFor`, `useLume`, `FocusChat`.
- Stable transport; stored scope on the message.
- `vault_case.agent_access`, checked in the `caseScope` branch of `assertCapabilityAllowed`.
- `shared_with_case` tasks, with the creator as the only writer.
- Activity computed at read time.
- Its fixes to `ui-service` and session handling, and its build order with failing tests first.

## Grafts (4)

1. **Shared pages use P3's tables.** Drop P1's `ai_artifact` columns, `artifactAccess` and `placeArtifact`. `ownedArtifact` stays private-only, and the 18 call sites stay as they are.
   - Add `case_page(id, case_office_id, case_id, folder_id, title, content, version, created_by, created_at, updated_at, deleted_at)`. It has a composite FK to `vault_case(office_id, id)`, and a check that the folder belongs to the same case.
   - Add `case_page_version(page_id, version, title, content, author_id, author_kind 'person'|'lume', created_at)`, with primary key `(page_id, version)`.
   - Saves do `UPDATE … WHERE version = $expected` and insert the version row in the same transaction.
   - Two creation paths:
     - `POST /api/cases/[id]/pages` creates a blank page.
     - `publishCasePage` (from P2, with `idempotencyKey`) copies **one** reviewed version of a private artifact. It copies no `run_id`, `conversation_id`, `source_refs` or history.
   - `DocumentWorkspace` takes a `DocumentRef` adapter (from P3), and draft keys are namespaced by `kind`. Export and format reuse pure helpers that take `(title, content)`. The private-only routes stay off for pages: citations, verification, human-review and sources.
2. **Shared-page content is untrusted in agent prompts (from P3).** Pages written by other participants enter the prompt through the existing injection guard, not as trusted instructions.
3. **Contextual send is disabled while the canvas destination is still loading or authorizing (from P2).** Sending with the previous screen's case is never allowed. The snapshot is copied at send time and the selection is consumed once.
4. **Move `/app/calc` and `/app/honorarios/propostas` into `(office)` without changing their URLs (from P2).** I confirmed both are currently outside the group, so the panel would unmount on those screens.

## Reject

- **P1's in-place artifact sharing:** `ai_artifact.case_id/folder_id/updated_by`, `artifactAccess` replacing `ownedArtifact`, and `placeArtifact`.
- **P2's `ai_artifact.scope` and copying into `ai_artifact`:** two ownership models in one table.
- **The event ledger (`case_activity_event`) from P2 and P3.** It needs a transactional writer in every mutation path (Cofre uploads, agent tools, portal, agenda, pages), and it still has to be filtered by current access when read. Instead, compute activity from current rows:
  - `vault_document` filtered by `vault_folder_visible`
  - `case_page_version`, which gives `page.updated` with author and Lume origin
  - `collaboration_audit`
  - shared tasks

  The accepted losses are that deletions and intermediate task states don't appear.
- **Collaborative, folder-bound tasks with assignees (P2 and P3).** Those mean several writers across offices. In v1 a shared task is read-only for participants, and only the creator edits it.
- **Copying a personal task to share it.** A personal task linked to a case stays private.
- **Building the shell before the access contracts (P3's order).**

## Constraints to add

1. **Source restrictions on pages.** Generalize `restrictedReads` into a per-turn taint check against the audience of the destination.
   - The turn is tainted if it read a source from:
     - another case
     - a folder that is not the destination folder or one of its ancestors
     - a private artifact, attachment, research item or connector
   - Both tool reads and the frozen request sources (`documentIds`, `openDocumentId`) count.
   - A tainted shared write needs Confirmar. The approval input names the case, folder, page id and `expectedVersion`, so the approval stays bound to that destination.
   - Moving a page follows the existing move rules for `vault_document`.
   - Residual risk to document: private memory can't be tracked by this check.
2. **Regenerate and approvals.** On `regenerate-message` the server ignores the scope in the request and re-authorizes the stored scope. `decideAgentApproval` keeps running only the stored input. A Lume run editing a page it didn't create always needs approval.
3. **Revocation.** Every read of a page, a list or activity re-checks `caseAccess` plus folder visibility for all ancestor folders. Tabs persist only `href`; titles are re-fetched. No cached content is shown after a 401, 403 or 404, and a revoked tab is removed.
4. **Migration and tests.** Use one additive `0075` migration; confirm the number on the branch. It contains `case_page` and `case_page_version`, `agenda_activity.case_office_id` and `shared_with_case` (with P1's DO block for the foreign key), and `vault_case.agent_access`. Run it with `pnpm db:setup`.
   - Order: access and tests → tasks and activity → chat → tokens → shell → case space → docs.
   - Required tests:
     - two-user save: one 409
     - pages in a private folder are absent from lists, activity and agent reads
     - a revoked participant gets 404
     - regenerate ignores the scope sent in the request
     - a tainted write requires approval
     - a published page contains no `conversationId` and no history
     - e2e: A→B navigation during a run, plus mobile at 390 px

## Product questions, resolved

- **`agent_access`:** applies only to participants' Lume. That matches where it is enforced (guest `caseScope`). Label: "Participantes podem usar o Lume neste caso". The owner changes it only after Confirmar.
- **Mobile deep links:** an explicit open intent from a notification opens the canvas. Otherwise the default is the chat.
- **Fees:** participants read values under the current rule, and pricing appears only with `canManage`. Use the home context with a case filter. Fees don't appear in activity.
- **"O que o Lume fez hoje":** use only rows with recorded origin (`created_by_agent`, `vault_agent_origin`, `author_kind='lume'`). Omit the section if those are empty.
