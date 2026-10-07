Unit 1 is implemented on `feat/lume-agent-canvas`. No commits, branches, migrations, or audit-file edits were made.

The shell now owns one persistent `AgentChat`, with floating, focused, collapsed and mobile modes. Existing Next routes render in the canvas. Authorized resource tabs persist as user/office-scoped URLs, document navigation saves first, and delayed tool results cannot replace a destination opened after sending.

The private document editor now lives in the canvas, retaining drafts, conflicts, selection requests and revision updates. `/app/agents` handles conversation/focus intents and legacy document links. Calc and propostas retain their URLs inside the persistent office layout.

Each send copies its context synchronously. The server validates and stores that scope, restores it for regeneration, and reauthorizes access. Restricted conversation responses clear cached content; transient failures retain the cache fallback. Navigation renews the session without an idle-extending timer.

Notifications, feedback, theme, profile, logout guards, PWA installation, tutorial, administration and flagged modules remain available. Warm shell tokens, prototype geometry and authenticated-app guidance were added to `DESIGN.md`. The old sidebar and embedded document split were removed.

Main implementation lives in `src/components/lume/`, `src/lib/lume-workspace.ts`, `canvas-resources.ts`, `chat-scope*.ts`, the chat/document components and office route loaders.

Validation:

- Focused PostgreSQL/state/document tests: **35/35 passed**.
- Remaining animation SSR test: **1/1 passed**.
- Scoped ESLint: **passed**, including targeted reruns after fixes.
- Scoped TypeScript covering application, tests, e2e and fresh Next route types: **passed**.
- `git diff --check`: **passed**.
- E2e attempt for `lume-shell` and `app-shell`: authentication setup hit **ECONNREFUSED** at `localhost:58483`; six tests were skipped. The supplied instance was left untouched.

Parent handoff: run interactive proof and final root checks once the instance is available. Root typechecking still needs stale `.next-agent-verify` validators regenerated after the route moves.

Messages predating stored scope metadata require a new request instead of guessing their regeneration context. Shared pages/tasks and new case sections remain unimplemented. Their integration points are `CanvasResource`, `authorizedCanvasResource()`, loader bindings and the frozen scope contract; private `ai_artifact` ownership remains intact.
