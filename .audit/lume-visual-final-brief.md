# Final product composition brief

Prepared read-only by parent while case collaboration is implemented. NOT permission for a second writer. Start only after explicit handoff and read the completed case-unit3 report so the visual pass integrates real features rather than duplicating them. Accepted architecture is .audit/lume-architecture-synthesis.md. User wants implementation finished promptly; no design bakeoff, comment-review cycle or unrelated restyling.

## Reference evidence

User PDF C:/Users/douglas.araujo/.t3/userdata/attachments/36799375-22e8-4ee2-8675-8d16f7ff7ab6-ce415330-ebbc-432b-8d43-a5be3914582b-pdf.pdf contains12 pages. Parent visually inspected pages1,8,9,12 rendered in .audit/lume-prototype-pages/page-1.png,page-8.png,page-9.png,page-12.png. Use those actual images, not the tiny initial diagram alone. The supplied HTML is a packed offline page; naïve text extraction yielded only its loader, so .audit/lume-prototype-visible-text.txt is not reference content. Do not execute the attachment's scripts against app sessions.

Page1 shows a quiet warm canvas with a dated Hoje list, recent-case cards, actual Lume activity below and the floating chat taking roughly one third. Page8 shows the case title/client/process context, participants and Compartilhar action, text-like section navigation and a unified Tudo grid of pages/files with origin metadata. Page9 shows association-backed sharing, participants, private-conversation explanation, the enforced Lume toggle and independent portal controls. Page12 shows compact file/page rows on390px, a clear back-to-Lume action, selected case context and a contextual ask entry. Other prototype pages show focused/collapsed modes and progress/actions inside the same private Lume conversation. The implementation contract already resolved private drafts versus explicit shared publication and version conflicts; never undo it to copy a mockup.

## Existing structure and remaining integration

The persistent shell, light/dark semantic tokens, actual Lume mark, panel modes, URL-driven tabs, mobile surface state, legal gates, app launcher and editor reuse already exist. Preserve their state/authorization behavior. Current command-center.tsx still has the old two-column section dashboard, module-color rules, task/meeting/client lists and a generic chat empty state. It needs the final home composition. Current case implementation must be inspected after unit3 for real sections and data.

Use the workspace tokens in lume-workspace.css and DESIGN.md, monochrome navigation, restrained borders and peach for Lume emphasis. Do not restyle public landing/auth or unrelated full modules. Preserve explicit saved dark theme. Avoid a second shell/header/sidebar. At desktop use generous readable spacing, title hierarchy and real content previews; at mobile use compact rows and44px interaction targets. Support reduced motion and keyboard/focus. No decorative fake document lines masquerading as extracted text.

## Home

Replace the old dashboard layout with date, a primary daily work list, recent cases and recent real work/activity, matching page1's hierarchy. Use real personal and authorized shared tasks, upcoming meetings, available notifications and fee due dates through existing domain services. Explicitly label any horizon wider than today. Empty/loading/partial-error states must remain useful; keep refresh and real creation/navigation actions. Do not invent injunctions, deadlines, receipts or progress to populate the mockup.

Recent case cards use actual accessible cases, descriptions and authoritative timestamps, with real participants only when the domain exposes them safely. Cards open the case in the canvas. Preserve global Honorários and all module entry points through the shell. An activity label that credits Lume must be supported by actual recorded actor/origin. If a mixed list includes human events, label it Atividade recente. Do not infer work from a private chat title, scheduled job or pending approval, or create a universal audit ledger. Reuse unit3 activity/notification projection with current access rather than dumping office audit rows. Avoid arbitrary static metrics and fake empty-demo people.

Home data stays in the authenticated person's home context. General agenda/CRM permissions must not be widened to get shared-case tasks onto this screen. Reuse unit3 task access and a narrow current-user projection if required. No unrelated balances or participants' private conversations.

## Case space

Finish a coherent header with real name/description/client/process metadata only as currently permitted, participants and a usable Compartilhar control backed by existing association/participation services. Show the single enforced case Lume switch and independent portal management already built by unit3. Keep copy explaining that conversations/memory stay personal, Lume acts with the requester's permissions and clients see explicitly published items only.

Provide a real Tudo view composing authorized pages and files at the current folder level. It must not make unrelated private artifacts into case pages, bypass ancestor folder permissions, expose filtered counts or reset pagination. Keep Pages/Files/Tasks/Honorários/Activity and existing Processos/Referências/Anexos/folder actions discoverable. Text tabs and a discreet overflow for secondary actions are acceptable; do not remove existing tools just to resemble the prototype.

Page/file previews and metadata use actual domain data. Author, Lume-at-request-of, uploaded-by and portal-publication labels must reflect real records, never a generic guess based on file type. Extend only narrow safe DTO metadata where needed, with existing resource authorization. Generated private drafts appear only to their owner until explicit publication. Pending approvals remain private. Do not represent actual extraction/loading as indefinite decorative skeletons.

The contextual Pedir ao Lume action opens/focuses the existing private chat with the registered case for the next message. It must not discard an existing conversation, send text without intent, alter an in-flight request's scope, or reveal another person's task conversation. Keep deep links opening the requested canvas resource on mobile and preserve input/editor drafts when switching surfaces.

## Chat presentation

Use the existing user's actual display name, local greeting/date and context for a useful empty state matching the prototype. Generic suggested actions may prefill the composer; do not auto-send or claim that specific work exists without data. Preserve upload, speech, existing model controls and legal gates.

ToolActivity already consumes actual data-tool steps, while chat-turn emits transient data-status on tool-call and data-tool with a stable callId on completion. Shape this real activity into compact module-labelled work rows, current work and a clear precise approval state. If adding running rows, emit them from the already-observed real tool-call boundary and update the same callId on completion. Do not invent future stages, fake assistants, denominators or a planned task count the system has not recorded. Keep Lume as one voice and modules as labels. Preserve resource Abrir behavior and stale-output ownership protection. Do not revisit the scoped-out Mastra stream scoring concern to deliver this presentation.

## Validation and delivery

Use only owned verify instance runID20261006T234247-d88728, app62541 PG62542, no developer services/env/data and no live external traffic. Read current unit3 report and wrapper state first. Native T3 preview status/open first; use repository e2e only after explicit unavailable/unsupported result. Parent's prior native host was unavailable, but availability may change.

Check meaningful real flows on desktop and390px: home case opening, Tudo page/file opening and pagination, context change, shared task notification/delegation links, sharing/owner switch and portal independence, dark theme, keyboard and draft preservation. Hold actual network responses where proving races; do not mock internal services as sole business proof. Use actual disposable fixture data and retain before/after screenshots/video. Preserve existing shell/editor/portal e2e assertions and update only text/layout expectations that intentionally change. Root lint/typecheck, full root tests, production build and integrated affected e2e are parent-owned final batch after the last source change.

No commits/PR/deploy. No nested agents or cosmetic review loops. Report .audit/lume-visual-final.md with user-visible behavior, evidence, affected files, outstanding limits and explicit writer release. Full implementation remains incomplete until this composition and final validation are complete.
