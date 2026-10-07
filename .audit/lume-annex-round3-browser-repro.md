# Native browser reproduction of annex selection race

2026-10-07, parent, production component from frozen round2 tree. No production code or database mutations.

Owned verification app: http://localhost:62541. Native T3 preview tab: tab_l_069f8326-6fa0-400f-aa92-a6cf7f3a264c. Existing verification case 041de192-96ac-4594-9d49-40e5c59a2ac8 opened in Files, then the real Anexos button mounted VaultAnnexes. Measured DOM viewport 539x848; recording/screenshot surface 1280x800. This is behavioral evidence, not pixel parity.

The browser-local fetch fixture replaced only the case document-list response and annex GET/POST responses. It supplied two ready PDF options (annex-race-A and annex-race-B). Annex GET returned no saved plan. Annex POST stayed pending until explicitly released. The real React component, form state and click/select/type interactions ran. No real AI analysis, upload, or annex generation ran.

Sequence:
1. Select PDF A and type an eligible test petition.
2. Click Propor anexos. Captured POST has scanDocumentId annex-race-A.
3. Select PDF B. Its GET returns plan:null; review is absent.
4. Release the pending A response with scanDocumentId annex-race-A and label PLANO DO PDF A.
5. The browser shows the review for A while the selected scan remains B. Gerar 1 anexo is enabled.

Observed result: selected=annex-race-B, visiblePlanLabel=PLANO DO PDF A, reviewPresent=true, generateEnabled=true. This reproduces B4 through the actual component under controlled HTTP timing. It is a seventh reproduced finding scenario in addition to the six production-owner/database negative scenarios. A/B/A, generation completion, busy/error races and post-fix behavior still require coverage.

Recording: C:/Users/douglas.araujo/.t3/userdata/attachments/36799375-22e8-4ee2-8675-8d16f7ff7ab6-9d65d90b-27a3-451d-a085-9497c6634beb-mp4.mp4
Screenshot: C:/Users/douglas.araujo/.t3/userdata/browser-artifacts/browser-screenshot-localhost-muxsxsuk-348a8569.png
Fixture: lume-annex-round3-browser-fixture.js

The fixture is removed by full navigation after capture. No server operation was cancelled or undone.
