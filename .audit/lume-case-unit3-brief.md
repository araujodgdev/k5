# Case collaboration implementation brief

Prepared by the parent while unit 2 runs. This is not permission for another code writer. Wait for the parent's explicit single-writer handoff and the reviewed unit-2 result.

Read the p3-mode skill, repository instructions, relevant bundled Next guides, DESIGN, app README and environment example. Use .audit/lume-architecture-synthesis.md as the accepted contract. Earlier architecture proposals contain rejected ideas, notably a universal activity ledger and folder-bound tasks. Do not reintroduce them. Keep private resources private and preserve the completed shell and page work.

## Shared tasks

Extend the existing agenda_activity model with explicit personal/case visibility. Existing rows remain personal even when case_id is present. A shared case task has a case, task kind and the case's resolved office. It excludes private CRM links and calendar fields. No separate task folder hierarchy is needed.

Provide narrow case-task operations with version checks for current participants, eligible assignees and cross-office access resolved from the case. Do not add broad agenda or CRM capabilities to the shared-case whitelist. Existing personal agenda endpoints and exports must not become alternate ways to read or mutate a shared task without its current case permission. Do not expose personal case-linked tasks in case lists, counts or activity.

Support useful task creation, status changes, editing and assignment in the case UI for owner and participants. Preserve personal task behavior. An outdated edit returns a conflict and retains the person's draft. Idempotent creation and concurrent edits must not duplicate side effects.

Trace task-delegation.ts before adapting it. It currently assumes task, delegation and conversation share one office. A shared task belongs to the case's office, while each requester's Lume conversation and delegation receipt belong to that requester's home office. Keep the existing run admission, capacity and retry protections. Only the requester sees the private conversation link. Other case participants see the shared task's actual state, never its prompt, messages or outputs that were not explicitly published.

Inspect notifications/events.ts, worker.ts and repository.ts together. They currently require recipient membership in event.office_id and resolve agenda destinations in the recipient office. A case participant belongs to a different home office. Deliver task assignment/change notifications to authorized intended people without granting office membership or exposing unrelated agenda rows. Apply current access at projection, inbox presentation, destination resolution and push eligibility as applicable. Test revocation before delivery, reassignment, deduplication and private-task isolation. Use real transactional event capture; no UI-only notification simulation.

## Case Lume policy

Add an owner-controlled vault_case.lume_enabled flag, default enabled. Use the existing assertLumeAdmission/assertSourcesAdmitted boundaries from the source-policy repair and replace their absent-column fallback once the migration exists. Keep a single policy field. The prototype copy is:

"O Lume pode trabalhar neste caso"

"Ele lê e edita com as permissões de quem pede. Envios para fora sempre pedem confirmação."

The policy denies ALL agent work bound to the case when disabled, including the owner's agent. It does not change human access or independent portal publication. It is not merely a guest capability filter or cosmetic switch.

Trace admission, source loading, capability execution, deferred approvals, regeneration and task delegation. Check the flag before beginning work and before later privileged operations. Resolve case identity from resource IDs on the server so an omitted caseId does not bypass the policy. Account for case-owned files, pages, selected sources, research references and broad agent knowledge searches. Filter or deny blocked case data without breaking human reads. A running or approved operation must not retain authorization after the flag or participant access changes. Re-enabling restores currently authorized agent work.

## Honorários and activity

Reuse honorarios/service.ts in the person's HOME context. Its accessibleAgreements query already permits current linked-case participants to consult and only creators to manage. Do not broaden the service's guest office context or duplicate finance storage. A case view shows only agreements linked to that case, allowed amounts/state and existing management links. Private pricing, CRM profiles, unrelated balances and integrations stay private.

Compose recent case activity from authoritative existing records and the new page versions. Use actual case_page_version edits, case-bound collaboration_audit changes, and file/task creation or current-state timestamps for what those rows establish. Filter each resource through its live access service. A current task row cannot establish a full transition history. Do not invent deletions or historical events, or create a duplicate universal ledger. Never display private chats, memories, approvals, delegation transcripts or office-wide audit entries as shared case activity.

## UI and validation

Integrate tasks, Honorários, activity and existing participant controls into the case. Keep pages/files from unit 2 and preserve Processos, Referências, Anexos and folder controls. Sharing remains existing association plus explicit case participation. Do not change it into public-link access. The later visual completion unit can polish the whole home/case composition, but all features here must be usable and accessible in pt-BR on desktop and 390px.

Use additive migrations, real PostgreSQL tests and real UI/API e2e flows. Test two home offices, outsider denial, version conflict, private case-linked tasks absent, assignee eligibility, notification revocation, delegation privacy, fee permissions, activity source filtering and owner/participant policy denial. Include policy changes after proposal/admission and before execution. Verify that human access and portal policy remain independent. Internal API mocks cannot be the only proof of these behaviors.

Use only the parent's isolated verify-lume instance or its safely recreated successor. Never touch developer services, data or secrets. One code writer per checkout. No commits, deployment or production migration in this handoff. Save the report at .audit/lume-case-unit3.md with concrete files, contracts, tests/artifacts and unresolved limitations. The parent owns final full checks and independent review.
