# Lume implementation contract

Status: accepted implementation contract after reading all three proposals and the independent Opus cross-judge. Unit 1 is in progress. The shared-resource contract below applies to subsequent units.

## Caller usage

```tsx
<DocumentDraftsProvider>
  <LumeWorkspace identity={{ userId, officeId }} aiNoticeAccepted={accepted} flags={flags}>
    {children}
  </LumeWorkspace>
</DocumentDraftsProvider>

// An authorized case or document loader registers the current resource.
<CanvasResource resource={resource} />

// The existing editor adapts persistence according to resource ownership.
<DocumentWorkspace resource={{ kind: 'case-page', caseId, id: pageId }} />
```

These names describe intended boundaries, not existing APIs. Choose consistent local names during implementation. Do not add unused scaffolding.

## Ownership and shape

```ts
type DocumentRef =
  | { kind: 'artifact'; id: string }
  | { kind: 'case-page'; caseId: string; id: string };

type CanvasResource =
  | { kind: 'module'; slug: NavSlug }
  | { kind: 'case'; caseId: string; folderId: string | null }
  | { kind: 'document'; document: DocumentRef }
  | { kind: 'file'; documentId: string; caseId: string | null };

type PanelMode = 'floating' | 'focused' | 'collapsed';
type MobileSurface = 'chat' | 'canvas';
type CaseSection = 'all' | 'pages' | 'files' | 'tasks' | 'honorarios' | 'activity';
```

The URL owns the active canvas. Tabs contain canonical resource descriptors, not mounted copies of every screen. Existing route loaders retain authorization. The persistent office layout owns one private chat and the shared draft provider. Identity changes discard client state. Conversation changes may replace its runtime; canvas navigation and panel modes may not.

The shell exposes resource opening, next-send snapshot, document selection/ask and resource invalidation. The state model owns tab identity, panel mode and mobile surface. Avoid separate route registries and duplicate navigation lists. Derive the launcher from navigation.ts and existing flags.

One stable chat transport reads a copied, immutable snapshot on send. Navigating changes the next message only. A destination that has not registered an authorized context cannot send under the previous destination's context. Clear case-specific overrides and selection when moving cases. The server stores authorized scope metadata with the user message; regeneration uses that original scope and current authorization. Exact approval input remains stored server-side. Resource outputs may open a background tab but cannot replace an unrelated editor the person has opened since sending.

## Shared resources

Use candidate 3's separate case_page and case_page_version tables. Keep ai_artifact and its private ownership predicate unchanged. Publishing creates a new shared page from an explicitly reviewed version. It does not convert or move the private original. Reuse the editor and its draft/version-conflict state through one document persistence adapter.

Case page operations concentrate authorization, case/folder consistency, version comparison, provenance and transactional events in one service. All read surfaces use the same access rule, including versions, exports, search, citations, agent access and event lists. A page creator does not bypass current membership or a protected ancestor folder. Record source dependencies needed to keep source restrictions effective after publication. Do not use a transient in-memory read set as the only protection across approval/retry.

New shared task visibility is explicit; existing rows remain personal. A case link alone does not share a task. New case tasks are visible to the current participants, who can collaborate using versioned writes; assignees must be eligible participants. Do not introduce a second folder hierarchy for tasks in this refactor. Shared task payloads exclude private CRM fields, calendars and delegation conversations. Narrow case-task capabilities grant no general agenda or CRM access. Delegating creates a private conversation in the requesting person's home office.

Reuse current Honorários policy with the person's home context. Linked-case participants can consult current allowed values; the creator manages and private pricing remains hidden. Do not duplicate the finance model.

Build recent activity from authoritative records already owned by each resource: case_page_version for actual page edits, collaboration_audit for membership changes, and file/task records for the creation or current state their timestamps actually establish. Filter every item through current resource access. Do not add a duplicate universal event ledger in this refactor. Do not invent deletion events or intermediate task history from a current row. Activity contains no private prompt, approval, memory or transcript.

The owner-controlled Lume switch defaults enabled and denies all case-bound agent work when off, including the owner's agent. It never changes human access. Enforce at admission/source loading and subsequent privileged operations. Portal publication remains independent and explicit.

## Product and visual decisions

The supplied HTML supersedes the old authenticated app's square, colorful chrome. Follow the warm light canvas, restrained borders, monochrome navigation and peach accent. Desktop defaults to the floating panel, approximately one third of the window, with 10 px inset and 16 px panel radius. Focus and collapsed modes retain runtime state. Stored explicit theme preferences remain valid; new users default to light.

Mobile starts in chat on a fresh root visit. An explicit resource deep link opens the canvas so the person reaches the requested destination. Both surfaces remain mounted; the hidden surface is inert. Preserve input and editor drafts across switching, dynamic viewport and safe-area behavior, keyboard focus, reduced motion and 44 px touch targets.

Preserve utility actions from AppSidebar, legal gates, notifications, feedback, PWA installation, profile, sign-out, onboarding and every module destination. Preserve Processos, Referências, Anexos and folder controls inside the case experience. Use real execution/tool/approval data for agent progress and real origin/events for home activity; omit unavailable representations rather than inventing progress, workers or work performed.

## Parent comparison

Scores are design judgments from reading all three complete proposals, not measurements.

| Criterion (1–5) | Candidate 1 | Candidate 2 | Candidate 3 |
| --- | --- | --- | --- |
| Product and mobile coverage | 4 | 4 | 5 |
| Privacy and live permissions | 2 | 4 | 5 |
| Persistent chat and concurrent context | 4 | 4 | 4 |
| Reuse and maintainable boundaries | 3 | 4 | 5 |
| Verifiable migration sequence | 4 | 4 | 5 |

Selected base: candidate 3. It keeps private artifacts private and contains new collaborative ownership behind explicit page services. Candidate 1 changes ownership in place and allows creator bypass; candidate 2 uses a safer separate copy but still requires every private artifact caller to understand shared storage scope.

Grafts from candidate 1: stable transport scope reads; server-stored scope for regeneration; cheap persistent layout without repeating full conversation bootstrap; actual running/completed tool events. Reject implicit artifact publication, creator access bypass and transient restrictedReads as sole durable policy. Accept activity composed from authoritative version/audit records, without claiming an exhaustive timeline.

Grafts from candidate 2: block contextual submission while destination context is unresolved; explicitly migrate outlying calc/propostas routes and sidebar utilities; deny cached-message fallback on access errors. Do not broaden the guest capability whitelist to general office operations.

## Independent cross-judge and lead decision

The Opus judge recommended candidate 1 as the shell base with candidate 3's separate page tables. This agrees with the selected ownership boundary and the concrete context grafts above. The base label differs because the parent prioritizes private ownership as the central boundary; no alternate shell architecture remains contested. Full report: lume-architecture-judge.md.

Accepted additional simplifications: compose activity from resource version/audit records instead of a second event ledger; omit private-only citation/review endpoints from shared pages and reuse pure export/format helpers; do not add folder-bound tasks.

Rejected product reductions: participants' case tasks will not become read-only, because the existing collaboration model says participants collaborate in the case and the prototype shows assigned tasks. Version checks protect concurrent updates. The Lume switch applies to all case agent operations, not only guests, because the supplied prototype says "O Lume pode trabalhar neste caso" and "Permitir que o Lume trabalhe neste caso". Implementation location in caseScope is not a product requirement. Shell-first is acceptable because this unit uses existing private and file authorization; new shared data is introduced only with its access contracts and tests.

Source publication must preserve explicit audience boundaries. Record durable dependencies for source-derived pages. A confirmation is not permission to move another person's protected content into a broader audience. Shared writes that incorporate private artifacts, attachments, connectors, another case, or more restricted sources require a reviewed, exact destination/version/payload. Treat shared text as untrusted model input through the existing injection boundary. Do not promise that an in-memory taint set fully tracks model memory.

These implementation choices will receive adversarial code review before completion. The three designs and cross-judge establish interfaces, not proof that the eventual code works.

## Verifiable implementation units

1. Persistent shell, prototype chrome, existing route canvas, modes/mobile, private document integration, per-send and regeneration context. Scoped state/context tests and shell e2e.
2. Shared pages, publication, provenance, versioned editor adapter, exports and narrow agent capabilities. Real PostgreSQL tests cover two-person conflicts, private original isolation, nested-folder restrictions, revocation and approval/retry.
3. Case tasks, Honorários projection, real activity, sharing and enforced Lume policy. Test participant actions, outsider denial, notification recipients and independent portal policy.
4. Complete case and home visual integration, preserving existing actions and accessible loading/empty/error states. Verify desktop/mobile/light/dark with the supplied prototype.
5. Full root lint, typecheck, test and build; affected e2e suites. Independent review, accepted fixes, browser recording and decision-trail audit.

One code writer works in this checkout at a time. Parent verifies behavior and reviews diffs. No deployment, merge, production migration or external message is part of this authorization.
