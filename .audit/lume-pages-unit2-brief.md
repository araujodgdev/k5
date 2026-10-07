# Shared pages implementation brief

Prepared by the parent while the shell fix round runs. Do not start this unit until the parent grants the single-writer slot and records the shell result.

Read C:/Users/douglas.araujo/.agents/skills/p3-mode/SKILL.md. The referenced agents/p3-agent.md was absent in the prior bounded search. Use the actual skill directly. Read root README and AGENTS, apps/web/AGENTS, relevant bundled Next guides, DESIGN, apps/web/README and .env.example without exposing secrets. The accepted contract is .audit/lume-architecture-synthesis.md. The requested outcome and sequence are docs/lume-agent-canvas-implementation.md. Preserve every in-progress change on feat/lume-agent-canvas.

Implement unit 2 completely, including usable UI, APIs, database migrations and meaningful tests. Do not restart architectural exploration. Do not implement the later shared tasks/activity/fees redesign in this unit. Do not commit, deploy, migrate the developer database, edit secrets, spawn another code writer, or create another checkout. The parent owns final full-suite validation and review.

## Data shape and boundaries

- Keep ai_artifact and ownedArtifact private. Add separate case_page and case_page_version storage, scoped by the case's resolved office. Use the next unused migration number after 0074. Preserve all existing rows.
- Introduce DocumentRef as artifact or case-page and use it consistently for canvas, editor persistence and namespaced drafts. Adapt DocumentWorkspace rather than duplicating the editor. Existing private routes and exports remain supported.
- Concentrate case-page authorization and writes in one server service. Derive user and home office from requireWorkspace. Resolve the destination office through caseAccess/contextForCase. Check current case participation and every protected ancestor folder, including for the creator. Check case/folder consistency. A client office ID is never authorization.
- Support create, list, get, edit/save with optimistic version comparison, version listing/restore and exports. Stale writes must preserve the human draft and return a conflict. Page/version creation and mutation are transactional. A retry must not duplicate an approved publication or consume approval without a recoverable result.
- All read surfaces, including versions, exports, canvas descriptors, search, agent reads, citations and later activity, use the same access rule. Do not leak hidden page titles/counts/history through alternate paths. Shared pages do not call private-only citation/review endpoints. Reuse pure export/format helpers and expose only supported review UI.

## Publication and provenance

Publication is an explicit reviewed copy of an exact private artifact version into an exact case/folder. It does not move the original or share its conversation, memory, attachment history, approval or transcript. The preview shows the content and audience before confirmation. Another participant cannot access the original after publication.

Store durable source dependencies needed to preserve restrictions after publication and later edits. Recheck them on approval, retry and reads after permission changes. Another person's protected material cannot become accessible to a broader audience merely because a private draft or model output contains it. A confirmation does not override current source permissions. Keep dependencies through versions and restore. Distinguish explicit publication of one's own private draft from permission to expose its protected upstream sources.

Existing conversationSources and artifact source_refs are useful evidence but do not assume they cover all model inputs. Inspect knowledge loading, attachments, memory and tool paths. A transient restrictedReads set alone cannot protect a later turn or deferred approval. Use a conservative, explicit boundary when provenance is incomplete; do not claim full model-memory taint tracking. Shared text is untrusted input and passes through the existing injection/confirmation guard.

## Agent integration

Add narrow typed case-page capabilities to the existing contracts/executor registry, case scoping and tool selection. Do not grant general agenda/CRM/private-artifact access to guests. Private artifact ownership uses the person's home office, even when the page destination belongs to another case owner.

Shared writes involving private or more restricted material require an exact reviewed destination/version/payload. Reuse the existing durable approval mechanism; descriptions must show the actual content and destination the person approves. Recheck permissions immediately before mutation, including after an approval wait. No forged approval ID or altered input may authorize a different write. Do not rely on an invocation flag accepted from the browser.

Integrate real tool outputs with canvas resource links and revision notifications, preserving the shell's navigation-generation guard against late-result takeover. Extend frozen message scope and stored regeneration metadata to address a shared page without treating its ID as a private artifact ID. Existing stored scope compatibility must be deliberate and tested. The owner-controlled case Lume policy is the next unit, but do not create paths that will bypass its central enforcement.

## UI integration

Provide case page listing, creation, opening and private draft publication through actual controls. Preserve Processos, Referências, Anexos, folders and existing case actions. Use the supplied prototype's warm canvas and pt-BR labels. Clearly indicate private versus shared destination without adding implementation jargon to the product.

Route shared pages under the existing office layout so the conversation stays mounted. Canvas tabs must be server-authorized and pruned on known lost access. Both editor draft keys and resource refresh keys distinguish private artifact from shared page. Preserve selection/ask behavior with the new document reference. A fresh root mobile visit starts in chat; explicit page deep links open the canvas.

## Verification

Run scoped PostgreSQL tests and editor/controller tests, scoped lint and typecheck, and affected e2e flows using the e2e and verify-lume skills. Parent provides the current isolated instance after shell fixes. Never use port 3000 or developer PostgreSQL 55432. Do not launch a second verification instance while one is alive.

Meaningful coverage includes owner and participant edits from different home offices, two-person version conflict, outsider denial, private original isolation, nested-folder restrictions, creator denied after revocation, direct URL/export/version denial, exact publication approval, source revocation between proposal and approval, replay/idempotence, and a late result while another resource is open. Human edit and agent edit must exercise the same service access boundary. Cover real UI creation/edit/reload/publication and mobile 390px. Internal API mocks are contract tests, not end-to-end proof. External provider stubs may isolate a real provider boundary if needed.

Do not rerun the entire root suite for this unit. Prior full baseline was 816/817 due a PostgreSQL acquisition timeout; isolated typesafe retry passed 22/22. Report all new failures honestly. Regenerate owned Next type outputs when needed; do not hand-edit generated validators.

Return exact changed files, migration and data shape, authorization/provenance decisions, tests and artifacts, remaining limitations, and any unresolved objection that affects the contract. Save the report in .audit/lume-pages-unit2.md. The parent reviews the implementation independently before advancing.
