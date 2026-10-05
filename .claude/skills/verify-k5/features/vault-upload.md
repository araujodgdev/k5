# Vault upload

The Cofre accepts a file up to exactly 100 MB and refuses one byte more with "O arquivo excede o limite de 100 MB."; a file sent straight into a case folder keeps its name and folder, finishes processing (`ready`), and downloads with the same content.

## Sub-features

- `upload-limit`: `POST /api/vault/uploads` returns 201 for 100 MB and 400 with the pt-BR error for 100 MB + 1 byte; the upload ref is stored for the user.
- `upload-direct`: `POST /api/vault/documents` with scope `case`, case and folder headers returns 201; `vault_document.folder_id` matches and `status` reaches `ready`.
- `upload-download`: `GET /api/vault/documents/<id>/download` returns the original text.
- `upload-ui`: the Cofre's "Enviar arquivos" button (not driven by this test; drive the screen with a new e2e test if a UI change touches it). There is no drag-and-drop target.

## How to get to it (user POV)

- Sidebar "Cofre" (`/app/vault`), then a case and its folder. The test calls the same endpoints the upload UI calls, with the signed-in session's cookies.

## Driving it with e2e

Test: `apps/web/e2e/vault-upload.e2e.ts`

Preconditions:

- `doctor` all OK. The tests sign in as the verification account through `ApiSession` and create a uniquely named case and folder.

- **Limit.** Send 100 MB + 1 byte, expect 400 and the error text; send exactly 100 MB with `x-k5-file-name`, expect 201 and `byteSize` equal; `sql` confirms `vault_upload_ref.byte_size` and ownership.
- **Direct.** Create a case and a private folder; upload `Procuração <n>.txt` with `x-k5-upload-scope: case`, `x-k5-upload-caseid`, `x-k5-upload-folderid`; poll `vault_document.status` until `ready`; download and compare the text.
- **Proof.** `drive vault-upload` returns both tests passed.

## Gotchas

- These are HTTP-level tests (no screen); they prove the server path the UI uses, not the upload widget.
- Every request needs an `origin` header matching the instance, or the CSRF check rejects it.
- On this instance the `.txt` reaches `ready` without `pnpm worker`. Do not generalize that to PDFs that need OCR or the LibreOffice/PDF path; prove those in CI or with the worker running.
