# Parent judgment after source-policy reviews

The source-policy implementation is not accepted. A, B and C reviewed the same frozen production tree independently with the same prompt. All three used GPT-6.1 Sol High/Fast under the user's model override. Their reports are preserved verbatim. This is independent review, not model diversity.

The parent inspected the cited production paths and owns the following decisions. Four issues have controlled runtime proof against actual production services; the remaining accepted issues currently have code-path evidence and require regression proof during repair. The passing 22-test selection after comment cleanup does not cover these paths.

| Repair | Review findings | Parent decision and evidence |
| --- | --- | --- |
| ACL ordering and move authorization | A1, C2 | Act. Actual participant grant and page creation reproduce PostgreSQL 40P01. updateDocument checks move authority before the gated UPDATE and never checks it again after waiting. Inventory mutation owners and correct ordering and reauthorization together. |
| Natural session expiry | B7 | Act. Actual createPage waits past natural expiry and still commits because transaction CURRENT_TIMESTAMP predates the wait. |
| Exact extracted version | A6, B3, C5 | Act. Actual V1 processing then V2 replacement exposes V1 text under V2 observation. Worker lease/version binding must accompany admission. |
| Authenticated audio/images | A7, B5, C6 | Act. Actual HTTP/provider boundary proves transcription omission. Code trace confirms DOCX embedded pictures and native inline inputs are also absent from shared submission. |
| Task continuation | B6, C7 | Act. Previous output and policy do not contain omitted original attachment facts. Latest same-case proposal alone cannot identify every new request as a follow-up. Retain explicit bounded task identity and original inputs, with a fresh-task path in the same chat. |
| Returned artifact exposure | B1 | Act. List returns titles without input artifactId, so current provenance branch misses guards. Historical lists read latest policy rather than returned version policies. |
| Cached citation authorization | A4 | Act. conversationSources retrieves stored Vault text using conversation ownership only; both chat and artifact citation consumers can pass it to TypeSafe after source revocation. |
| Stable legacy identity | A5 | Act. vaultPolicy allocates random read-time receipt that uploadVersion binds into canonical exact confirmation. Normal unchanged confirmation cannot match. |
| Gmail source audiences | A2, B2 | Act. Writer sees multiple message bodies; union of participants does not establish every recipient's access to every contributing message. |
| Gmail compose lifecycle | A3, C4; B plausible concern | Act for identifiable app-managed prefill/compose/draft lineage. The normal save/reopen flow drops seed/reply context. Editing must not erase the server-owned baseline. Do not overclaim detection of arbitrary copied text in a wholly new direct submission. That remains the synthesis's explicit manual-copy limit. Remove message-wide seed inference that taints independent typed replies. |
| Exact Calendar confirmation | B4 | Act. Central approval consumes planner payload before shareEvent calls the fresh writer and publishes different fields. Exact generation must precede review; consumption and result commit together. |
| Vault managed transformation | C1 | Act. Actual annex producer passes neither policy nor origin, and canonical creation defaults to unrestricted person policy in a public folder. Require explicit classification at canonical writer and migrate callers. |
| Archival context | C3 | Act. Renderer/storage staging retains an outer session context, but createVaultDocument reconstructs office/user only. Final commit misses logout/cancellation. |
| Private consumed replay | C8 | Act. editArtifact requires current artifact before the exact historical replay branch. Later unrelated source restrictions can defeat an authorized prior result. |
| Combined browser failures | All reviewers | Act on evidence gap. Narrow reruns do not resolve unexplained RSC/navigation failures. Diagnose before claiming full unit acceptance. |

No accepted source-policy architecture is being replaced. The immutable policy, exact proposal, tool-free writer and private/shared document split remain. The repair must make the actual domain owners enforce those rules. No new design arena or human approval is needed. The Gmail caveat above narrows an unverifiable broad claim while preserving the concrete lifecycle defect.

Runtime evidence is under apps/web/.e2e/verify/20261006T234247-d88728. Audio: source-test-1791345195304. Deadlock: source-test-1791345646853. Extraction: source-test-1791345854483. Natural expiry: source-test-1791345908514. These are deliberately failing diagnostic regressions, not green suite results. Their scripts are retained in .audit/lume-*-repro.test.ts.

One Sol High/Fast writer will implement .audit/lume-provenance-repair-brief.md. Parent keeps the writer slot exclusive and owns independent acceptance and later units. The repair sequence follows dependency ownership: canonical writes and ACL transactions, authenticated inputs and exposure, connector lifecycle and exact review, then combined browser verification. No production deployment or developer database change is authorized by this handoff.
