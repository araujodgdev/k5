Reviewed all **47 named files**, including inherited comments. **Files touched: none. Deletions performed: 0. Recommended: 187 comment lines across 21 files.** Parent retains judgment.

Paths below are relative to `apps/web`. Delete these complete comment ranges; keep surrounding code:

- `src/lib/application/idempotency-service.ts:9` — **1** line.
- `src/lib/application/research-service.ts:142,345–346` — **3** lines.
- `src/lib/agent-tools/index.ts:54,277,295–296,333–334,342–343,601,606–607,646` — **12** lines.
- `src/lib/capabilities/contracts.ts:418,430,447,515–516,578–579,591–592,669–670,692,718,721,745` — **15** lines.
- `src/lib/capabilities/http-client.ts:13–17,217–218,288–289` — **9** lines.
- `src/lib/collaboration/capability-access.ts:8,56` — **2** lines.
- `src/lib/application/context.ts:49–53` — **5** lines; the comment promises membership/case checks that `assertWorkspaceSession` does not perform. Those checks belong to `assertCapabilityAllowed`.
- `src/lib/annexes.ts:32` — **1** line.
- `src/components/vault-annexes.tsx:15` — **1** line.
- `src/lib/knowledge/retrieval.ts:65–70,102–103,111,129,148–149,190,213,224` — **15** lines.
- `src/lib/citations/sources.ts:64` — **1** line.
- `src/lib/citations/review.ts:93` — **1** line.
- `src/lib/google/gmail/service.ts:271` — **1** line.
- `src/lib/google/operations.ts:81,89,106–110,143–144,283,318,349,364` — **13** lines.
- `src/lib/client-portal/service.ts:69,265` — **2** lines.
- `src/app/api/client-portal/invitations/[token]/route.ts:18` — **1** line.
- `src/lib/chat-turn.ts:59,62,91–93,99–100,113–114,131–133,155,158–159,197–198,216,240,247,252,264–265,268–273,278,284,298,303–304,320,336,338,350,353,366–367,385–387,404,412,433–434,471–472,477` — **51** lines.
- `src/lib/auth-core.ts:29–30,50,61,85,90,125–126,138` — **9** lines.
- `tests/security.test.ts:75–77,85,91,175–176,199–201,206,214,231,237–238,266,296–297,310–311,320,350–351,367–368,373,380,384,388,392,397,414` — **32** lines.
- `tests/citations.test.ts:53,93,108,119,137,140–141` — **7** lines.
- `e2e/client-portal.e2e.ts:9,28,36,48,61` — **5** lines.

Most are own-code narration, banners, historical explanations or repeated assertions. The PJe naming requirement, provider PDF limits, Gemini restriction, Gmail draft lifecycle and blanket Google HTTP-status guarantees were not independently established by the permitted inspection; they receive no foreign-platform exemption.

**MUST KILL targets — report only:**

- `src/lib/chat-turn.ts:63 — pdfPageCount`: regex misses compressed page objects; zero passes the `:316` page check. Make its incomplete-count semantics explicit.
- `src/components/vault-annexes.tsx:16 — fileName`: independently duplicates `annexFileName`’s normalization; the “mirrors” comment conceals duplicated ownership.
- `src/lib/agent-tools/index.ts:579 — describe`: `sources` means both excerpts and installations; use an explicit discriminator or named branches.
- `src/lib/knowledge/retrieval.ts:71 — documentIds`: implicit authorized-default selection needs a name or extraction expressing that fallback.
- `src/lib/capabilities/http-client.ts:18 — googleRoutes`: the five-line justification describes client-wide guarantees above Google-only route construction.
- `src/lib/google/operations.ts:111 — admit`: the private atomicity justification should become explicit reservation/locking ownership in its name or extraction.
- `src/lib/chat-turn.ts:143 — scope`: name the generated filename/status manifest directly; delete the historical cost justification.
- `src/lib/chat-turn.ts:275 — mediaParts`: make last-user-message attachment placement explicit in the symbol or extraction.

**Skips: 113 retained comment lines.**

Public API documentation accounts for **101 lines**:

- `documents/shared-writing.ts:24`
- `application/idempotency-service.ts:25–30`
- `agent-tools/index.ts:256–260,308–312,355,403,643`
- `capabilities/contracts.ts:17–22,35,49–53,105,117–120,681–684`
- `collaboration/capability-access.ts:23`
- `application/context.ts:8,12,15,19,22,28,30–33`
- `annexes.ts:21,43–46,131,188`
- `app/api/vault/cases/[id]/annexes/route.ts:9`
- `knowledge/retrieval.ts:33–37`
- `citations/sources.ts:12,51`
- `citations/review.ts:11–16`
- `google/gmail/service.ts:68–71`
- `google/operations.ts:40,43,45,47,51,54,200,214,218,310–313,381,407`
- `chat-turn.ts:51`
- `auth-core.ts:15,18–22,25,27`

Foreign-dependency exceptions account for **12 lines**, checked against installed dependency source:

- `agent-tools/index.ts:287–288` — Zod object parsing strips undeclared fields.
- `auth-core.ts:42–43,56–58,73–74` — Better Auth’s pending-email callback, conditional email-change behavior and IP-header fallback.
- `chat-turn.ts:340–341` — Mastra awaits the step-finish callback.
- `tests/auth.test.ts:356` — Better Auth refreshes the prior session before issuing its replacement cookie.

No scoped suppressions found. The remaining **23 files contain no comments**. Applied migrations and the generated Next.js AGENTS block were excluded. No edits, tests, browser actions, DB writes or child agents.
