# Parent production UI reproduction

A4 confirmed before UI source changes. ResearchCaseLinker may now be repaired by the sole code writer.

Native T3 status initially available, then the tab disappeared. preview_open re-established tab_o_069f8326-6fa0-400f-aa92-a6cf7f3a264c, but snapshot timed out and evaluate/recordingStart returned an explicit no automation host available error with Do not retry. Used the repository e2e browser fallback permitted for unavailable native preview. No native recording or injected mock was started successfully.

Parent wrote apps/web/e2e/research-linker-race.e2e.ts. The writer may now take ownership of that regression and extend it for late errors, material/assessment/reference changes, keyboard and390px. Test creates real accounts, cases and profiles through actual authenticated HTTP APIs, seeds an external catalog fixture with the existing controlled fixture, and drives the real React component. The only fetch interception HOLDS THE ACTUAL successful PUT RESPONSE after the real server save. It does not fabricate the response, alter React state, or substitute the backend save. Read-only SQL confirms A was saved and B remained unchanged.

Sequence: selectA; edit question; Save and review; hold real A response; selectB; wait for real B profile; release real A response; inspect field and review button. Expected B question. Actual A question under selectedB. Failure is at the final UI assertion after both SQL state checks passed.

Command: pnpm --dir apps/web exec tsx ../../.audit/lume-source-checks.mts e2e e2e/research-linker-race.e2e.ts

Negative result:1/1 failed in54.98s. Expected Questão do caso B, observed Questão revisada do caso A. Evidence directory apps/web/.e2e/verify/20261006T234247-d88728/source-e2e-1791374078103 contains report.json, output.log, before/after screenshots, failure screen and real browser video. Isolated app62541/PG62542 only. No live providers or external sends.

Parent proof run is complete, exec42598 drained. No browser test process remains owned by parent. The browser fixture .audit/lume-research-linker-race-fixture.js was an abandoned controlled-response attempt never successfully injected; do not present it as evidence. The actual regression uses real returned bytes and is the stronger proof. The parent stops source/test edits here; writer owns the new test now.
