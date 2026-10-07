Reviewed all **63 scoped files** against `main`, including untracked files. **Files touched: none. Deletions performed: 0. Eight comment lines flagged across five files: six removable lines and two deferred in an applied migration.**

Paths below are relative to `apps/web`.

- `tests/source-repair-behavior.test.ts:100` — delete one line. Test declared at `:79` deletes the chunk at `:101` and asserts cached text remains at `:102`; the comment narrates those statements.
- `tests/google-email-insights.test.ts:293` — delete one line. `edited` at `:291–292` omits the three identifiers, and `:294–295` assert denial before dispatch.
- `tests/google-email-insights.test.ts:310` — delete one line. The independent literal reply and successful-send assertion at `:311–312` express the claimed behavior.
- `e2e/source-policy.e2e.ts:56–57` — delete two lines. `setConversationMessages` at `:58` visibly arranges the card; the following selection/clear assertions express this test’s scope. The reference to another test is evidence narration.
- `e2e/document-saving.e2e.ts:165` — delete one line. The `[1280, 390]` loop at `:166` and account-menu interactions at `:178–188` already show both widths use the same controls.
- `db/postgres/0080a_capture_upgrade_compat.sql:1–2` — flag two lines of application-workaround justification. `0081:7` writes `cancelled`, which the application’s approval constraint excludes (`0001_initial.sql:208`); `0080a:5` returns `OLD`, and `0082` removes the guard. **Defer deletion:** the saved final manifest records this migration as applied, and the migration runner rejects checksum changes.

**MUST KILL:** `db/postgres/0080a_capture_upgrade_compat.sql:3 — lume_capture_upgrade_preserve_approval`: make its specific suppression of the invalid 0081 `cancelled` update explicit in the symbol; any change is deferred under applied-migration immutability.

**Skips:** preserve the previously accepted contracts at `content-policy.ts:69` and `documents/shared-writing.ts:24`; preserve SDK timing at `agent-chat.tsx:645` and browser-storage exceptions at `:135,729`. Installed SDK source still contains awaited file/request preparation. Unchanged inherited comments remain outside this repair pass. No scoped lint or TypeScript suppressions found.

No writes, tests, migrations, browser actions, or nested agents performed. Parent retains acceptance and edit ownership.

## Parent judgment

Accepted six narration-line removals in four test/browser files. No behavioral code changed for those findings. Kept the two historical comments and symbol in applied 0080a unchanged under the user's explicit migration immutability requirement. 0082 removes that temporary function and trigger; adding another migration merely to rename an absent historical symbol would not improve runtime structure. No restoration, suppressions, rerun or new architecture needed. Previously accepted API/platform exceptions retained. This historical comment/rename finding remains intentionally unmodified; it does not block functional review.

Independent parent cleanup corrected corrupt Portuguese accents in the chat audio label, Calendar approval labels and extraction error. Scoped ESLint of those three production files passed. These three text-only corrections and six comment removals are the only parent production/test edits after the worker's frozen 43-test run. They require no new behavioral test by themselves. Full root lint/typecheck results are tracked separately.

