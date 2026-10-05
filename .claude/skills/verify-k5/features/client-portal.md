# Client portal

From a client's page the office invites that client, publishes a Lume document as a PDF, and publishes a fee charge. The client opens the invite, sets a password, ticks the terms checkbox, and lands in the portal with no office membership. The published PDF and the charge PDF are there. The client uploads a payment proof. The office sees it and can revoke access.

## Sub-features

- `portal-invite`: button "Convidar cliente" on the client page reveals `label "Link do convite"` whose value matches `/client/invite/`.
- `portal-publish-pdf`: `label "Publicar documento do Lume em PDF"` selects a document, then button "Publicar versão em PDF". The text "A versão selecionada foi publicada em PDF para este cliente." appears. The client later sees `link "<título>.pdf"` and that URL returns 200.
- `portal-accept`: on the invite, fill `label "Nova senha"` and `label "Confirmar nova senha"`, check `checkbox /Li e aceito os Termos de uso/`, tap button "Criar acesso ao portal". `heading "Portal do cliente"` is visible and a session cookie is set. `sql` returns `accountKind` `client` and zero rows in `office_member`.
- `portal-charge-pdf`: `link "Baixar cobrança em PDF"` is visible on the portal.
- `portal-proof`: button "Enviar comprovante desta parcela", `label "Arquivo para enviar"` set to `e2e/fixtures/comprovante.pdf`, then button "Enviar arquivo ao escritório". The text "Comprovante enviado. O escritório fará a conferência do pagamento." appears. Back in the office, button "Atualizar portal" shows `link "comprovante.pdf"`.
- `portal-revoke`: button "Revogar acesso ao portal" shows "Acesso e convite revogados." The client's file URL and portal API then return 404.
- `portal-mobile`: at 390×844, the portal and the office client page have no horizontal scroll.

## How to get to it (user POV)

- Office: Escritório → Clientes → the client (`/app/agenda/clients/<id>`), section heading "Portal do cliente".
- Client: the invite URL (`/client/invite/<token>`), then the portal at `/client`.

## Driving it with e2e

Test: `apps/web/e2e/client-portal.e2e.ts`

Preconditions:

- `doctor` all OK. `soffice` (LibreOffice Writer) is on PATH. The Next.js process converts the DOCX itself. This instance does not start a worker, and the test does not need one.
- The test signs up its own office with `uniqueAccount('Ana')` and creates the client through the same API the UI uses. It seeds the Lume document with `seedArtifact`, because only an AI run creates that row. The verification account stays unused.

- **Invite.** Open the client page, tap "Convidar cliente", and read `label "Link do convite"`.
- **Publish.** Select the seeded document and tap "Publicar versão em PDF". Wait for the published-PDF text. The assertion allows 90 seconds.
- **Charge.** The test creates the installment and publishes the charge through the office APIs, then the client sees "Baixar cobrança em PDF".
- **Accept.** In a clean browser, open the invite, set both password fields, check the terms checkbox, and tap "Criar acesso ao portal". The portal heading is visible. `sql` shows a client account with no membership. Office APIs return 403.
- **Proof file.** Upload `e2e/fixtures/comprovante.pdf`. The office reloads the portal section and sees the file link.
- **Revoke.** Tap "Revogar acesso ao portal". The old client session then gets 404 for the PDF and the portal API.
- **Mobile.** At 390×844, both the portal and the office page have no horizontal scroll.
- **Proof.** `drive client-portal` returns the single test passed. Its trace shows the checkbox and both PDFs.

## Gotchas

- If `soffice` is missing, publishing the PDF fails and the terms checkbox never runs. CI installs `libreoffice-writer` before `pnpm test:e2e`. Do not pass `--exclude-tag pdf` when this proof is the goal.
- `legal-acceptance` does not drive this checkbox. This recipe does.
- The charge PDF is built when the client opens it, by the same LibreOffice conversion as the published document.
- A cold compile of the client page in `next dev` can outlast the 10 second assertion. Rerun the drive once before treating that as a regression.
