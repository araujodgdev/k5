# Páginas compartilhadas

Test: `apps/web/e2e/case-pages.e2e.ts`

Run `doctor`, then `drive case-pages --video` against the owned disposable instance. No AI connection is needed for these human flows.

- Open a real case, choose Páginas, create a page, edit, reload, restore a version and render the DOCX preview.
- At 390px follow a page deep link, use version history by keyboard and switch between canvas and chat without losing text or overflowing.
- Publish a private artifact through Publicar no caso, review the exact destination/content/audience, confirm the copy and verify that another participant cannot read the original.
- In a different personal office, edit the shared copy after a competing owner save, retain the conflict draft and explicitly choose Manter a minha.
- Check outsider and revoked participant denial for get, versions, DOCX export and canvas descriptors; remove the revoked visible tab.

Screenshots and video are emitted by the real flows. PostgreSQL/service tests cover protected sources, nested folders, exact approval, concurrent replay and rollback. Internal mocked chat tests, if run separately, are frontend contracts and do not prove model execution.

The third test is explicitly tagged `frontend-contract`: it delays an internal `/api/chat` response to check frozen shared-page identity, background result handling and revision refresh. It does not prove a live provider turn.

Cold compilation can exceed the normal 10-second editor wait; inspect the trace and instance log before diagnosing a persistence failure. Compare stored Markdown with the API value rather than assuming the editor appends a trailing newline.
